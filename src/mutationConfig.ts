import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { ignorerName } from './mutationIgnorePolicy.ts';
import type { MutationMode } from './mutationReport.ts';
import { escapeGlob } from './mutationScope.ts';

export interface MergedConfig extends StrykerConfig {
  reporters: string[];
  jsonReporter: { fileName: string };
  thresholds: Record<string, unknown>;
  disableBail: boolean;
}

export const configSchema = z.looseObject({
  mutate: z.array(z.string()),
  thresholds: z.record(z.string(), z.unknown()).optional(),
  mutator: z.looseObject({ excludedMutations: z.array(z.string()).optional() }).optional(),
  ignorers: z.array(z.string()).optional(),
  plugins: z.array(z.string()).optional(),
  ignoreStatic: z.boolean().optional(),
  testRunner: z.string().optional(),
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

// Applies the defaults every project shares. A value the project sets always wins, and the
// timeout stays Stryker's default unless the project sets it.
export const withSharedDefaults = (config: StrykerConfig): StrykerConfig => ({
  ...config,
  plugins: appendUnless(
    config.plugins ?? strykerDefaultPlugins,
    [ignorerPluginPath, ignorerSpecifier],
    ignorerPluginPath,
  ),
  ignorers: appendUnless(config.ignorers ?? [], [ignorerName], ignorerName),
  ignoreStatic: config.ignoreStatic ?? true,
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
export const vitestFolderConfigSource = (
  base: { viteUrl: string; path: string } | undefined,
  testFiles: readonly string[],
): string => {
  const include = JSON.stringify(testFiles.map(escapeGlob));

  const load =
    base === undefined
      ? 'const loadBase = async () => ({});'
      : [
          "import { resolve } from 'node:path';",
          '',
          `import { loadConfigFromFile } from ${JSON.stringify(base.viteUrl)};`,
          '',
          'const loadBase = async (environment) => {',
          `  const loaded = await loadConfigFromFile(environment, resolve(process.cwd(), ${JSON.stringify(base.path)}));`,
          '',
          '  if (loaded === null) {',
          `    throw new Error("Vite could not load ${base.path.replaceAll(/["\\]/g, '')}.");`,
          '  }',
          '',
          '  return loaded.config;',
          '};',
        ].join('\n');

  return [
    load,
    '',
    'export default async (environment) => {',
    '  const config = await loadBase(environment);',
    '',
    `  return { ...config, test: { ...config.test, include: ${include} } };`,
    '};',
    '',
  ].join('\n');
};

// Limits a run to the given test files. The Vitest runner has no such option, so it gets a
// generated config file; the Bun runner takes the files directly.
export const configWithTestFiles = (
  config: StrykerConfig,
  testFiles: readonly string[],
  vitestConfigFile: string,
): StrykerConfig => {
  if (config.testRunner === 'bun') {
    return { ...config, bun: { ...config.bun, testFiles } };
  }

  if (config.testRunner === 'vitest') {
    return {
      ...config,
      vitest: { ...config.vitest, configFile: vitestConfigFile, related: false },
    };
  }

  throw new Error('--same-folder-tests needs "testRunner" to be "vitest" or "bun" in the config.');
};
