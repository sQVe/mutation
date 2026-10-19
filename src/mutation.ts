import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, matchesGlob, relative, resolve } from 'node:path';

import { Instrumenter } from '@stryker-mutator/instrumenter';
import { noopLogger } from '@stryker-mutator/util';
import { z } from 'zod';

import { configSchema, withSharedDefaults } from './mutationConfig.ts';
import type { StrykerConfig } from './mutationConfig.ts';
import { enabledIgnorers } from './mutationIgnorePolicy.ts';
import { mutationIgnorer } from './mutationIgnorer.ts';
import { buildMutationReport } from './mutationReport.ts';
import type { MutationOutcome, StrykerReport } from './mutationReport.ts';
import { runStrykerReport } from './mutationRun.ts';
import type { InstrumentedMutants } from './mutationRun.ts';
import {
  auditScope,
  changedLinesDiffArguments,
  changedScope,
  countedMutants,
  fitCap,
  isProductionFile,
  mutateConfigError,
  rejectedAuditPaths,
  unreportedFiles,
} from './mutationScope.ts';
import type { Command, FileScope } from './mutationScope.ts';

const maxGitOutput = Number.POSITIVE_INFINITY;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: maxGitOutput });

const readConfig = (path: string): StrykerConfig => {
  const parsed = configSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));

  if (!parsed.success) {
    throw new Error(`${path} is not a usable Stryker config: ${z.prettifyError(parsed.error)}`);
  }

  const problem = mutateConfigError(parsed.data.mutate, path);

  if (problem !== undefined) {
    throw new Error(problem);
  }

  return parsed.data;
};

const changedFiles = (root: string, base: string, isProduction: (path: string) => boolean) => {
  const diff = git(root, ...changedLinesDiffArguments(base));
  const untrackedOutput = git(root, 'ls-files', '-z', '--others', '--exclude-standard');
  const untracked = untrackedOutput.split('\0').filter((path) => path !== '');

  return changedScope(diff, untracked, isProduction);
};

const auditFiles = (
  root: string,
  paths: readonly string[],
  isProduction: (path: string) => boolean,
) => {
  const relativePaths = paths.map((path) => relative(root, resolve(path)));
  const rejected = rejectedAuditPaths(relativePaths, isProduction);

  if (rejected.length > 0) {
    throw new Error(`Not production code in the config's mutate globs: ${rejected.join(', ')}`);
  }

  return auditScope(relativePaths, isProduction);
};

const wholeFileRanges = (scope: FileScope) =>
  scope.ranges === undefined
    ? true
    : scope.ranges.map(({ start, end }) => ({
        start: { line: start - 1, column: 0 },
        end: { line: end - 1, column: Number.MAX_SAFE_INTEGER },
      }));

const instrumentScope = async (root: string, scope: FileScope, config: StrykerConfig) => {
  const instrumenter = new Instrumenter(noopLogger);
  const ignorers = enabledIgnorers(config.ignorers, mutationIgnorer);
  const content = readFileSync(join(root, scope.path), 'utf8');

  const result = await instrumenter.instrument(
    [{ name: scope.path, content, mutate: wholeFileRanges(scope) }],
    { plugins: null, excludedMutations: config.mutator?.excludedMutations ?? [], ignorers },
  );

  return result.mutants;
};

const readSources = (root: string, report: StrykerReport) =>
  Object.fromEntries(
    Object.keys(report.files).map((path) => [path, readFileSync(join(root, path), 'utf8')]),
  );

export const mutate = async (
  command: Command,
): Promise<{ report: MutationOutcome; exitCode: number }> => {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();

  const config = withSharedDefaults(
    readConfig(resolve(root, command.configPath ?? 'stryker.config.json')),
  );

  const isProduction = (path: string) => isProductionFile(path, config.mutate, matchesGlob);

  const scopes =
    command.mode === 'changed'
      ? changedFiles(root, command.base ?? 'HEAD', isProduction)
      : auditFiles(root, command.paths, isProduction);

  const mutantsOf = new Map<string, InstrumentedMutants>();

  const counts = await Promise.all(
    scopes.map(async (scope) => {
      const found = await instrumentScope(root, scope, config);

      mutantsOf.set(scope.path, found);

      return { path: scope.path, mutants: countedMutants(found) };
    }),
  );

  const { run, unmutated } = fitCap(counts, command.maxMutants);
  const runScopes = scopes.filter(({ path }) => run.includes(path));

  const stryker =
    runScopes.length === 0
      ? undefined
      : runStrykerReport({
          root,
          config,
          mode: command.mode,
          scopes: runScopes,
          sameFolderTests: command.sameFolderTests,
          mutantsOf,
        });

  const sources = stryker === undefined ? {} : readSources(root, stryker);

  const reportedPaths = Object.entries(stryker?.files ?? {})
    .filter(([, { mutants }]) => mutants.length > 0)
    .map(([path]) => path);

  const unreported = unreportedFiles(
    counts.filter(({ path }) => run.includes(path)),
    reportedPaths,
  );

  return buildMutationReport({
    mode: command.mode,
    ...(stryker === undefined ? {} : { stryker }),
    sources,
    unmutated: [...unmutated, ...unreported].toSorted(),
  });
};
