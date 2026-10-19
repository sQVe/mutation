import { spawnSync } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, onTestFinished } from 'vitest';

import type { MutationOutcome } from '../src/mutationReport.ts';
import { createTemporaryRepository } from './gitRepository.ts';

type Runner = 'vitest' | 'bun';

const root = fileURLToPath(new URL('../', import.meta.url));
const command = join(root, 'src/cli.ts');
const stryker = 'Stryker runs take a while.';
const strykerTimeout = 180_000;

const runnerConfig = {
  vitest: { testRunner: 'vitest', plugins: ['@stryker-mutator/vitest-runner'] },
  bun: { testRunner: 'bun', plugins: ['@hughescr/stryker-bun-runner'] },
};

const baseConfig = {
  coverageAnalysis: 'perTest',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  checkers: [],
  concurrency: 1,
  fileLogLevel: 'off',
  tempDirName: '.stryker-tmp',
};

const sources = `export const add = (left: number, right: number) => left + right;

export const negate = (value: number) => -value;
`;

const testModule = (runner: Runner) => (runner === 'bun' ? 'bun:test' : 'vitest');

// The test next to the source pins only negate. The test in the other folder pins both.
const sameFolderTest = (runner: Runner) => `import { expect, it } from '${testModule(runner)}';

import { add, negate } from '${runner === 'vitest' ? '@math' : './math.ts'}';

it('adds', () => {
  add(1, 2);
});

it('negates', () => expect(negate(2)).toBe(-2));
`;

const otherFolderTest = (runner: Runner) => `import { expect, it } from '${testModule(runner)}';

import { add, negate } from '../math/math.ts';

it('adds exactly', () => expect(add(1, 2)).toBe(3));

it('negates exactly', () => expect(negate(2)).toBe(-2));
`;

const writeFiles = async (directory: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }
};

const createProject = async (config: Record<string, unknown>, files: Record<string, string>) => {
  const repository = await createTemporaryRepository(onTestFinished);

  await symlink(join(root, 'node_modules'), join(repository, 'node_modules'));
  await writeFiles(repository, { 'stryker.config.json': JSON.stringify(config), ...files });

  return repository;
};

const git = (repository: string, ...args: string[]) =>
  spawnSync('git', args, { cwd: repository, encoding: 'utf8' });

const commitBase = (repository: string) => {
  git(repository, 'add', 'stryker.config.json');
  git(repository, 'commit', '--quiet', '-m', 'base');
};

// The test process runs under Vitest, but the command starts without that marker, as in a shell.
const { VITEST: _marker, ...withoutVitestMarker } = process.env;

const runCommand = (repository: string, args: string[]) => {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: withoutVitestMarker,
  });

  // SAFETY: the command prints one MutationOutcome as JSON on stdout.
  const report = JSON.parse(result.stdout) as MutationOutcome;

  return { status: result.status, report };
};

const survivorLines = ({ survivors }: MutationOutcome) =>
  survivors.map(({ file, line, mutator, covered }) => `${file}:${line} ${mutator} ${covered}`);

// The same-folder test imports the source through this alias, so the run fails to load the test
// unless the generated config extends this one. The log line must not reach the report on stdout.
const vitestConfig = `import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { include } from './settings';

console.log('vitest config loaded');

export default defineConfig({
  resolve: { alias: { '@math': fileURLToPath(new URL('./src/math/math.ts', import.meta.url)) } },
  root: fileURLToPath(new URL('./src', import.meta.url)),
  test: { include, includeSource: ['checks/**/*.ts'] },
});
`;

// An in-source test in another folder that kills the add mutant. Same-folder mode must not run it.
const inSourceTest = `import { add } from '../math/math.ts';

if (import.meta.vitest) {
  const { expect, it } = import.meta.vitest;

  it('adds in source', () => expect(add(1, 2)).toBe(3));
}
`;

// An extensionless import only Vite's config loader resolves.
const settings = "export const include = ['**/*.test.ts'];\n";

const fixtureProject = (runner: Runner) =>
  createProject(
    {
      ...baseConfig,
      ...runnerConfig[runner],
      ...(runner === 'vitest' ? { mutate: ['src/math/**/*.ts', '!src/**/*.test.ts'] } : {}),
    },
    {
      ...(runner === 'vitest'
        ? {
            'vitest.config.ts': vitestConfig,
            'settings.ts': settings,
            'src/checks/inline.ts': inSourceTest,
          }
        : {}),
      'src/math/math.ts': sources,
      'src/math/math.test.ts': sameFolderTest(runner),
      'src/checks/math.test.ts': otherFolderTest(runner),
    },
  );

describe.each(['vitest', 'bun'] as const)('mutation changed with the %s runner', (runner) => {
  it(
    `runs the tests of the changed file's folder only with --same-folder-tests. ${stryker}`,
    async () => {
      const repository = await fixtureProject(runner);

      commitBase(repository);

      const { status, report } = runCommand(repository, ['--same-folder-tests', 'changed', 'HEAD']);

      expect(report.error).toBeUndefined();
      expect(status).toBe(2);
      expect(report.status).toBe('survivors');
      expect(report.totals).toMatchObject({ mutants: 2, killed: 1, survived: 1, noCoverage: 0 });
      expect(survivorLines(report)).toEqual(['src/math/math.ts:1 ArithmeticOperator true']);
      expect(report.unmutated).toEqual([]);
    },
    strykerTimeout,
  );

  it(
    `runs every test without --same-folder-tests. ${stryker}`,
    async () => {
      const repository = await fixtureProject(runner);

      commitBase(repository);

      const { status, report } = runCommand(repository, ['changed', 'HEAD']);

      expect(report.error).toBeUndefined();
      expect(status).toBe(0);
      expect(report.status).toBe('pass');
      expect(report.totals).toMatchObject({ mutants: 2, killed: 2, survived: 0, noCoverage: 0 });
      expect(report.survivors).toEqual([]);
      expect(report.unmutated).toEqual([]);
    },
    strykerTimeout,
  );
});

const importingTest = (name: string) => `import { expect, it } from 'vitest';

import { add, negate } from './${name}';

it('adds', () => {
  add(1, 2);
});

it('negates', () => expect(negate(2)).toBe(-2));
`;

// A backslash in an import path is not portable, so this test leaves the file uncovered.
const unrelatedTest = `import { expect, it } from 'vitest';

it('runs', () => expect(1).toBe(1));
`;

describe('mutation changed on one tracked file', () => {
  const trackedProject = (name: string, testSource = importingTest(name), extraConfig = {}) =>
    createProject(
      { ...baseConfig, ...runnerConfig.vitest, ...extraConfig },
      {
        'vitest.config.ts': vitestConfig,
        'settings.ts': settings,
        [`src/${name}`]: sources,
        'src/math.test.ts': testSource,
      },
    );

  const commitAll = (repository: string) => {
    git(repository, 'add', '.');
    git(repository, 'commit', '--quiet', '-m', 'base');
  };

  it(
    `reports the whole survivor record of a changed line. ${stryker}`,
    async () => {
      const repository = await trackedProject('math.ts');

      commitAll(repository);

      await writeFile(
        join(repository, 'src/math.ts'),
        sources.replace('left + right', 'right + left'),
      );

      const { status, report } = runCommand(repository, ['changed', 'HEAD']);

      expect(report.error).toBeUndefined();
      expect(status).toBe(2);

      expect(report.survivors).toEqual([
        {
          file: 'src/math.ts',
          line: 1,
          column: 53,
          endLine: 1,
          endColumn: 65,
          mutator: 'ArithmeticOperator',
          original: 'right + left',
          replacement: 'right - left',
          covered: true,
        },
      ]);
    },
    strykerTimeout,
  );

  it(
    `runs the mutants of a tracked file whose name holds a backslash. ${stryker}`,
    async () => {
      const repository = await trackedProject('back\\slash.ts', unrelatedTest, {
        vitest: { related: false },
      });

      commitAll(repository);

      await writeFile(
        join(repository, 'src/back\\slash.ts'),
        sources.replace('left + right', 'right + left'),
      );

      const { status, report } = runCommand(repository, ['changed', 'HEAD']);

      expect(report.error).toBeUndefined();
      expect(status).toBe(2);
      expect(report.totals).toMatchObject({ mutants: 2, killed: 0, survived: 2, noCoverage: 0 });
      expect(report.unmutated).toEqual([]);
    },
    strykerTimeout,
  );
});

// A weak test cannot kill the static arithmetic mutant of `1 + 2`. Without ignoreStatic, Stryker
// runs a static mutant against every test it plans, so a survivor must not read as a load failure.
const staticValue = 'export const value = 1 + 2;\n';

const weakTest = `import { expect, it } from 'vitest';

import { value } from './value.ts';

it('has a number', () => expect(typeof value).toBe('number'));
`;

const staticProject = () =>
  createProject(
    { ...baseConfig, ...runnerConfig.vitest, ignoreStatic: false },
    {
      'src/a/value.ts': staticValue,
      'src/a/value.test.ts': weakTest,
      'src/b/value.ts': staticValue,
      'src/b/value.test.ts': weakTest,
    },
  );

describe('mutation of static mutants without ignoreStatic', () => {
  it.each([
    {
      name: 'a same-folder run over two folders',
      args: ['--same-folder-tests', 'changed', 'HEAD'],
    },
    { name: 'a Vitest run with vitest.related on', args: ['changed', 'HEAD'] },
  ])(
    `reports the survivors of $name (${stryker})`,
    async ({ args }) => {
      const repository = await staticProject();

      commitBase(repository);

      const { status, report } = runCommand(repository, args);

      expect(report.error).toBeUndefined();
      expect(status).toBe(2);
      expect(report.status).toBe('survivors');
      expect(report.totals).toMatchObject({ mutants: 2, survived: 2, falseSurvived: 0 });
      expect(report.falseSurvivors).toEqual([]);

      expect(survivorLines(report)).toEqual([
        'src/a/value.ts:1 ArithmeticOperator true',
        'src/b/value.ts:1 ArithmeticOperator true',
      ]);
    },
    strykerTimeout,
  );
});

const uncovered = (line: number, column: number, endLine: number, endColumn: number) => ({
  file: 'src/solo/solo.ts',
  line,
  column,
  endLine,
  endColumn,
  covered: false,
});

describe('mutation of a folder with no test', () => {
  const soloSource = `export const half = (value: number) => value / 2;

export const fail = () => {
  throw new Error('boom');
};
`;

  it('reports every mutant as uncovered, not the ignored ones, and starts no Stryker run', async () => {
    const repository = await createProject(
      { ...baseConfig, ...runnerConfig.vitest },
      {
        'src/solo/solo.ts': soloSource,
        'src/checks/solo.test.ts': `import { expect, it } from 'vitest';

import { half } from '../solo/solo.ts';

it('halves', () => expect(half(4)).toBe(2));
`,
      },
    );

    const { status, report } = runCommand(repository, [
      '--same-folder-tests',
      'audit',
      'src/solo/solo.ts',
    ]);

    expect(report.error).toBeUndefined();
    expect(status).toBe(0);
    expect(report.status).toBe('survivors');
    expect(report.totals).toMatchObject({ mutants: 4, killed: 0, survived: 0, noCoverage: 4 });

    expect(report.survivors).toEqual([
      {
        ...uncovered(1, 21, 1, 49),
        mutator: 'ArrowFunction',
        original: '(value: number) => value / 2',
        replacement: '() => undefined',
      },
      {
        ...uncovered(1, 40, 1, 49),
        mutator: 'ArithmeticOperator',
        original: 'value / 2',
        replacement: 'value * 2',
      },
      {
        ...uncovered(3, 27, 5, 2),
        mutator: 'BlockStatement',
        original: "{ throw new Error('boom'); }",
        replacement: '{}',
      },
      {
        ...uncovered(4, 3, 4, 27),
        mutator: 'CallExpression',
        original: "throw new Error('boom');",
        replacement: ';',
      },
    ]);
  });
});

describe('mutation with Vitest projects', () => {
  it.each(['projects', 'workspace'])(
    'refuses test.%s with --same-folder-tests',
    async (setting) => {
      const repository = await createProject(
        { ...baseConfig, ...runnerConfig.vitest },
        {
          'vitest.config.ts': `export default { test: process.env.VITEST ? { ${setting}: [] } : {} };\n`,
          'src/math/math.ts': sources,
          'src/math/math.test.ts': sameFolderTest('vitest'),
        },
      );

      const { status, report } = runCommand(repository, [
        '--same-folder-tests',
        'audit',
        'src/math/math.ts',
      ]);

      expect(status).toBe(1);
      expect(report.status).toBe('error');

      expect(report.error).toBe(
        `vitest.config.ts sets "test.${setting}". --same-folder-tests does not support it.`,
      );
    },
  );
});

describe('mutation with a refused config', () => {
  it.each([
    { name: 'no mutate list', config: { ...baseConfig, mutate: undefined } },
    { name: 'an empty mutate list', config: { ...baseConfig, mutate: [] } },
  ])('exits 1 with an error report for $name', async ({ config }) => {
    const repository = await createProject(config, { 'src/math/math.ts': sources });

    const { status, report } = runCommand(repository, ['audit', 'src/math/math.ts']);

    expect(status).toBe(1);
    expect(report.status).toBe('error');
    expect(report.error).toContain('stryker.config.json');
    expect(report.survivors).toEqual([]);
  });

  it('reports a usage refusal with its own text', async () => {
    const repository = await createProject(baseConfig, {});

    const { status, report } = runCommand(repository, ['fix']);

    expect(status).toBe(1);

    expect(report.error).toBe(
      'Unknown mode "fix". Usage: mutation [--same-folder-tests] [--max-mutants <n>] [--config <path>] changed <base> | audit <path>...',
    );
  });

  it('exits 1 when --same-folder-tests meets a runner it cannot limit', async () => {
    const repository = await createProject(
      { ...baseConfig, testRunner: 'command' },
      { 'src/math/math.ts': sources, 'src/math/math.test.ts': sameFolderTest('vitest') },
    );

    const { status, report } = runCommand(repository, [
      '--same-folder-tests',
      'audit',
      'src/math/math.ts',
    ]);

    expect(status).toBe(1);
    expect(report.status).toBe('error');
    expect(report.error).toContain('"vitest" or "bun"');
  });
});
