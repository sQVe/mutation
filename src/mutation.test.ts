import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { commitAll, createStrykerProject, mutantAt, reportOf } from '../tests/strykerProject.ts';
import type { StrykerResponse } from '../tests/strykerProject.ts';
import { instrumentScope, mutate } from './mutation.ts';
import type { Command } from './mutationScope.ts';

const projectWith = async (path: string, content: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'mutation-instrument-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  await writeFile(join(directory, path), content);

  return directory;
};

describe('instrumentScope', () => {
  it('parses with the Babel plugins the config sets', async () => {
    const root = await projectWith(
      'flow.js',
      'export const next = (value: number) => value + 1;\n',
    );

    const mutants = await instrumentScope(
      root,
      { path: 'flow.js' },
      { mutate: ['flow.js'], mutator: { plugins: ['flow'] } },
    );

    expect(mutants.map(({ mutatorName }) => mutatorName)).toContain('ArithmeticOperator');
  });
});

const math = `export const add = (left: number, right: number) => left + right;

export const negate = (value: number) => -value;
`;

const label = "export const label = (count: number) => (count > 1 ? 'items' : 'item');\n";

const strykerConfig = {
  testRunner: 'bun',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  ignorePatterns: ['src/generated'],
};

const withConfig = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...strykerConfig, ...overrides });

const strykerProjectWith = (
  files: Record<string, string> = {},
  responses: StrykerResponse[] = [{ report: reportOf({ 'src/math.ts': [mutantAt(3)] }) }],
  config: Record<string, unknown> = {},
) =>
  createStrykerProject(
    onTestFinished,
    {
      'stryker.config.json': withConfig(config),
      'src/math.ts': math,
      'src/math.test.ts': '',
      ...files,
    },
    responses,
  );

const changed = (overrides: Partial<Command> = {}): Command => ({
  mode: 'changed',
  paths: [],
  sameFolderTests: false,
  ...overrides,
});

const audit = (paths: string[], overrides: Partial<Command> = {}): Command => ({
  mode: 'audit',
  paths,
  sameFolderTests: false,
  ...overrides,
});

const editMath = (root: string) =>
  writeFile(
    join(root, 'src/math.ts'),
    `${math}// edit\n\nexport const twice = (value: number) => value * 2;\n`,
  );

describe('mutate in changed mode', () => {
  it('runs no Stryker and reports nothing when nothing changed', async () => {
    const project = await strykerProjectWith();

    const { report, exitCode } = await mutate(changed(), project.root);

    expect(await project.calls()).toEqual([]);
    expect(report).toMatchObject({ mode: 'changed', status: 'nothing', survivors: [] });
    expect(exitCode).toBe(0);
  });

  it('mutates only the changed lines of a tracked file and reports the survivors', async () => {
    const project = await strykerProjectWith();

    await writeFile(join(project.root, 'src/math.ts'), math.replace('-value', '0 - value'));

    const { report, exitCode } = await mutate(changed(), project.root);
    const calls = await project.calls();

    expect(calls.map(({ config }) => config.mutate)).toEqual([['src/math.ts:3-3']]);
    expect(report.status).toBe('survivors');
    expect(report.survivors.map(({ file, line }) => `${file}:${line}`)).toEqual(['src/math.ts:3']);
    expect(report.survivors[0]?.original).toBe('expo');
    expect(exitCode).toBe(2);
  });

  it('mutates the whole of an untracked file', async () => {
    const project = await strykerProjectWith({}, [
      { report: reportOf({ 'src/label.ts': [mutantAt(1)] }) },
    ]);

    await project.write({ 'src/label.ts': label });

    const { report } = await mutate(changed(), project.root);
    const calls = await project.calls();

    expect(calls.map(({ config }) => config.mutate)).toEqual([['src/label.ts']]);
    expect(report.survivors.map(({ file }) => file)).toEqual(['src/label.ts']);
  });

  it('diffs against HEAD by default and against the base when given', async () => {
    const project = await strykerProjectWith();

    await editMath(project.root);
    await commitAll(project.root, 'edit');

    const head = await mutate(changed(), project.root);
    const sinceBase = await mutate(changed({ base: 'HEAD~1' }), project.root);
    const calls = await project.calls();

    expect(head.report.status).toBe('nothing');
    expect(calls.map(({ config }) => config.mutate)).toEqual([['src/math.ts:4-6']]);
    expect(sinceBase.report.status).toBe('survivors');
  });

  it('fails on a base that does not exist', async () => {
    const project = await strykerProjectWith();

    await expect(mutate(changed({ base: 'no-such-ref' }), project.root)).rejects.toThrow(
      /no-such-ref/,
    );
  });

  it('skips changed files that are not production code', async () => {
    const project = await strykerProjectWith();

    await project.write({
      'src/math.test.ts': 'export const changed = 1;\n',
      'src/generated/output.ts': label,
      'README.md': 'changed\n',
      'lib/other.ts': label,
    });

    const { report } = await mutate(changed(), project.root);

    expect(await project.calls()).toEqual([]);
    expect(report.status).toBe('nothing');
  });

  it('finds the repository and its config from a folder inside it', async () => {
    const project = await strykerProjectWith();

    await editMath(project.root);

    const { report } = await mutate(changed(), join(project.root, 'src'));

    expect(report.survivors.map(({ file }) => file)).toEqual(['src/math.ts']);
  });

  it('fails outside a Git repository', async () => {
    const project = await strykerProjectWith();

    await expect(mutate(changed(), join(project.root, '..'))).rejects.toThrow(
      /not a git repository/i,
    );
  });
});

describe('mutate with a config', () => {
  it('reads stryker.config.json from the repository root by default', async () => {
    const project = await strykerProjectWith({ 'src/label.ts': label });

    const { report } = await mutate(audit(['src/math.ts']), project.root);

    expect(report.mode).toBe('audit');
    expect(await project.calls()).toHaveLength(1);
  });

  it('reads the config that configPath names, relative to the repository root', async () => {
    const project = await strykerProjectWith({
      'config/own.json': withConfig({ mutate: ['src/label.ts'] }),
      'src/label.ts': label,
    });

    await expect(
      mutate(audit(['src/math.ts'], { configPath: 'config/own.json' }), project.root),
    ).rejects.toThrow(/src\/math\.ts/);

    await mutate(audit(['src/label.ts'], { configPath: 'config/own.json' }), project.root);

    expect(await project.calls()).toHaveLength(1);
  });

  it('fails when the config file is missing', async () => {
    const project = await strykerProjectWith();

    await expect(
      mutate(audit(['src/math.ts'], { configPath: 'missing.json' }), project.root),
    ).rejects.toThrow(/missing\.json/);
  });

  it.each([
    { name: 'has no mutate list', content: '{}' },
    { name: 'has a mutate list of non-strings', content: '{ "mutate": [1] }' },
    { name: 'has an empty mutate list', content: '{ "mutate": [] }' },
    { name: 'has only negated mutate globs', content: '{ "mutate": ["!src/**"] }' },
  ])('fails when the config $name and runs no Stryker', async ({ content }) => {
    const project = await strykerProjectWith({ 'bad.json': content });

    await expect(
      mutate(audit(['src/math.ts'], { configPath: 'bad.json' }), project.root),
    ).rejects.toThrow(/bad\.json/);

    expect(await project.calls()).toEqual([]);
  });

  it('fails when the config is not JSON', async () => {
    const project = await strykerProjectWith({ 'bad.json': 'not json' });

    await expect(
      mutate(audit(['src/math.ts'], { configPath: 'bad.json' }), project.root),
    ).rejects.toThrow(/JSON/);

    expect(await project.calls()).toEqual([]);
  });

  it('names the config file in the error for an unusable config', async () => {
    const project = await strykerProjectWith({ 'bad.json': '{ "mutate": [1] }' });

    await expect(
      mutate(audit(['src/math.ts'], { configPath: 'bad.json' }), project.root),
    ).rejects.toThrow(/bad\.json/);
  });

  it.each([
    { name: 'maxMutants', overrides: { maxMutants: 10 } },
    { name: 'sameFolderTests', overrides: { sameFolderTests: true } },
  ])('refuses an ignorer other than the built-in one with $name', async ({ overrides }) => {
    const project = await strykerProjectWith({}, undefined, { ignorers: ['customIgnorer'] });

    await expect(mutate(audit(['src/math.ts'], overrides), project.root)).rejects.toThrow(
      /customIgnorer/,
    );

    expect(await project.calls()).toEqual([]);
  });

  it('accepts another ignorer when neither option needs the instrumented mutants', async () => {
    const project = await strykerProjectWith({}, undefined, { ignorers: ['customIgnorer'] });

    await mutate(audit(['src/math.ts']), project.root);

    expect(await project.calls()).toHaveLength(1);
  });

  it('hands the shared defaults and the scope to Stryker', async () => {
    const project = await strykerProjectWith();

    await mutate(audit(['src/math.ts']), project.root);

    const [call] = await project.calls();

    expect(call?.config).toMatchObject({
      mutate: ['src/math.ts'],
      testRunner: 'bun',
      ignoreStatic: true,
      disableBail: true,
    });

    expect(call?.config['ignorers']).toContain('tauMessageIgnorer');
  });
});

describe('mutate in changed mode with a mutant cap', () => {
  it('counts only the mutants on the changed lines', async () => {
    const project = await strykerProjectWith({}, [
      { report: reportOf({ 'src/math.ts': [mutantAt(1)] }) },
    ]);

    await writeFile(
      join(project.root, 'src/math.ts'),
      math.replace('left + right', 'right + left'),
    );

    const { report } = await mutate(changed({ maxMutants: 2 }), project.root);

    expect(report.unmutated).toEqual([]);
    expect(await project.calls()).toHaveLength(1);
  });
});

describe('mutate with a mutate glob that matches every path', () => {
  it('ignores the empty entry that follows the last untracked file', async () => {
    const project = await strykerProjectWith({}, undefined, { mutate: ['**'] });

    await project.write({ 'src/label.ts': label });

    await expect(mutate(changed(), project.root)).resolves.toBeDefined();
  });
});

describe('mutate in audit mode', () => {
  it('mutates whole files and exits 0 with survivors', async () => {
    const project = await strykerProjectWith();

    const { report, exitCode } = await mutate(audit(['src/math.ts']), project.root);
    const calls = await project.calls();

    expect(calls.map(({ config }) => config.mutate)).toEqual([['src/math.ts']]);
    expect(report).toMatchObject({ mode: 'audit', status: 'survivors' });
    expect(exitCode).toBe(0);
  });

  it('resolves the paths from the given working directory', async () => {
    const project = await strykerProjectWith();

    await mutate(audit(['math.ts']), join(project.root, 'src'));

    const [call] = await project.calls();

    expect(call?.config.mutate).toEqual(['src/math.ts']);
  });

  it('mutates a path once however often it is named', async () => {
    const project = await strykerProjectWith();

    await mutate(audit(['src/math.ts', './src/math.ts']), project.root);

    const [call] = await project.calls();

    expect(call?.config.mutate).toEqual(['src/math.ts']);
  });

  it.each([
    { name: 'a test file', path: 'src/math.test.ts' },
    { name: 'a file outside the mutate globs', path: 'README.md' },
    { name: 'an ignored file', path: 'src/generated/output.ts' },
    { name: 'a file outside the repository', path: '../outside.ts' },
  ])('rejects $name and names it', async ({ path }) => {
    const project = await strykerProjectWith();

    await expect(mutate(audit(['src/math.ts', path]), project.root)).rejects.toThrow(path);

    expect(await project.calls()).toEqual([]);
  });

  it('reports a pass when Stryker kills every mutant', async () => {
    const project = await strykerProjectWith({}, [
      { report: reportOf({ 'src/math.ts': [mutantAt(1, 'Killed')] }) },
    ]);

    const { report, exitCode } = await mutate(audit(['src/math.ts']), project.root);

    expect(report.status).toBe('pass');
    expect(report.totals).toMatchObject({ mutants: 1, killed: 1 });
    expect(exitCode).toBe(0);
  });

  it('fails when Stryker fails', async () => {
    const project = await strykerProjectWith({}, [{ status: 2 }]);

    await expect(mutate(audit(['src/math.ts']), project.root)).rejects.toThrow(/status 2/);
  });
});

describe('mutate with a mutant cap', () => {
  const twoFiles = { 'src/label.ts': label };

  const bothReported = [
    {
      report: reportOf({ 'src/math.ts': [mutantAt(1)], 'src/label.ts': [mutantAt(1)] }),
    },
  ];

  it('runs every file that fits and lists the others as unmutated', async () => {
    const project = await strykerProjectWith(twoFiles, bothReported);

    const { report, exitCode } = await mutate(
      audit(['src/label.ts', 'src/math.ts'], { maxMutants: 5 }),
      project.root,
    );

    const [call] = await project.calls();

    expect(call?.config.mutate).toEqual(['src/math.ts']);
    expect(report.unmutated).toEqual(['src/label.ts']);
    expect(report.status).toBe('error');
    expect(exitCode).toBe(1);
  });

  it('runs a later file that fits after an earlier one that does not', async () => {
    const project = await strykerProjectWith(twoFiles, bothReported);

    const { report } = await mutate(
      audit(['src/label.ts', 'src/math.ts'], { maxMutants: 6 }),
      project.root,
    );

    const [call] = await project.calls();

    expect(call?.config.mutate).toEqual(['src/math.ts']);
    expect(report.unmutated).toEqual(['src/label.ts']);
  });

  it('runs all files when the cap equals their mutants', async () => {
    const project = await strykerProjectWith(twoFiles, bothReported);

    const { report } = await mutate(
      audit(['src/label.ts', 'src/math.ts'], { maxMutants: 11 }),
      project.root,
    );

    const [call] = await project.calls();

    expect(call?.config.mutate).toEqual(['src/label.ts', 'src/math.ts']);
    expect(report.unmutated).toEqual([]);
  });

  it('runs no Stryker when no file fits', async () => {
    const project = await strykerProjectWith(twoFiles);

    const { report } = await mutate(
      audit(['src/label.ts', 'src/math.ts'], { maxMutants: 1 }),
      project.root,
    );

    expect(await project.calls()).toEqual([]);
    expect(report.unmutated).toEqual(['src/label.ts', 'src/math.ts']);
  });

  it('lists the unmutated files in sorted order', async () => {
    const project = await strykerProjectWith({ ...twoFiles, 'src/a.ts': label });

    const { report } = await mutate(
      audit(['src/math.ts', 'src/label.ts', 'src/a.ts'], { maxMutants: 1 }),
      project.root,
    );

    expect(report.unmutated).toEqual(['src/a.ts', 'src/label.ts', 'src/math.ts']);
  });

  it('does not count mutants that the config excludes', async () => {
    const project = await strykerProjectWith({}, undefined, {
      mutator: { excludedMutations: ['ArrowFunction'] },
    });

    const { report } = await mutate(audit(['src/math.ts'], { maxMutants: 2 }), project.root);

    expect(report.unmutated).toEqual([]);
    expect(await project.calls()).toHaveLength(1);
  });

  it('does not count mutants that the built-in ignorer skips', async () => {
    const project = await strykerProjectWith(
      {
        'src/fail.ts': "export const fail = (x: Error) => {\n  throw x ?? new Error('nope');\n};\n",
      },
      [{ report: reportOf({ 'src/fail.ts': [mutantAt(1)] }) }],
    );

    const { report } = await mutate(audit(['src/fail.ts'], { maxMutants: 2 }), project.root);

    expect(report.unmutated).toEqual([]);
  });
});

describe('mutate with files that have no mutants', () => {
  it('runs no Stryker for a file with no mutants', async () => {
    const project = await strykerProjectWith({ 'src/type.ts': 'export type Name = string;\n' });

    const { report, exitCode } = await mutate(audit(['src/type.ts']), project.root);

    expect(await project.calls()).toEqual([]);
    expect(report).toMatchObject({ status: 'nothing', unmutated: [] });
    expect(exitCode).toBe(0);
  });

  it('lists a file with mutants that the Stryker report leaves out', async () => {
    const project = await strykerProjectWith({ 'src/label.ts': label });

    const { report, exitCode } = await mutate(audit(['src/math.ts', 'src/label.ts']), project.root);

    expect(report.unmutated).toEqual(['src/label.ts']);
    expect(report.status).toBe('error');
    expect(exitCode).toBe(1);
  });

  it('lists a file that the Stryker report names with no mutant', async () => {
    const project = await strykerProjectWith({}, [{ report: reportOf({ 'src/math.ts': [] }) }]);

    const { report } = await mutate(audit(['src/math.ts']), project.root);

    expect(report.unmutated).toEqual(['src/math.ts']);
  });
});

describe('mutate with a backslash in a file name', () => {
  it('maps the report key back to the tracked path', async () => {
    const project = await strykerProjectWith({ 'src/we\\ird.ts': math }, [
      { report: reportOf({ 'src/we/ird.ts': [mutantAt(3)] }) },
    ]);

    const { report } = await mutate(audit(['src/we\\ird.ts']), project.root);

    expect(report.survivors.map(({ file }) => file)).toEqual(['src/we\\ird.ts']);
  });
});

describe('mutate with sameFolderTests', () => {
  it('runs a folder with unit tests alone and gives other folders uncovered mutants', async () => {
    const project = await strykerProjectWith({ 'src/label.ts': label, 'src/deep/deep.ts': label }, [
      { report: reportOf({ 'src/math.ts': [mutantAt(1, 'Killed')] }) },
    ]);

    const { report } = await mutate(
      audit(['src/math.ts', 'src/deep/deep.ts'], { sameFolderTests: true }),
      project.root,
    );

    const calls = await project.calls();

    expect(calls.map(({ config }) => config.mutate)).toEqual([['src/math.ts']]);
    expect(calls.map(({ config }) => config.bun?.testFiles)).toEqual([['src/math.test.ts']]);
    expect(report.survivors).toHaveLength(7);

    expect(
      report.survivors.every(({ file, covered }) => file === 'src/deep/deep.ts' && !covered),
    ).toBe(true);

    expect(report.survivors.map(({ line }) => line)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('mutate with a config that sets no ignorePatterns', () => {
  it('reports the mutants of a production file in any folder', async () => {
    const project = await strykerProjectWith(
      { 'src/Stryker was here/math.ts': math },
      [{ report: reportOf({ 'src/Stryker was here/math.ts': [mutantAt(3)] }) }],
      { ignorePatterns: undefined },
    );

    const { report } = await mutate(audit(['src/Stryker was here/math.ts']), project.root);

    expect(report.survivors.map(({ file }) => file)).toEqual(['src/Stryker was here/math.ts']);
  });
});
