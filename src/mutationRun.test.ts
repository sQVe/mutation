import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { projectVitestConfig } from './mutationRun.ts';

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
