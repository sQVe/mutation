import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { ignorerName } from './mutationIgnorePolicy.ts';
import type { MutationMode } from './mutationReport.ts';

export interface MergedConfig extends StrykerConfig {
  reporters: string[];
  jsonReporter: { fileName: string };
  thresholds: Record<string, unknown>;
  disableBail: boolean;
}

export const configSchema = z.looseObject({
  mutate: z.array(z.string()),
  thresholds: z.record(z.string(), z.unknown()).optional(),
  mutator: z
    .looseObject({
      excludedMutations: z.array(z.string()).optional(),
      plugins: z.array(z.unknown()).nullable().optional(),
    })
    .optional(),
  ignorePatterns: z.array(z.string()).optional(),
  ignorers: z.array(z.string()).optional(),
  plugins: z.array(z.string()).optional(),
  ignoreStatic: z.boolean().optional(),
  testRunner: z.string().optional(),
  concurrency: z.union([z.number(), z.string()]).optional(),
  timeoutMS: z.number().optional(),
  timeoutFactor: z.number().optional(),
  dryRunTimeoutMinutes: z.number().optional(),
  fileLogLevel: z.string().optional(),
  tempDirName: z.string().optional(),
  cleanTempDir: z.boolean().optional(),
  incremental: z.boolean().optional(),
  incrementalFile: z.string().optional(),
  coverageAnalysis: z.string().optional(),
  bun: z.record(z.string(), z.unknown()).optional(),
  vitest: z.record(z.string(), z.unknown()).optional(),
});

export type StrykerConfig = z.output<typeof configSchema>;

const strykerDefaultPlugins = ['@stryker-mutator/*'];

// The ignorer file sits next to this module, as .ts in the source tree and as .js once built.
export const ignorerPluginPath = fileURLToPath(
  new URL(`./mutationIgnorer${extname(import.meta.url)}`, import.meta.url),
);

const ignorerSpecifier = '@sqve/mutation/ignorer';

const appendUnless = (list: string[], present: readonly string[], item: string) =>
  present.some((name) => list.includes(name)) ? list : [...list, item];

const defaultTimeoutMS = 20_000;
const defaultTimeoutFactor = 4;
const defaultDryRunTimeoutMinutes = 20;

const projectValueOr = <T>(projectValue: T | undefined, fallback: T): T => projectValue ?? fallback;

export const withSharedDefaults = (config: StrykerConfig): StrykerConfig => ({
  ...config,
  plugins: appendUnless(
    projectValueOr(config.plugins, strykerDefaultPlugins),
    [ignorerPluginPath, ignorerSpecifier],
    ignorerPluginPath,
  ),
  ignorers: appendUnless(projectValueOr(config.ignorers, []), [ignorerName], ignorerName),
  ignoreStatic: projectValueOr(config.ignoreStatic, true),
  concurrency: projectValueOr(config.concurrency, '25%'),
  timeoutMS: projectValueOr(config.timeoutMS, defaultTimeoutMS),
  timeoutFactor: projectValueOr(config.timeoutFactor, defaultTimeoutFactor),
  dryRunTimeoutMinutes: projectValueOr(config.dryRunTimeoutMinutes, defaultDryRunTimeoutMinutes),
  fileLogLevel: projectValueOr(config.fileLogLevel, 'off'),
  tempDirName: projectValueOr(config.tempDirName, '.tau/stryker-tmp'),
  cleanTempDir: projectValueOr(config.cleanTempDir, true),
  incremental: projectValueOr(config.incremental, true),
  incrementalFile: projectValueOr(config.incrementalFile, '.tau/stryker-incremental.json'),
  coverageAnalysis: projectValueOr(config.coverageAnalysis, 'perTest'),
});

// The config Stryker runs: the project config with the shared defaults and the computed scope. Only
// buildMutationReport decides the exit code, so the break threshold is off.
export const mergedConfig = (
  config: StrykerConfig,
  mutate: string[],
  reportPath: string,
  mode: MutationMode,
): MergedConfig => ({
  ...withSharedDefaults(config),
  mutate,
  reporters: ['json', 'progress'],
  jsonReporter: { fileName: reportPath },
  thresholds: { ...config.thresholds, break: null },
  disableBail: mode === 'audit',
  // An incremental result from a run with bail on lists only the first killing test.
  ...(mode === 'audit' ? { incremental: false } : {}),
});

// The source of a Vitest config that runs the project's config with only the given test files.
// The base config is a path relative to the project root. It loads from the working directory of
// the run, which is Stryker's sandbox, so paths the config builds from `import.meta.url` reach the
// mutated sources. Vite's loader reads it, as Vitest would, and gets the environment Vitest passes.
// Vitest reads `include` relative to the root, so each file is made relative to the effective root.
// In-source tests are turned off, so only the given test files run. Vitest projects carry their
// own `include`, so a loaded config that sets `test.projects` or `test.workspace` is refused: the
// setting's name goes to the marker file and the load throws.
export const vitestFolderConfigSource = (
  base: { viteUrl: string; path: string; markerPath: string } | undefined,
  testFiles: readonly string[],
): string => {
  const files = JSON.stringify(testFiles);

  const load =
    base === undefined
      ? 'const loadBase = async () => ({});'
      : [
          "import { writeFileSync } from 'node:fs';",
          `import { loadConfigFromFile } from ${JSON.stringify(base.viteUrl)};`,
          '',
          'const loadBase = async (environment) => {',
          `  const loaded = await loadConfigFromFile(environment, resolve(process.cwd(), ${JSON.stringify(base.path)}));`,
          '',
          '  if (loaded === null) {',
          `    throw new Error("Vite could not load ${base.path.replaceAll(/["\\]/g, '')}.");`,
          '  }',
          '',
          "  for (const name of ['projects', 'workspace']) {",
          '    if (loaded.config.test?.[name] !== undefined) {',
          `      writeFileSync(${JSON.stringify(base.markerPath)}, name);`,
          '',
          '      throw new Error("test." + name + " is not supported with --same-folder-tests.");',
          '    }',
          '  }',
          '',
          '  return loaded.config;',
          '};',
        ].join('\n');

  return [
    "import { relative, resolve } from 'node:path';",
    '',
    load,
    '',
    `const files = ${files};`,
    '',
    'const escapeGlob = (path) => path.replaceAll(/[*?[{}()]/g, "[$&]");',
    '',
    'const includeOf = (config) => {',
    '  const root = resolve(process.cwd(), config.test?.root ?? config.root ?? ".");',
    '',
    '  return files.map((file) => {',
    '    const inRoot = relative(root, resolve(process.cwd(), file)).split("\\\\").join("/");',
    '',
    '    if (inRoot.startsWith("..")) {',
    '      throw new Error(file + " is outside the Vitest root " + root + ".");',
    '    }',
    '',
    '    return escapeGlob(inRoot);',
    '  });',
    '};',
    '',
    'export default async (environment) => {',
    '  const config = await loadBase(environment);',
    '',
    '  return { ...config, test: { ...config.test, include: includeOf(config), includeSource: [] } };',
    '};',
    '',
  ].join('\n');
};

export const assertFolderRunner = (config: StrykerConfig): void => {
  if (config.testRunner !== 'bun' && config.testRunner !== 'vitest') {
    throw new Error(
      '--same-folder-tests needs "testRunner" to be "vitest" or "bun" in the config.',
    );
  }
};

// Limits a run to the given test files. The Vitest runner has no such option, so it gets a
// generated config file; the Bun runner takes the files directly. The folder runs of one invocation
// share the incremental file, so a later run would reuse an earlier run's result and report fewer
// completed tests than it planned.
export const configWithTestFiles = (
  config: StrykerConfig,
  testFiles: readonly string[],
  vitestConfigFile: string,
): StrykerConfig => {
  assertFolderRunner(config);

  const folderRun: StrykerConfig = { ...config, incremental: false };

  if (folderRun.testRunner === 'bun') {
    // The Bun runner prefers a top-level `testFiles` over `bun.testFiles`.
    const { testFiles: _configured, ...withoutTestFiles } = folderRun;

    return { ...withoutTestFiles, bun: { ...folderRun.bun, testFiles } };
  }

  // The generated include names each test file from the root, so another search folder would
  // select files that do not exist.
  const { dir: _searchFolder, ...vitest } = folderRun.vitest ?? {};

  return {
    ...folderRun,
    vitest: { ...vitest, configFile: vitestConfigFile, related: false },
  };
};
