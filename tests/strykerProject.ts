import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Mutant, StrykerReport } from '../src/mutationReport.ts';
import { createTemporaryRepository, runGit } from './gitRepository.ts';

type RegisterCleanup = (cleanup: () => Promise<void>) => void;

// What the stand-in Stryker does on its nth run. The last response repeats.
export interface StrykerResponse {
  status?: number;
  report?: StrykerReport;
  rawReport?: string;
  // Loads the generated Vitest config the way Vitest would and records the result.
  loadVitestConfig?: boolean;
}

export interface ReceivedConfig {
  mutate: string[];
  bun?: { testFiles: string[] };
  vitest?: { related?: boolean; configFile: string };
  [key: string]: unknown;
}

export interface StrykerCall {
  configPath: string;
  cwd: string;
  config: ReceivedConfig;
  stdio: { inputIsClosed: boolean; outputIsError: boolean };
  vitestConfig?: Record<string, unknown>;
}

// A Git repository with a stand-in `@stryker-mutator/core` that the project resolves. The first
// commit holds the given files.
export interface StrykerProject {
  root: string;
  respondWith: (responses: StrykerResponse[]) => Promise<void>;
  calls: () => Promise<StrykerCall[]>;
  write: (files: Record<string, string>) => Promise<void>;
}

export const mutantAt = (line: number, status = 'Survived'): Mutant => ({
  mutatorName: 'ArithmeticOperator',
  replacement: '-',
  status,
  location: { start: { line, column: 1 }, end: { line, column: 5 } },
});

export const reportOf = (files: Record<string, Mutant[]>): StrykerReport => ({
  files: Object.fromEntries(Object.entries(files).map(([path, mutants]) => [path, { mutants }])),
});

const strykerStub = `import { appendFileSync, existsSync, fstatSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const { responses } = JSON.parse(readFileSync('stryker-stub.json', 'utf8'));
const earlier = existsSync('stryker-calls.jsonl') ? readFileSync('stryker-calls.jsonl', 'utf8') : '';
const index = earlier.split('\\n').filter((line) => line !== '').length;
const response = responses[Math.min(index, responses.length - 1)];
const inputStatus = fstatSync(0);
const outputStatus = fstatSync(1);
const errorStatus = fstatSync(2);

const stdio = {
  inputIsClosed: inputStatus.isCharacterDevice(),
  outputIsError: outputStatus.dev === errorStatus.dev && outputStatus.ino === errorStatus.ino,
};

const call = { configPath: process.argv[3], cwd: process.cwd(), config, stdio };

if (process.argv[2] !== 'run') {
  process.exit(64);
}

if (response.loadVitestConfig) {
  try {
    const generated = await import(pathToFileURL(config.vitest.configFile).href);

    call.vitestConfig = await generated.default({});
  } catch {
    appendFileSync('stryker-calls.jsonl', JSON.stringify(call) + '\\n');
    process.exit(1);
  }
}

appendFileSync('stryker-calls.jsonl', JSON.stringify(call) + '\\n');

if (response.rawReport !== undefined) {
  writeFileSync(config.jsonReporter.fileName, response.rawReport);
} else if (response.report !== undefined) {
  writeFileSync(config.jsonReporter.fileName, JSON.stringify(response.report));
}

process.exit(response.status ?? 0);
`;

const writeFiles = async (directory: string, files: Record<string, string>): Promise<void> => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }
};

export const commitAll = async (root: string, message = 'commit'): Promise<void> => {
  await runGit(root, ['add', '--all']);
  await runGit(root, ['commit', '--quiet', '-m', message]);
};

export const createStrykerProject = async (
  registerCleanup: RegisterCleanup,
  files: Record<string, string>,
  responses: StrykerResponse[] = [{ report: { files: {} } }],
): Promise<StrykerProject> => {
  const root = await createTemporaryRepository(registerCleanup, 'mutation-orchestration-');
  const core = 'node_modules/@stryker-mutator/core';

  await writeFiles(root, {
    ...files,
    '.gitignore': 'node_modules\nstryker-stub.json\nstryker-calls.jsonl\n',
    'package.json': '{ "type": "module" }',
    [`${core}/package.json`]: '{ "name": "@stryker-mutator/core", "type": "module" }',
    [`${core}/bin/stryker.js`]: strykerStub,
  });

  await commitAll(root, 'base');

  const respondWith = (next: StrykerResponse[]) =>
    writeFile(join(root, 'stryker-stub.json'), JSON.stringify({ responses: next }));

  await respondWith(responses);

  const calls = async (): Promise<StrykerCall[]> => {
    const text = await readFile(join(root, 'stryker-calls.jsonl'), 'utf8').catch(() => '');

    return (
      text
        .split('\n')
        .filter((line) => line !== '')
        // SAFETY: the stand-in Stryker wrote each line as a StrykerCall.
        .map((line) => JSON.parse(line) as StrykerCall)
    );
  };

  return {
    root,
    respondWith,
    calls,
    write: (more: Record<string, string>) => writeFiles(root, more),
  };
};
