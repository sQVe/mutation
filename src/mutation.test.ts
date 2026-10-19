import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { instrumentScope } from './mutation.ts';

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
