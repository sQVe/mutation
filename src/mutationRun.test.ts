import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { projectVitestConfig, refuseVitestProjects } from './mutationRun.ts';

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
    'export const loadConfigFromFile = async () => ({ config: { test: { projects: [] } } });',
  );

  await symlink(join(store, 'vitest'), join(directory, 'node_modules/vitest'));

  return directory;
};

describe('refuseVitestProjects', () => {
  it('loads the config with the Vite beside the Vitest of the project', async () => {
    const directory = await pnpmProjectWithViteBehindVitest();

    await expect(refuseVitestProjects(directory, { mutate: [] })).rejects.toThrow(
      'vitest.config.ts sets "test.projects". --same-folder-tests does not support it.',
    );
  });
});
