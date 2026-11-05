import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, onTestFinished } from 'vitest';

interface ActionPaths {
  report: string;
  summary: string;
  comments: string;
  ghLog: string;
  ghTokenLog: string;
}

const actionText = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const runScriptOf = (text: string): string => {
  const header = '      run: |\n';
  const start = text.indexOf(header);

  if (start === -1) {
    throw new Error('action.yml has no run script');
  }

  const lines: string[] = [];

  for (const line of text.slice(start + header.length).split('\n')) {
    if (line.trim() === '') {
      lines.push('');

      continue;
    }

    if (!line.startsWith('        ')) {
      break;
    }

    lines.push(line.slice(8));
  }

  return lines.join('\n');
};

const runScript = runScriptOf(actionText);

const ghStub = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');

const args = process.argv.slice(2);

appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
appendFileSync(process.env.GH_TOKEN_LOG, (process.env.GH_TOKEN ?? '') + '\\n');

if (args.includes('-X')) {
  if (process.env.GH_DENY === '1') {
    process.exit(1);
  }

  const field = args[args.indexOf('-F') + 1];

  process.stdout.write(JSON.stringify({ body: readFileSync(field.slice(6), 'utf8') }) + '\\n');
} else {
  const expression = args[args.indexOf('--jq') + 1];
  const result = spawnSync('jq', ['-r', expression], {
    input: readFileSync(process.env.GH_COMMENTS, 'utf8'),
    encoding: 'utf8',
  });

  process.stdout.write(result.stdout ?? '');
  process.exit(result.status ?? 1);
}
`;

const requireJq = () => {
  const result = spawnSync('jq', ['--version'], { encoding: 'utf8' });

  if (result.error !== undefined || result.status !== 0) {
    throw new Error('The action tests need "jq" on PATH; the GitHub ubuntu runners have it.');
  }
};

requireJq();

const actionFixture = (overrides: Record<string, string> = {}) => {
  const directory = mkdtempSync(join(tmpdir(), 'mutation-action-'));

  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const ghPath = join(directory, 'gh');

  writeFileSync(ghPath, ghStub);
  chmodSync(ghPath, 0o755);

  const paths: ActionPaths = {
    report: join(directory, 'report.json'),
    summary: join(directory, 'summary.md'),
    comments: join(directory, 'comments.json'),
    ghLog: join(directory, 'gh.log'),
    ghTokenLog: join(directory, 'gh-token.log'),
  };

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH ?? ''}`,
    COMMAND: `node ${cliPath}`,
    REPORT: paths.report,
    RUNNER_TEMP: directory,
    GITHUB_STEP_SUMMARY: paths.summary,
    GITHUB_REPOSITORY: 'owner/project',
    MUTATION_REPORT_TOKEN: 'fake-token',
    PR_NUMBER: '5',
    GH_LOG: paths.ghLog,
    GH_TOKEN_LOG: paths.ghTokenLog,
    GH_COMMENTS: paths.comments,
    GH_DENY: '0',
    LOW_WEIGHT_PATHS: '',
    ...overrides,
  };

  return { directory, paths, environment };
};

const actionSurvivor = (fields: Record<string, unknown> = {}) => ({
  file: 'src/a.ts',
  line: 2,
  column: 3,
  endLine: 2,
  endColumn: 4,
  mutator: 'StringLiteral',
  group: 'literal',
  original: 'x',
  replacement: 'y',
  covered: true,
  ...fields,
});

const writeReport = (path: string, status: string, survivors: Record<string, unknown>[]) => {
  const report = {
    version: 1,
    status,
    ...(status === 'error' ? { error: 'Stryker failed' } : {}),
    survivors: status === 'error' ? [] : survivors,
    falseSurvivors: [],
    totals: {
      mutants: survivors.length,
      killed: 0,
      survived: survivors.length,
      noCoverage: 0,
      timeout: 0,
      invalid: 0,
    },
  };

  writeFileSync(path, JSON.stringify(report));
};

const ghCalls = (path: string): string[][] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);

const runAction = (environment: NodeJS.ProcessEnv) =>
  spawnSync('bash', ['-e', '-o', 'pipefail', '-c', runScript], {
    env: environment,
    encoding: 'utf8',
  });

const methodsOf = (calls: string[][]) =>
  calls.filter((call) => call.includes('-X')).map((call) => call[call.indexOf('-X') + 1]);

describe('action.yml run script', () => {
  it('patches the existing Bot marker comment and forwards repeated low-weight globs', () => {
    const { paths, environment } = actionFixture({
      LOW_WEIGHT_PATHS: 'src/**\nspread/**',
    });

    writeFileSync(
      paths.comments,
      JSON.stringify([
        { id: 72, user: { type: 'User' }, body: '<!-- sqve/mutation report --> human' },
        { id: 73, user: { type: 'Bot' }, body: 'unrelated bot comment' },
        { id: 71, user: { type: 'Bot' }, body: '<!-- sqve/mutation report --> old' },
      ]),
    );

    writeReport(paths.report, 'survivors', [
      actionSurvivor({ file: 'src/a.ts' }),
      actionSurvivor({ file: 'spread/b.ts', line: 4, column: 5 }),
    ]);

    const result = runAction(environment);
    const calls = ghCalls(paths.ghLog);

    expect(result.status).toBe(0);
    expect(methodsOf(calls)).toEqual(['PATCH']);
    expect(calls.at(-1)).toContain('repos/owner/project/issues/comments/71');
    expect(result.stdout.match(/Mutation survivor \(Low\)/g)).toHaveLength(2);
    expect(readFileSync(paths.summary, 'utf8')).toContain('<!-- sqve/mutation report -->');
  });

  it('warns and keeps the report exit code when patching the existing comment fails', () => {
    const { paths, environment } = actionFixture({ GH_DENY: '1' });

    writeFileSync(
      paths.comments,
      JSON.stringify([
        { id: 71, user: { type: 'Bot' }, body: '<!-- sqve/mutation report --> old' },
      ]),
    );

    writeReport(paths.report, 'survivors', [actionSurvivor()]);

    const result = runAction(environment);

    expect(result.status).toBe(0);
    expect(methodsOf(ghCalls(paths.ghLog))).toEqual(['PATCH']);
    expect(result.stdout).toContain('::warning::Could not update the mutation report comment.');
    expect(result.stdout).not.toContain('::warning::Could not post the mutation report comment.');
  });

  it('posts one comment when no marker comment exists', () => {
    const { paths, environment } = actionFixture();

    writeFileSync(paths.comments, '[]');
    writeReport(paths.report, 'survivors', [actionSurvivor()]);

    const result = runAction(environment);

    expect(result.status).toBe(0);
    expect(methodsOf(ghCalls(paths.ghLog))).toEqual(['POST']);
    expect(result.stdout).toContain('Mutation survivor (Medium)');
    expect(readFileSync(paths.summary, 'utf8')).toContain('### Medium');
  });

  it('warns and keeps the report exit code when posting fails', () => {
    const { paths, environment } = actionFixture({ GH_DENY: '1' });

    writeFileSync(paths.comments, '[]');
    writeReport(paths.report, 'survivors', [actionSurvivor()]);

    const result = runAction(environment);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('::warning::Could not post the mutation report comment.');
  });

  it('exits 1 for a report with status error after posting the comment', () => {
    const { paths, environment } = actionFixture();

    writeFileSync(paths.comments, '[]');
    writeReport(paths.report, 'error', []);

    const result = runAction(environment);

    expect(result.status).toBe(1);
    expect(methodsOf(ghCalls(paths.ghLog))).toEqual(['POST']);
    expect(readFileSync(paths.summary, 'utf8')).toContain('Stryker failed');
  });

  it('hides the token from the report command and gives it to gh as GH_TOKEN', () => {
    const { directory, paths, environment } = actionFixture();
    const commandEnvironment = join(directory, 'command-environment.txt');
    const fakeCommand = join(directory, 'fake-command');

    writeFileSync(
      fakeCommand,
      `#!/usr/bin/env bash\nenv > '${commandEnvironment}'\nexec node '${cliPath}' "$@"\n`,
    );

    chmodSync(fakeCommand, 0o755);

    writeFileSync(paths.comments, '[]');
    writeReport(paths.report, 'survivors', [actionSurvivor()]);

    const result = runAction({
      ...environment,
      COMMAND: fakeCommand,
      GITHUB_TOKEN: 'runner-token',
      GH_TOKEN: 'runner-gh-token',
    });

    expect(result.status).toBe(0);

    const commandNames = new Set(
      readFileSync(commandEnvironment, 'utf8')
        .split('\n')
        .map((line) => line.slice(0, line.indexOf('='))),
    );

    expect(commandNames.has('MUTATION_REPORT_TOKEN')).toBe(false);
    expect(commandNames.has('GITHUB_TOKEN')).toBe(false);
    expect(commandNames.has('GH_TOKEN')).toBe(false);

    const tokens = readFileSync(paths.ghTokenLog, 'utf8').split('\n').slice(0, -1);

    expect(methodsOf(ghCalls(paths.ghLog))).toEqual(['POST']);
    expect(tokens).toEqual(['fake-token', 'fake-token']);
  });
});
