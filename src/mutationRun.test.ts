import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { createStrykerProject, mutantAt, reportOf } from '../tests/strykerProject.ts';
import type { StrykerCall, StrykerResponse } from '../tests/strykerProject.ts';
import type { StrykerConfig } from './mutationConfig.ts';
import { projectVitestConfig, runStrykerReport, viteUrlOf } from './mutationRun.ts';
import type { StrykerRun } from './mutationRun.ts';

const projectWith = async (files: string[]) => {
  const directory = await mkdtemp(join(tmpdir(), 'mutation-run-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  await mkdir(join(directory, 'config'));

  for (const file of files) {
    await writeFile(join(directory, file), '');
  }

  return directory;
};

describe('projectVitestConfig', () => {
  it('resolves an explicit vitest.configFile from the project root', async () => {
    const directory = await projectWith(['vitest.config.ts']);

    const found = projectVitestConfig(directory, {
      mutate: [],
      vitest: { configFile: 'config/own.config.ts' },
    });

    expect(found).toBe(join(directory, 'config/own.config.ts'));
  });

  it.each([
    { files: ['vite.config.ts', 'vitest.config.mts'], expected: 'vitest.config.mts' },
    { files: ['vite.config.js'], expected: 'vite.config.js' },
  ])('finds $expected in the project root', async ({ files, expected }) => {
    const directory = await projectWith(files);

    expect(projectVitestConfig(directory, { mutate: [] })).toBe(join(directory, expected));
  });

  it('finds no config in a project without one', async () => {
    const directory = await projectWith(['package.json']);

    expect(projectVitestConfig(directory, { mutate: [] })).toBeUndefined();
  });
});

// pnpm keeps Vite next to Vitest in its store and links only Vitest into the project.
const pnpmProjectWithViteBehindVitest = async () => {
  const directory = await projectWith(['vitest.config.ts']);
  const store = join(directory, 'node_modules/.pnpm/vitest/node_modules');

  await mkdir(join(store, 'vitest'), { recursive: true });
  await mkdir(join(store, 'vite'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{}');
  await writeFile(join(store, 'vitest/package.json'), '{ "name": "vitest" }');
  await writeFile(join(store, 'vite/package.json'), '{ "name": "vite", "main": "index.mjs" }');

  await writeFile(
    join(store, 'vite/index.mjs'),
    'export const loadConfigFromFile = async () => ({ config: {} });',
  );

  await symlink(join(store, 'vitest'), join(directory, 'node_modules/vitest'));

  return directory;
};

describe('viteUrlOf', () => {
  it('resolves the Vite beside the Vitest of the project', async () => {
    const directory = await pnpmProjectWithViteBehindVitest();

    expect(viteUrlOf(directory)).toMatch(/\/vite\/index\.mjs$/);
  });
});

const bunConfig: StrykerConfig = { mutate: ['src/**/*.ts'], testRunner: 'bun' };

const runOf = (root: string, overrides: Partial<StrykerRun> = {}): StrykerRun => ({
  root,
  config: bunConfig,
  mode: 'changed',
  scopes: [{ path: 'src/a.ts' }],
  sameFolderTests: false,
  mutantsOf: new Map(),
  ...overrides,
});

const temporaryDirectoryOf = (call: StrykerCall | undefined) => dirname(call?.configPath ?? '');

describe('runStrykerReport', () => {
  it('returns the report that Stryker wrote', async () => {
    const report = reportOf({ 'src/a.ts': [mutantAt(1, 'Killed'), mutantAt(2)] });
    const project = await createStrykerProject(onTestFinished, {}, [{ report }]);

    const result = runStrykerReport(runOf(project.root));

    expect(result.files['src/a.ts']?.mutants.map(({ status }) => status)).toEqual([
      'Killed',
      'Survived',
    ]);
  });

  it('runs Stryker from the project root with the scope as its only mutate patterns', async () => {
    const project = await createStrykerProject(onTestFinished, {});

    runStrykerReport(
      runOf(project.root, {
        scopes: [
          {
            path: 'src/a.ts',
            ranges: [
              { start: 1, end: 3 },
              { start: 7, end: 7 },
            ],
          },
          { path: 'src/[b].ts' },
        ],
      }),
    );

    const [call] = await project.calls();

    expect(await realpath(call?.cwd ?? '')).toBe(await realpath(project.root));
    expect(call?.config.mutate).toEqual(['src/a.ts:1-3', 'src/a.ts:7-7', 'src/[[]b].ts']);
  });

  it('passes the output of Stryker to stderr and gives it no input', async () => {
    const project = await createStrykerProject(onTestFinished, {});

    runStrykerReport(runOf(project.root));

    const [call] = await project.calls();

    expect(call?.stdio).toEqual({ inputIsClosed: true, outputIsError: true });
  });

  it('keeps the user config and turns the break threshold off', async () => {
    const project = await createStrykerProject(onTestFinished, {});

    runStrykerReport(
      runOf(project.root, {
        config: { ...bunConfig, thresholds: { high: 90, break: 80 }, concurrency: 3 },
      }),
    );

    const [call] = await project.calls();

    expect(call?.config).toMatchObject({
      concurrency: 3,
      thresholds: { high: 90, break: null },
    });
  });

  it.each([
    { mode: 'audit' as const, disableBail: true },
    { mode: 'changed' as const, disableBail: false },
  ])('sets disableBail to $disableBail in $mode mode', async ({ mode, disableBail }) => {
    const project = await createStrykerProject(onTestFinished, {});

    runStrykerReport(runOf(project.root, { mode }));

    const [call] = await project.calls();

    expect(call?.config['disableBail']).toBe(disableBail);
  });

  it('fails with the exit status when Stryker fails', async () => {
    const project = await createStrykerProject(onTestFinished, {}, [
      { status: 3, report: reportOf({ 'src/a.ts': [mutantAt(1)] }) },
    ]);

    expect(() => runStrykerReport(runOf(project.root))).toThrow(/status 3/);
  });

  it.each([
    { name: 'a report that is not JSON', response: { rawReport: 'not json' }, error: /JSON/ },
    { name: 'a report with no files', response: { rawReport: '{}' }, error: /unusable report/ },
    {
      name: 'a mutant with no location',
      response: { rawReport: '{"files":{"src/a.ts":{"mutants":[{"mutatorName":"x"}]}}}' },
      error: /unusable report/,
    },
    { name: 'no report', response: {}, error: /mutation\.json/ },
  ])('fails on $name', async ({ response, error }) => {
    const project = await createStrykerProject(onTestFinished, {}, [response]);

    expect(() => runStrykerReport(runOf(project.root))).toThrow(error);
  });

  it('removes its temporary files after a run', async () => {
    const project = await createStrykerProject(onTestFinished, {}, [
      { report: reportOf({ 'src/a.ts': [mutantAt(1)] }) },
    ]);

    runStrykerReport(runOf(project.root));

    const [call] = await project.calls();

    expect(call).toBeDefined();
    expect(existsSync(temporaryDirectoryOf(call))).toBe(false);
  });

  it('removes its temporary files after a failed run', async () => {
    const project = await createStrykerProject(onTestFinished, {}, [{ status: 1 }]);

    expect(() => runStrykerReport(runOf(project.root))).toThrow(/status 1/);

    const [call] = await project.calls();

    expect(call).toBeDefined();
    expect(existsSync(temporaryDirectoryOf(call))).toBe(false);
  });
});

const folderProject = (responses: StrykerResponse[] = [{ report: { files: {} } }]) =>
  createStrykerProject(
    onTestFinished,
    {
      'src/a/a.ts': 'export const a = 1;\n',
      'src/a/a.test.ts': '',
      'src/a/a.test.tsx': '',
      'src/a/a.spec.ts': '',
      'src/a/a.test.js': '',
      'src/b/b.ts': 'export const b = 1;\n',
      'src/b/b.test.ts': '',
      'src/c/c.ts': 'export const c = 1;\n',
    },
    responses,
  );

describe('runStrykerReport with sameFolderTests', () => {
  it('runs Stryker once per folder with only the unit tests of that folder', async () => {
    const project = await folderProject();

    runStrykerReport(
      runOf(project.root, {
        sameFolderTests: true,
        scopes: [{ path: 'src/b/b.ts' }, { path: 'src/a/a.ts' }],
      }),
    );

    const calls = await project.calls();

    expect(calls.map(({ config }) => config.mutate)).toEqual([['src/a/a.ts'], ['src/b/b.ts']]);

    expect(calls.map(({ config }) => config.bun?.testFiles)).toEqual([
      ['src/a/a.test.ts', 'src/a/a.test.tsx'],
      ['src/b/b.test.ts'],
    ]);
  });

  it('runs one folder once for all of its files', async () => {
    const project = await folderProject();

    runStrykerReport(
      runOf(project.root, {
        sameFolderTests: true,
        scopes: [{ path: 'src/a/a.ts' }, { path: 'src/a/other.ts' }],
      }),
    );

    const calls = await project.calls();

    expect(calls.map(({ config }) => config.mutate)).toEqual([['src/a/a.ts', 'src/a/other.ts']]);
  });

  it('merges the reports of the folder runs', async () => {
    const project = await folderProject([
      { report: reportOf({ 'src/a/a.ts': [mutantAt(1, 'Killed')] }) },
      { report: reportOf({ 'src/b/b.ts': [mutantAt(1)] }) },
    ]);

    const result = runStrykerReport(
      runOf(project.root, {
        sameFolderTests: true,
        scopes: [{ path: 'src/a/a.ts' }, { path: 'src/b/b.ts' }],
      }),
    );

    expect(Object.keys(result.files)).toEqual(['src/a/a.ts', 'src/b/b.ts']);
    expect(result.files['src/a/a.ts']?.mutants[0]?.status).toBe('Killed');
    expect(result.files['src/b/b.ts']?.mutants[0]?.status).toBe('Survived');
  });

  it('gives a folder with no unit test its mutants as not covered, without a run', async () => {
    const project = await folderProject();

    const instrumented = [
      {
        mutatorName: 'ArithmeticOperator',
        replacement: '-',
        status: 'Ignored',
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 4 } },
      },
      {
        mutatorName: 'BooleanLiteral',
        replacement: 'false',
        location: { start: { line: 2, column: 6 }, end: { line: 3, column: 9 } },
      },
    ];

    const result = runStrykerReport(
      runOf(project.root, {
        sameFolderTests: true,
        scopes: [{ path: 'src/c/c.ts' }],
        mutantsOf: new Map([['src/c/c.ts', instrumented]]),
      }),
    );

    expect(await project.calls()).toEqual([]);

    expect(result.files['src/c/c.ts']?.mutants).toEqual([
      {
        mutatorName: 'BooleanLiteral',
        replacement: 'false',
        status: 'NoCoverage',
        location: { start: { line: 3, column: 7 }, end: { line: 4, column: 10 } },
      },
    ]);
  });

  it('reports a folder with no unit test and no mutants as an empty file', async () => {
    const project = await folderProject();

    const result = runStrykerReport(
      runOf(project.root, { sameFolderTests: true, scopes: [{ path: 'src/c/c.ts' }] }),
    );

    expect(result.files['src/c/c.ts']).toEqual({ mutants: [] });
  });

  it('runs the folders with tests and reports the others as not covered', async () => {
    const project = await folderProject([{ report: reportOf({ 'src/a/a.ts': [mutantAt(1)] }) }]);
    const uncovered = [{ mutatorName: 'x', replacement: 'y', location: mutantAt(1).location }];

    const result = runStrykerReport(
      runOf(project.root, {
        sameFolderTests: true,
        scopes: [{ path: 'src/a/a.ts' }, { path: 'src/c/c.ts' }],
        mutantsOf: new Map([['src/c/c.ts', uncovered]]),
      }),
    );

    expect((await project.calls()).length).toBe(1);
    expect(result.files['src/a/a.ts']?.mutants[0]?.status).toBe('Survived');
    expect(result.files['src/c/c.ts']?.mutants[0]?.status).toBe('NoCoverage');
  });

  it('refuses a test runner other than Vitest or Bun before any run', async () => {
    const project = await folderProject();

    expect(() =>
      runStrykerReport(
        runOf(project.root, {
          sameFolderTests: true,
          config: { mutate: ['src/**/*.ts'] },
          scopes: [{ path: 'src/a/a.ts' }],
        }),
      ),
    ).toThrow(/testRunner/);

    expect(await project.calls()).toEqual([]);
  });

  it('refuses a missing test runner when no folder has unit tests', async () => {
    const project = await folderProject();

    expect(() =>
      runStrykerReport(
        runOf(project.root, {
          sameFolderTests: true,
          config: { mutate: ['src/**/*.ts'] },
          scopes: [{ path: 'src/c/c.ts' }],
        }),
      ),
    ).toThrow(/testRunner/);
  });

  it('does not look for Vite with the Bun runner', async () => {
    const project = await folderProject();

    await project.write({ ...blockedResolution, 'vitest.config.ts': '{}' });

    expect(() =>
      runStrykerReport(
        runOf(project.root, { sameFolderTests: true, scopes: [{ path: 'src/a/a.ts' }] }),
      ),
    ).not.toThrow();
  });

  it('removes its temporary files after the folder runs', async () => {
    const project = await folderProject();

    runStrykerReport(
      runOf(project.root, { sameFolderTests: true, scopes: [{ path: 'src/a/a.ts' }] }),
    );

    const [call] = await project.calls();

    expect(call).toBeDefined();
    expect(existsSync(temporaryDirectoryOf(call))).toBe(false);
  });
});

const vitestConfig: StrykerConfig = { mutate: ['src/**/*.ts'], testRunner: 'vitest' };

const vitestRun = (root: string): StrykerRun =>
  runOf(root, { config: vitestConfig, sameFolderTests: true, scopes: [{ path: 'src/a/a.ts' }] });

// Packages that stop Vite and Vitest from resolving beyond the fixture.
const blockedResolution = {
  'node_modules/vitest/package.json': '{ "name": "vitest", "exports": {} }',
  'node_modules/vite/package.json': '{ "name": "vite", "exports": {} }',
};

// A stand-in for Vite whose config loader reads the config file as JSON.
const fakeVite = {
  'node_modules/vitest/package.json': '{ "name": "vitest", "exports": {} }',
  'node_modules/vite/package.json': '{ "name": "vite", "main": "index.mjs", "type": "module" }',
  'node_modules/vite/index.mjs': `import { readFileSync } from 'node:fs';

export const loadConfigFromFile = async (environment, path) => {
  const text = readFileSync(path, 'utf8');

  return text === 'null' ? null : { config: JSON.parse(text) };
};
`,
};

describe('runStrykerReport with sameFolderTests and the Vitest runner', () => {
  it('limits Vitest to the unit tests of the folder when the project has no config', async () => {
    const project = await folderProject([{ loadVitestConfig: true, report: { files: {} } }]);

    runStrykerReport(vitestRun(project.root));

    const [call] = await project.calls();

    expect(call?.vitestConfig?.['test']).toEqual({
      include: ['src/a/a.test.ts', 'src/a/a.test.tsx'],
      includeSource: [],
    });

    expect(call?.config.vitest?.related).toBe(false);
  });

  it('keeps the settings of the project config and reads the tests from its root', async () => {
    const project = await folderProject([{ loadVitestConfig: true, report: { files: {} } }]);

    await project.write({
      ...fakeVite,
      'vitest.config.ts': JSON.stringify({
        resolve: { alias: { x: 'y' } },
        test: { root: 'src', setupFiles: ['setup.ts'], includeSource: ['z.ts'] },
      }),
    });

    runStrykerReport(vitestRun(project.root));

    const [call] = await project.calls();

    expect(call?.vitestConfig).toEqual({
      resolve: { alias: { x: 'y' } },
      test: {
        root: 'src',
        setupFiles: ['setup.ts'],
        include: ['a/a.test.ts', 'a/a.test.tsx'],
        includeSource: [],
      },
    });
  });

  it('uses the config file that the Stryker config names', async () => {
    const project = await folderProject([{ loadVitestConfig: true, report: { files: {} } }]);

    await project.write({ ...fakeVite, 'own.config.ts': '{ "define": { "own": true } }' });

    runStrykerReport(
      runOf(project.root, {
        config: { ...vitestConfig, vitest: { configFile: 'own.config.ts' } },
        sameFolderTests: true,
        scopes: [{ path: 'src/a/a.ts' }],
      }),
    );

    const [call] = await project.calls();

    expect(call?.vitestConfig?.['define']).toEqual({ own: true });
  });

  it.each(['projects', 'workspace'])(
    'refuses a project config that sets test.%s and names the file',
    async (setting) => {
      const project = await folderProject([{ loadVitestConfig: true, report: { files: {} } }]);

      await project.write({
        ...fakeVite,
        'vitest.config.ts': JSON.stringify({ test: { [setting]: [] } }),
      });

      expect(() => runStrykerReport(vitestRun(project.root))).toThrow(
        new RegExp(`vitest\\.config\\.ts.*test\\.${setting}`),
      );
    },
  );

  it('keeps the Stryker failure as the cause of a refused setting', async () => {
    const project = await folderProject([{ loadVitestConfig: true, report: { files: {} } }]);

    await project.write({ ...fakeVite, 'vitest.config.ts': '{ "test": { "projects": [] } }' });

    let failure: unknown;

    try {
      runStrykerReport(vitestRun(project.root));
    } catch (error) {
      failure = error;
    }

    expect(failure).toHaveProperty('cause.message', expect.stringMatching(/status 1/));
  });

  it('fails with the Stryker error when the config does not load', async () => {
    const project = await folderProject([{ loadVitestConfig: true, report: { files: {} } }]);

    await project.write({ ...fakeVite, 'vitest.config.ts': 'null' });

    expect(() => runStrykerReport(vitestRun(project.root))).toThrow(/status 1/);
  });

  it('fails when a test file lies outside the Vitest root', async () => {
    const project = await folderProject([{ loadVitestConfig: true, report: { files: {} } }]);

    await project.write({
      ...fakeVite,
      'vitest.config.ts': JSON.stringify({ test: { root: 'src/b' } }),
    });

    expect(() => runStrykerReport(vitestRun(project.root))).toThrow(/status 1/);
  });

  it('fails when Vite cannot be found for the project config', async () => {
    const project = await folderProject();

    await project.write({ ...blockedResolution, 'vitest.config.ts': '{}' });

    expect(() => runStrykerReport(vitestRun(project.root))).toThrow(/vite/);
    expect(await project.calls()).toEqual([]);
  });
});
