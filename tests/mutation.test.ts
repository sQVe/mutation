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

import { add, negate } from './math.ts';

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

const runCommand = (repository: string, args: string[]) => {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: repository,
    encoding: 'utf8',
  });

  // SAFETY: the command prints one MutationOutcome as JSON on stdout.
  const report = JSON.parse(result.stdout) as MutationOutcome;

  return { status: result.status, report };
};

const survivorLines = ({ survivors }: MutationOutcome) =>
  survivors.map(({ file, line, mutator, covered }) => `${file}:${line} ${mutator} ${covered}`);

// The Vitest fixture has its own config, which the same-folder run must extend.
const vitestConfig = `import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['**/*.test.ts'] } });
`;

const fixtureProject = (runner: Runner) =>
  createProject(
    { ...baseConfig, ...runnerConfig[runner] },
    {
      ...(runner === 'vitest' ? { 'vitest.config.ts': vitestConfig } : {}),
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
