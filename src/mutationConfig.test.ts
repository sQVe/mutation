import { describe, expect, it } from 'vitest';

import {
  configWithTestFiles,
  ignorerPluginPath,
  mergedConfig,
  vitestFolderConfigSource,
  withSharedDefaults,
} from './mutationConfig.ts';

describe('mergedConfig', () => {
  it('turns the break threshold off and keeps the other thresholds', () => {
    const merged = mergedConfig(
      { mutate: [], thresholds: { high: 80, low: 60, break: 100 } },
      ['a.ts'],
      'r.json',
      'changed',
    );

    expect(merged.thresholds).toEqual({ high: 80, low: 60, break: null });
    expect(merged.mutate).toEqual(['a.ts']);
  });

  it('sets the break threshold when the config has none', () => {
    expect(mergedConfig({ mutate: [] }, [], 'r.json', 'changed').thresholds).toEqual({
      break: null,
    });
  });

  it('adds the shared defaults', () => {
    const merged = mergedConfig({ mutate: [] }, [], 'r.json', 'changed');

    expect(merged.ignorers).toEqual(['tauMessageIgnorer']);
    expect(merged.ignoreStatic).toBe(true);
  });

  it.each([
    { mode: 'audit' as const, configured: false, expected: true },
    { mode: 'changed' as const, configured: true, expected: false },
    { mode: 'audit' as const, configured: undefined, expected: true },
  ])('sets disableBail $expected for $mode when the config has $configured', (row) => {
    const config = { mutate: [], disableBail: row.configured };

    expect(mergedConfig(config, [], 'r.json', row.mode).disableBail).toBe(row.expected);
  });

  it.each([
    { mode: 'audit' as const, expected: false },
    { mode: 'changed' as const, expected: true },
  ])('sets incremental $expected for $mode when the config turns it on', ({ mode, expected }) => {
    const config = { mutate: [], incremental: true };

    expect(mergedConfig(config, [], 'r.json', mode).incremental).toBe(expected);
  });
});

describe('withSharedDefaults', () => {
  it('adds the ignorer plugin after the Stryker plugins by default', () => {
    expect(withSharedDefaults({ mutate: [] }).plugins).toEqual([
      '@stryker-mutator/*',
      ignorerPluginPath,
    ]);
  });

  it('adds the ignorer plugin after the plugins the project lists', () => {
    const config = { mutate: [], plugins: ['@hughescr/stryker-bun-runner'] };

    expect(withSharedDefaults(config).plugins).toEqual([
      '@hughescr/stryker-bun-runner',
      ignorerPluginPath,
    ]);
  });

  it.each([ignorerPluginPath, '@sqve/mutation/ignorer'])(
    'does not add the ignorer plugin when the project lists %s',
    (plugin) => {
      const config = { mutate: [], plugins: ['runner', plugin] };

      expect(withSharedDefaults(config).plugins).toEqual(['runner', plugin]);
    },
  );

  it('adds the ignorer after the ignorers the project lists', () => {
    const config = { mutate: [], ignorers: ['other'] };

    expect(withSharedDefaults(config).ignorers).toEqual(['other', 'tauMessageIgnorer']);
  });

  it('does not add the ignorer twice', () => {
    const config = { mutate: [], ignorers: ['tauMessageIgnorer'] };

    expect(withSharedDefaults(config).ignorers).toEqual(['tauMessageIgnorer']);
  });

  it('turns ignoreStatic on when the project does not set it', () => {
    expect(withSharedDefaults({ mutate: [] }).ignoreStatic).toBe(true);
  });

  it('keeps ignoreStatic off when the project turns it off', () => {
    expect(withSharedDefaults({ mutate: [], ignoreStatic: false }).ignoreStatic).toBe(false);
  });

  it('leaves the timeout to Stryker unless the project sets it', () => {
    const config = { mutate: [] };

    expect(withSharedDefaults(config)).not.toHaveProperty('timeoutMS');
    expect(withSharedDefaults({ ...config, timeoutMS: 99 })).toHaveProperty('timeoutMS', 99);
  });

  it('points the ignorer plugin at a file next to the module', () => {
    expect(ignorerPluginPath).toMatch(/\/mutationIgnorer\.(ts|js)$/);
  });
});

describe('configWithTestFiles', () => {
  it('sets the test files of the Bun runner', () => {
    const config = { mutate: [], testRunner: 'bun', bun: { timeout: 5 } };

    expect(configWithTestFiles(config, ['src/a.test.ts'], 'v.mjs').bun).toEqual({
      timeout: 5,
      testFiles: ['src/a.test.ts'],
    });
  });

  it('points the Vitest runner at the generated config and turns related off', () => {
    const config = { mutate: [], testRunner: 'vitest', vitest: { bail: true } };

    expect(configWithTestFiles(config, ['src/a.test.ts'], 'v.mjs').vitest).toEqual({
      bail: true,
      configFile: 'v.mjs',
      related: false,
    });
  });

  it('drops the Vitest dir, since the generated include names each test file from the root', () => {
    const config = { mutate: [], testRunner: 'vitest', vitest: { dir: 'src' } };

    expect(configWithTestFiles(config, ['src/a.test.ts'], 'v.mjs').vitest).not.toHaveProperty(
      'dir',
    );
  });

  it.each([undefined, 'command'])('refuses the %s runner', (testRunner) => {
    const config = { mutate: [], ...(testRunner === undefined ? {} : { testRunner }) };

    expect(() => configWithTestFiles(config, [], 'v.mjs')).toThrow('"vitest" or "bun"');
  });
});

describe('vitestFolderConfigSource', () => {
  it('limits the included tests and escapes glob characters', () => {
    const source = vitestFolderConfigSource(
      { viteUrl: 'file:///p/vite.js', path: 'config/vite.config.ts', markerPath: '/t/marker' },
      ['src/[id].test.ts'],
    );

    expect(source).toContain('resolve(process.cwd(), "config/vite.config.ts")');
    expect(source).toContain('import { loadConfigFromFile } from "file:///p/vite.js";');
    expect(source).toContain('const files = ["src/[id].test.ts"];');
    expect(source).toContain('includeSource: []');
    expect(source).toContain('config.test?.root ?? config.root');
  });

  it('writes the name of an unsupported setting to the marker file and throws', () => {
    const source = vitestFolderConfigSource(
      { viteUrl: 'file:///p/vite.js', path: 'vite.config.ts', markerPath: '/t/marker' },
      [],
    );

    expect(source).toContain("['projects', 'workspace']");
    expect(source).toContain('writeFileSync("/t/marker", name)');
  });

  it('starts from an empty config when the project has none', () => {
    expect(vitestFolderConfigSource(undefined, ['a.test.ts'])).toContain('async () => ({})');
  });
});
