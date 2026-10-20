import { describe, expect, it, onTestFinished } from 'vitest';

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
