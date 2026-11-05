import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createStrykerProject, mutantAt, reportOf } from '../tests/strykerProject.ts';
import { runCli } from './mutationCli.ts';
import type { CliProcess } from './mutationCli.ts';
import type { MutationOutcome } from './mutationReport.ts';

const config = JSON.stringify({ testRunner: 'bun', mutate: ['src/**/*.ts'] });

const projectWithSurvivor = () =>
  createStrykerProject(
    onTestFinished,
    { 'stryker.config.json': config, 'src/math.ts': 'export const negate = (v: number) => -v;\n' },
    [{ report: reportOf({ 'src/math.ts': [mutantAt(1)] }) }],
  );

const runWith = async (cwd: string, ...args: string[]) => {
  const written: string[] = [];

  const cliProcess: CliProcess = {
    argv: ['node', 'mutation', ...args],
    cwd: () => cwd,
    stdout: { write: (text) => written.push(text) },
    exitCode: undefined,
  };

  await runCli(cliProcess);

  const output = written.join('');

  // SAFETY: the command prints one MutationOutcome as JSON.
  const report = JSON.parse(output) as MutationOutcome;

  return { output, report, exitCode: cliProcess.exitCode, writes: written.length };
};

describe('runCli', () => {
  it('prints the report once as JSON and exits 0 for audit survivors', async () => {
    const project = await projectWithSurvivor();

    const { output, report, exitCode, writes } = await runWith(
      project.root,
      'audit',
      'src/math.ts',
    );

    expect(writes).toBe(1);
    expect(output.endsWith('}\n')).toBe(true);
    expect(output).toBe(`${JSON.stringify(report, undefined, 2)}\n`);
    expect(report).toMatchObject({ mode: 'audit', status: 'survivors' });
    expect(report.survivors.map(({ file }) => file)).toEqual(['src/math.ts']);
    expect(exitCode).toBe(0);
  });

  it('exits 2 for changed survivors', async () => {
    const project = await projectWithSurvivor();

    await project.write({ 'src/math.ts': 'export const negate = (v: number) => -v + 0;\n' });

    const { report, exitCode } = await runWith(project.root, 'changed', 'HEAD');

    expect(report).toMatchObject({ mode: 'changed', status: 'survivors' });
    expect(exitCode).toBe(2);
  });

  it('reads options from the arguments', async () => {
    const project = await projectWithSurvivor();

    const { report } = await runWith(project.root, '--max-mutants', '1', 'audit', 'src/math.ts');

    expect(report.unmutated).toEqual(['src/math.ts']);
  });

  it('runs in the working directory of the process', async () => {
    const project = await projectWithSurvivor();

    await runWith(project.root, 'audit', 'src/math.ts');

    expect(await project.calls()).toHaveLength(1);
  });

  it('reports an unknown mode as a failed report with no mode and exits 1', async () => {
    const project = await projectWithSurvivor();

    const { report, exitCode } = await runWith(project.root, 'explode');

    expect(report).toMatchObject({ mode: null, status: 'error', survivors: [] });
    expect(report.error).toContain('explode');
    expect(exitCode).toBe(1);
  });

  it('reports a run failure with the mode that was parsed', async () => {
    const project = await projectWithSurvivor();

    const { report, exitCode } = await runWith(
      project.root,
      '--config',
      'missing.json',
      'audit',
      'src/math.ts',
    );

    expect(report).toMatchObject({ mode: 'audit', status: 'error', testsWithNoUniqueKill: [] });
    expect(report.error).toContain('missing.json');
    expect(exitCode).toBe(1);
  });

  it('reports a failing Stryker as an error and exits 1', async () => {
    const project = await createStrykerProject(
      onTestFinished,
      {
        'stryker.config.json': config,
        'src/math.ts': 'export const negate = (v: number) => -v;\n',
      },
      [{ status: 4 }],
    );

    const { report, exitCode } = await runWith(project.root, 'audit', 'src/math.ts');

    expect(report).toMatchObject({ mode: 'audit', status: 'error' });
    expect(report.error).toContain('4');
    expect(exitCode).toBe(1);
  });
});

const survivorAt = (fields: Record<string, unknown> = {}) => ({
  file: 'src/a.ts',
  line: 2,
  column: 3,
  endLine: 2,
  endColumn: 4,
  mutator: 'ConditionalExpression',
  group: 'controlFlow',
  original: 'a',
  replacement: 'b',
  covered: true,
  ...fields,
});

const sharedReport = (fields: Record<string, unknown> = {}) => ({
  version: 1,
  status: 'survivors',
  survivors: [],
  falseSurvivors: [],
  totals: { mutants: 1, killed: 0, survived: 1, noCoverage: 0, timeout: 0, invalid: 0 },
  ...fields,
});

const reportDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'mutation-report-cli-'));

  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  return directory;
};

const runReport = async (...args: string[]) => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const cliProcess: CliProcess = {
    argv: ['node', 'mutation', ...args],
    cwd: () => process.cwd(),
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
    exitCode: undefined,
  };

  await runCli(cliProcess);

  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode: cliProcess.exitCode };
};

describe('runCli report', () => {
  it.each([
    { status: 'pass', exitCode: 0 },
    { status: 'nothing', exitCode: 0 },
    { status: 'survivors', exitCode: 0 },
    { status: 'error', exitCode: 1 },
  ])('exits $exitCode for status $status', async ({ status, exitCode }) => {
    const directory = reportDirectory();
    const reportPath = join(directory, 'report.json');
    const fields = status === 'error' ? { error: 'boom' } : {};

    writeFileSync(reportPath, JSON.stringify(sharedReport({ status, ...fields })));

    expect((await runReport('report', reportPath)).exitCode).toBe(exitCode);
  });

  it('prints one warning per survivor and writes Markdown when asked', async () => {
    const directory = reportDirectory();
    const reportPath = join(directory, 'report.json');
    const markdownPath = join(directory, 'report.md');

    writeFileSync(reportPath, JSON.stringify(sharedReport({ survivors: [survivorAt()] })));

    const { stdout, exitCode } = await runReport('report', reportPath, '--markdown', markdownPath);

    expect(exitCode).toBe(0);

    expect(stdout).toBe(
      '::warning file=src/a.ts,line=2,col=3,endLine=2,endColumn=4,title=Mutation survivor (High)::ConditionalExpression: a => b\n',
    );

    expect(readFileSync(markdownPath, 'utf8')).toContain('### High');
  });

  it('exits 1 and writes Markdown and stderr for a missing file', async () => {
    const directory = reportDirectory();
    const markdownPath = join(directory, 'report.md');
    const reportPath = join(directory, 'missing.json');
    const reason = `ENOENT: no such file or directory, open '${reportPath}'`;

    const { exitCode, stderr } = await runReport('report', reportPath, '--markdown', markdownPath);

    expect(exitCode).toBe(1);
    expect(stderr).toBe(`${reason}\n`);

    expect(readFileSync(markdownPath, 'utf8')).toBe(
      `<!-- sqve/mutation report -->\n## Mutation report\n\nCould not read the report: ${reason}\n`,
    );
  });

  it('exits 1 for invalid JSON and for an invalid shape', async () => {
    const directory = reportDirectory();
    const invalidJson = join(directory, 'invalid.json');
    const invalidShape = join(directory, 'shape.json');

    writeFileSync(invalidJson, '{');
    writeFileSync(invalidShape, JSON.stringify(sharedReport({ survivors: [{ file: 'a' }] })));

    expect((await runReport('report', invalidJson)).exitCode).toBe(1);
    expect((await runReport('report', invalidShape)).exitCode).toBe(1);
  });

  it('exits 1 for a usage error', async () => {
    const { exitCode, stderr } = await runReport('report');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('report needs a report file');
  });

  it.each(['line', 'column', 'endLine', 'endColumn'])(
    'exits 1 with no annotation for %s below 1',
    async (coordinate) => {
      const directory = reportDirectory();
      const reportPath = join(directory, 'report.json');
      const markdownPath = join(directory, 'report.md');

      writeFileSync(
        reportPath,
        JSON.stringify(sharedReport({ survivors: [survivorAt({ [coordinate]: 0 })] })),
      );

      const { stdout, exitCode } = await runReport(
        'report',
        reportPath,
        '--markdown',
        markdownPath,
      );

      expect(exitCode).toBe(1);
      expect(stdout).not.toContain('::warning');
      expect(readFileSync(markdownPath, 'utf8')).toContain('Could not read the report:');
    },
  );

  it('exits 1 with no annotation for a file path with a line break', async () => {
    const directory = reportDirectory();
    const reportPath = join(directory, 'report.json');
    const markdownPath = join(directory, 'report.md');
    const file = 'src/a\n\n# injected heading\n\nb.ts';

    writeFileSync(reportPath, JSON.stringify(sharedReport({ survivors: [survivorAt({ file })] })));

    const { stdout, exitCode } = await runReport('report', reportPath, '--markdown', markdownPath);
    const markdown = readFileSync(markdownPath, 'utf8');

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('::warning');
    expect(markdown).toContain('Could not read the report:');
    expect(markdown).not.toContain('\n# injected heading');
  });

  it('moves a literal survivor to Low when --low-weight matches its file', async () => {
    const directory = reportDirectory();
    const reportPath = join(directory, 'report.json');

    writeFileSync(
      reportPath,
      JSON.stringify(
        sharedReport({
          survivors: [survivorAt({ file: 'src/a.ts', mutator: 'StringLiteral', group: 'literal' })],
        }),
      ),
    );

    const without = await runReport('report', reportPath);
    const withGlob = await runReport('report', reportPath, '--low-weight', 'src/**');

    expect(without.stdout).toContain('Mutation survivor (Medium)');
    expect(withGlob.stdout).toContain('Mutation survivor (Low)');
  });

  it('exits 1 for --low-weight without a value', async () => {
    const { exitCode, stderr } = await runReport('report', 'report.json', '--low-weight');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--low-weight needs a glob');
  });

  it('does not load the Stryker modules for report', async () => {
    vi.resetModules();

    vi.doMock(import('./mutation.ts'), () => {
      throw new Error('mutation.ts loaded');
    });

    const directory = reportDirectory();
    const reportPath = join(directory, 'report.json');

    writeFileSync(reportPath, JSON.stringify(sharedReport({ status: 'pass' })));

    try {
      const { runCli: freshRunCli } = await import('./mutationCli.ts');

      const cliProcess: CliProcess = {
        argv: ['node', 'mutation', 'report', reportPath],
        cwd: () => process.cwd(),
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
        exitCode: undefined,
      };

      await freshRunCli(cliProcess);

      expect(cliProcess.exitCode).toBe(0);
    } finally {
      vi.doUnmock('./mutation.ts');
      vi.resetModules();
    }
  });
});
