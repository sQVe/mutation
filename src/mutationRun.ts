import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { configWithTestFiles, mergedConfig, vitestFolderConfigSource } from './mutationConfig.ts';
import type { StrykerConfig } from './mutationConfig.ts';
import { mergeStrykerReports } from './mutationReport.ts';
import type { Mutant, MutationMode, StrykerReport } from './mutationReport.ts';
import { groupByFolder, mutatePatterns, unitTestFiles } from './mutationScope.ts';
import type { FileScope } from './mutationScope.ts';

export type InstrumentedMutants = readonly {
  mutatorName: string;
  replacement: string;
  status?: string;
  location: Mutant['location'];
}[];

export interface StrykerRun {
  root: string;
  config: StrykerConfig;
  mode: MutationMode;
  scopes: FileScope[];
  sameFolderTests: boolean;
  mutantsOf: Map<string, InstrumentedMutants>;
}

const reportSchema = z.looseObject({
  config: z
    .looseObject({ ignoreStatic: z.boolean().optional(), testRunner: z.string().optional() })
    .optional(),
  files: z.record(
    z.string(),
    z.looseObject({
      mutants: z.array(
        z.looseObject({
          mutatorName: z.string(),
          replacement: z.string(),
          status: z.string(),
          location: z.object({
            start: z.object({ line: z.number(), column: z.number() }),
            end: z.object({ line: z.number(), column: z.number() }),
          }),
        }),
      ),
    }),
  ),
  testFiles: z
    .record(
      z.string(),
      z.looseObject({ tests: z.array(z.looseObject({ id: z.string(), name: z.string() })) }),
    )
    .optional(),
});

// Stryker runs from the project, so its bin resolves from there.
const strykerBin = (root: string) => {
  const require = createRequire(join(root, 'package.json'));

  return join(dirname(require.resolve('@stryker-mutator/core/package.json')), 'bin/stryker.js');
};

const vitestConfigNames = ['vitest.config', 'vite.config'].flatMap((name) =>
  ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((extension) => `${name}.${extension}`),
);

// The project's own Vitest config, which Vitest would find itself without a `configFile`.
const projectVitestConfig = (root: string, config: StrykerConfig) => {
  const configured = config.vitest?.['configFile'];

  if (typeof configured === 'string') {
    return resolve(root, configured);
  }

  const found = vitestConfigNames.find((name) => existsSync(join(root, name)));

  return found === undefined ? undefined : join(root, found);
};

const parseReport = (reportPath: string): StrykerReport => {
  const parsed = reportSchema.safeParse(JSON.parse(readFileSync(reportPath, 'utf8')));

  if (!parsed.success) {
    throw new Error(`Stryker wrote an unusable report: ${z.prettifyError(parsed.error)}`);
  }

  // SAFETY: reportSchema checks every field that StrykerReport types and keeps the rest.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the report is Stryker output.
  return parsed.data as StrykerReport;
};

const runStryker = (
  root: string,
  directory: string,
  name: string,
  config: StrykerConfig,
  scopes: FileScope[],
  mode: MutationMode,
) => {
  const reportPath = join(directory, `${name}.mutation.json`);
  const configPath = join(directory, `${name}.stryker.config.json`);
  const merged = mergedConfig(config, scopes.flatMap(mutatePatterns), reportPath, mode);

  writeFileSync(configPath, JSON.stringify(merged, undefined, 2));

  const stryker = spawnSync(process.execPath, [strykerBin(root), 'run', configPath], {
    cwd: root,
    stdio: ['ignore', 2, 2],
  });

  if (stryker.status !== 0) {
    throw new Error(`Stryker exited with status ${stryker.status}. See its output on stderr.`);
  }

  return parseReport(reportPath);
};

const runFolder = (
  root: string,
  directory: string,
  index: number,
  config: StrykerConfig,
  mode: MutationMode,
  folderScopes: FileScope[],
  testFiles: string[],
) => {
  const vitestConfigFile = join(directory, `${index}.vitest.config.mjs`);
  const withTests = configWithTestFiles(config, testFiles, vitestConfigFile);

  if (config.testRunner === 'vitest') {
    const base = projectVitestConfig(root, config);
    const baseUrl = base === undefined ? undefined : pathToFileURL(base).href;

    writeFileSync(vitestConfigFile, vitestFolderConfigSource(baseUrl, testFiles));
  }

  return runStryker(root, directory, String(index), withTests, folderScopes, mode);
};

// The instrumenter counts lines and columns from 0, the report from 1.
const noCoverageMutants = (found: InstrumentedMutants): Mutant[] =>
  found
    .filter(({ status }) => status !== 'Ignored')
    .map(({ mutatorName, replacement, location }) => ({
      mutatorName,
      replacement,
      status: 'NoCoverage',
      location: {
        start: { line: location.start.line + 1, column: location.start.column + 1 },
        end: { line: location.end.line + 1, column: location.end.column + 1 },
      },
    }));

// Runs Stryker once per folder, with only the unit tests of that folder. A folder with no unit test
// gets no run: all its mutants have no coverage.
const runPerFolder = (run: StrykerRun, directory: string) => {
  const reports: StrykerReport[] = [];
  const uncovered: StrykerReport = { files: {} };

  for (const [folder, folderScopes] of groupByFolder(run.scopes)) {
    const testFiles = unitTestFiles(folder, readdirSync(join(run.root, folder)));

    if (testFiles.length > 0) {
      reports.push(
        runFolder(
          run.root,
          directory,
          reports.length,
          run.config,
          run.mode,
          folderScopes,
          testFiles,
        ),
      );

      continue;
    }

    for (const { path } of folderScopes) {
      uncovered.files[path] = { mutants: noCoverageMutants(run.mutantsOf.get(path) ?? []) };
    }
  }

  return mergeStrykerReports([...reports, uncovered]);
};

export const runStrykerReport = (run: StrykerRun): StrykerReport => {
  const directory = mkdtempSync(join(tmpdir(), 'mutation-'));

  try {
    if (run.sameFolderTests) {
      return runPerFolder(run, directory);
    }

    return runStryker(run.root, directory, '0', run.config, run.scopes, run.mode);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
