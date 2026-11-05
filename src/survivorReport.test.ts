import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseSurvivorReport, rankSurvivors } from './survivorReport.ts';
import type { SharedSurvivor, SharedSurvivorReport } from './survivorReport.ts';

const fixtureReport = () =>
  parseSurvivorReport(
    readFileSync(new URL('../tests/fixtures/koja-pr27-report.json', import.meta.url), 'utf8'),
  );

const survivor = (fields: Partial<SharedSurvivor>): SharedSurvivor => ({
  file: 'src/a.ts',
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 2,
  mutator: 'StringLiteral',
  group: 'literal',
  original: 'x',
  replacement: 'y',
  covered: true,
  ...fields,
});

const reportOf = (fields: Partial<SharedSurvivorReport> = {}): SharedSurvivorReport => ({
  version: 1,
  status: 'survivors',
  survivors: [],
  falseSurvivors: [],
  totals: { mutants: 1, killed: 0, survived: 1, noCoverage: 0, timeout: 0, invalid: 0 },
  ...fields,
});

const lowCountsOf = (survivors: SharedSurvivor[]) => {
  const counts = new Map<string, number>();

  for (const entry of survivors) {
    counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
};

describe('parseSurvivorReport', () => {
  it('accepts covered null and an optional function', () => {
    const report = parseSurvivorReport(
      JSON.stringify(reportOf({ survivors: [survivor({ covered: null, function: 'isEven' })] })),
    );

    expect(report.survivors[0]).toMatchObject({ covered: null, function: 'isEven' });
  });

  it('rejects a report whose survivor has no group', () => {
    const { group: _group, ...withoutGroup } = survivor({});

    expect(() =>
      parseSurvivorReport(JSON.stringify(reportOf({ survivors: [withoutGroup as never] }))),
    ).toThrow(/shared shape/);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseSurvivorReport('{')).toThrow(/not valid JSON/);
  });
});

describe('rankSurvivors', () => {
  it('ranks the Koja fixture into High and Medium entries and Low per-file counts', () => {
    const ranked = rankSurvivors(fixtureReport(), []);

    expect(ranked.high.map(({ file, line }) => `${file}:${line}`)).toEqual([
      'src/kit/askPlan.ts:38',
      'src/kit/askPlan.ts:40',
      'src/kit/askPlan.ts:130',
      'src/kit/askPlan.ts:136',
    ]);

    expect(ranked.medium.map(({ file, line }) => `${file}:${line}`)).toEqual([
      'src/kit/askPlan.ts:94',
      'src/kit/askPlan.ts:116',
    ]);

    expect(lowCountsOf(ranked.low)).toEqual({
      'src/kit/askPlan.ts': 2,
      'src/kit/dialog.ts': 14,
      'src/kit/dialogPayload.ts': 1,
      'src/mods/koja-gallery/dialogs.ts': 40,
    });
  });

  it('keeps the covered and uncovered survivors of one line in one High entry', () => {
    const ranked = rankSurvivors(fixtureReport(), []);

    expect(
      ranked.high.find(({ line }) => line === 130)?.survivors.map(({ mutator }) => mutator),
    ).toEqual(['ConditionalExpression', 'BlockStatement']);

    expect(
      ranked.high.find(({ line }) => line === 136)?.survivors.map(({ covered }) => covered),
    ).toEqual([true, false]);
  });

  it('moves a low-weight literal to Low and a low-weight control-flow mutant from High to Medium', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({ file: 'low/a.ts', line: 1, mutator: 'StringLiteral', group: 'literal' }),
          survivor({
            file: 'low/b.ts',
            line: 2,
            mutator: 'ConditionalExpression',
            group: 'controlFlow',
          }),
          survivor({
            file: 'keep/c.ts',
            line: 3,
            mutator: 'ConditionalExpression',
            group: 'controlFlow',
          }),
        ],
      }),
      ['low/**'],
    );

    expect(ranked.high.map(({ file }) => file)).toEqual(['keep/c.ts']);
    expect(ranked.medium.map(({ file }) => file)).toEqual(['low/b.ts']);
    expect(ranked.low.map(({ file }) => file)).toEqual(['low/a.ts']);
  });

  it('ranks false survivors like survivors', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [],
        falseSurvivors: [
          survivor({
            file: 'src/a.ts',
            line: 4,
            mutator: 'EqualityOperator',
            group: 'controlFlow',
          }),
        ],
      }),
      [],
    );

    expect(ranked.high.map(({ file, line }) => `${file}:${line}`)).toEqual(['src/a.ts:4']);
  });

  it('groups survivors of different lines that share a function', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({
            file: 'src/a.ts',
            line: 12,
            function: 'isEven',
            mutator: 'EqualityOperator',
            group: 'controlFlow',
          }),
          survivor({
            file: 'src/a.ts',
            line: 10,
            function: 'isEven',
            mutator: 'ConditionalExpression',
            group: 'controlFlow',
          }),
        ],
      }),
      [],
    );

    expect(ranked.high).toHaveLength(1);
    expect(ranked.high[0]).toMatchObject({ file: 'src/a.ts', line: 10, function: 'isEven' });
    expect(ranked.high[0]?.survivors.map(({ line }) => line)).toEqual([10, 12]);
  });

  it('sorts entries by file and line and survivors by column', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({
            file: 'src/b.ts',
            line: 1,
            column: 5,
            group: 'value',
            mutator: 'ObjectLiteral',
          }),
          survivor({
            file: 'src/a.ts',
            line: 2,
            column: 9,
            group: 'value',
            mutator: 'ObjectLiteral',
          }),
          survivor({
            file: 'src/a.ts',
            line: 2,
            column: 1,
            group: 'value',
            mutator: 'ObjectLiteral',
          }),
          survivor({
            file: 'src/a.ts',
            line: 1,
            column: 4,
            group: 'value',
            mutator: 'ObjectLiteral',
          }),
        ],
      }),
      [],
    );

    expect(ranked.medium.map(({ file, line }) => `${file}:${line}`)).toEqual([
      'src/a.ts:1',
      'src/a.ts:2',
      'src/b.ts:1',
    ]);

    expect(
      ranked.medium.find(({ line }) => line === 2)?.survivors.map(({ column }) => column),
    ).toEqual([1, 9]);
  });

  it('raises an entry to High when a later survivor of the line has the higher rank', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({ file: 'src/a.ts', line: 5, mutator: 'StringLiteral', group: 'literal' }),
          survivor({
            file: 'src/a.ts',
            line: 5,
            mutator: 'ConditionalExpression',
            group: 'controlFlow',
          }),
        ],
      }),
      [],
    );

    expect(ranked.high.map(({ file, line }) => `${file}:${line}`)).toEqual(['src/a.ts:5']);
  });

  it('sorts entries by file when a file that sorts first comes later in the report', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({ file: 'src/b.ts', line: 1, mutator: 'ObjectLiteral', group: 'value' }),
          survivor({ file: 'src/c.ts', line: 1, mutator: 'ObjectLiteral', group: 'value' }),
          survivor({ file: 'src/a.ts', line: 1, mutator: 'ObjectLiteral', group: 'value' }),
        ],
      }),
      [],
    );

    expect(ranked.medium.map(({ file }) => file)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('omits the function property for a survivor without a function', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({
            file: 'src/a.ts',
            line: 1,
            mutator: 'ConditionalExpression',
            group: 'controlFlow',
          }),
        ],
      }),
      [],
    );

    expect(Object.hasOwn(ranked.high[0] as object, 'function')).toBe(false);
  });
});
