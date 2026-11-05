import { describe, expect, it } from 'vitest';

import { rankSurvivors } from './survivorReport.ts';
import type { SharedSurvivor, SharedSurvivorReport } from './survivorReport.ts';
import {
  survivorReportMarkdown,
  unreadableReportMarkdown,
  warningAnnotations,
} from './survivorReportOutput.ts';

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
  totals: { mutants: 3, killed: 1, survived: 2, noCoverage: 0, timeout: 0, invalid: 0 },
  ...fields,
});

describe('warningAnnotations', () => {
  it('orders annotations High, Medium, then Low', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({
            file: 'src/low.ts',
            line: 3,
            mutator: 'ObjectLiteral',
            group: 'value',
            covered: false,
          }),
          survivor({
            file: 'src/high.ts',
            line: 1,
            mutator: 'ConditionalExpression',
            group: 'controlFlow',
          }),
          survivor({ file: 'src/medium.ts', line: 2, mutator: 'StringLiteral', group: 'literal' }),
        ],
      }),
      [],
    );

    expect(warningAnnotations(ranked).map((line) => /\((\w+)\)/.exec(line)?.[1])).toEqual([
      'High',
      'Medium',
      'Low',
    ]);
  });

  it('escapes data and property values for the workflow command', () => {
    const ranked = rankSurvivors(
      reportOf({
        survivors: [
          survivor({
            file: 'src/a,b.ts',
            line: 3,
            column: 5,
            endLine: 3,
            endColumn: 9,
            mutator: 'ConditionalExpression',
            group: 'controlFlow',
            original: '50%',
            replacement: 'a\nb',
          }),
        ],
      }),
      [],
    );

    expect(warningAnnotations(ranked)).toEqual([
      '::warning file=src/a%2Cb.ts,line=3,col=5,endLine=3,endColumn=9,title=Mutation survivor (High)::ConditionalExpression: 50%25 => a%0Ab',
    ]);
  });

  it('orders annotations by file, line, and column', () => {
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

    const locations = warningAnnotations(ranked).map((line) =>
      /file=([^,]+),line=(\d+),col=(\d+)/.exec(line)?.slice(1).join(':'),
    );

    expect(locations).toEqual(['src/a.ts:1:4', 'src/a.ts:2:1', 'src/a.ts:2:9', 'src/b.ts:1:5']);
  });

  it('omits end coordinates when the survivor has none', () => {
    const noEnd: SharedSurvivor = {
      file: 'src/a.ts',
      line: 1,
      column: 1,
      mutator: 'StringLiteral',
      group: 'literal',
      original: 'x',
      replacement: 'y',
      covered: true,
    };

    const ranked = rankSurvivors(reportOf({ survivors: [noEnd] }), []);

    expect(warningAnnotations(ranked)).toEqual([
      '::warning file=src/a.ts,line=1,col=1,title=Mutation survivor (Medium)::StringLiteral: x => y',
    ]);
  });
});

describe('survivorReportMarkdown', () => {
  it('starts with the marker and lists the ranks of a survivor report', () => {
    const report = reportOf({
      survivors: [
        survivor({
          file: 'src/high.ts',
          line: 1,
          mutator: 'ConditionalExpression',
          group: 'controlFlow',
        }),
        survivor({ file: 'src/medium.ts', line: 2, mutator: 'StringLiteral', group: 'literal' }),
        survivor({
          file: 'src/low.ts',
          line: 3,
          mutator: 'ObjectLiteral',
          group: 'value',
          covered: false,
        }),
      ],
    });

    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown.startsWith('<!-- sqve/mutation report -->\n## Mutation report\n')).toBe(true);

    expect(markdown).toContain(
      '### High\n\nA branch or condition that no test caught, outside low-weight paths.\n',
    );

    expect(markdown).toContain(
      '### Medium\n\nAny other survivor that tests run, or may run, without catching it.\n',
    );

    expect(markdown).toContain(
      '### Low\n\nNot covered, or a literal mutant in a low-weight path.\n',
    );

    expect(markdown).toContain('- `src/low.ts`: 1 survivor\n');
    expect(markdown).toContain('3 mutants, 1 killed: 3 survivors (1 High, 1 Medium, 1 Low).');
  });

  it('fences a text that holds backticks with a longer run', () => {
    const report = reportOf({
      survivors: [
        survivor({
          file: 'src/a.ts',
          line: 1,
          mutator: 'StringLiteral',
          group: 'literal',
          original: '`a`',
          replacement: 'b',
        }),
      ],
    });

    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown).toContain('`` `a` `` => `b`');
  });

  it('renders an empty snippet as plain text beside a replacement with backticks', () => {
    const report = reportOf({
      survivors: [
        survivor({
          file: 'src/a.ts',
          line: 1,
          mutator: 'StringLiteral',
          group: 'literal',
          original: '',
          replacement: '`b`',
        }),
      ],
    });

    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown.split('\n')).toContain('  - `StringLiteral`: (empty) => `` `b` ``');
  });

  it('collapses a blank line and heading in a snippet into one line', () => {
    const report = reportOf({
      survivors: [
        survivor({
          file: 'src/a.ts',
          line: 1,
          mutator: 'StringLiteral',
          group: 'literal',
          original: 'a\n\n# injected heading\n\nb',
          replacement: 'z',
        }),
      ],
    });

    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown.split('\n')).toContain('  - `StringLiteral`: `a # injected heading b` => `z`');

    expect(markdown).not.toContain('\n# injected heading');
  });

  it('shows a function entry location and function name', () => {
    const report = reportOf({
      survivors: [
        survivor({
          file: 'src/a.ts',
          line: 10,
          function: 'isEven',
          mutator: 'ConditionalExpression',
          group: 'controlFlow',
        }),
        survivor({
          file: 'src/a.ts',
          line: 12,
          function: 'isEven',
          mutator: 'EqualityOperator',
          group: 'controlFlow',
        }),
      ],
    });

    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown).toContain('- `src/a.ts:10 (isEven)`');
  });

  it('reports a pass with the mutant count', () => {
    const report = reportOf({ status: 'pass', survivors: [] });
    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown).toBe(
      '<!-- sqve/mutation report -->\n## Mutation report\n\nAll 3 mutants killed.\n',
    );
  });

  it('reports nothing in scope', () => {
    const report = reportOf({ status: 'nothing', survivors: [] });
    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown).toContain('No mutants in scope.');
  });

  it('reports the error text', () => {
    const report = reportOf({ status: 'error', error: 'Stryker failed', survivors: [] });
    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown).toContain('Stryker failed');
  });

  it('pads a snippet that starts or ends with a backtick but does not do both', () => {
    const startsWithBacktick = reportOf({
      survivors: [survivor({ original: '`a', replacement: 'b' })],
    });

    const endsWithBacktick = reportOf({
      survivors: [survivor({ original: 'a`', replacement: 'b' })],
    });

    expect(
      survivorReportMarkdown(startsWithBacktick, rankSurvivors(startsWithBacktick, [])),
    ).toContain('`` `a `` => `b`');

    expect(survivorReportMarkdown(endsWithBacktick, rankSurvivors(endsWithBacktick, []))).toContain(
      '`` a` `` => `b`',
    );
  });

  it('shows a location without a function when the entry has none', () => {
    const report = reportOf({
      survivors: [
        survivor({
          file: 'src/a.ts',
          line: 1,
          mutator: 'ConditionalExpression',
          group: 'controlFlow',
        }),
      ],
    });

    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown).toContain('- `src/a.ts:1`');
    expect(markdown).not.toContain('(undefined)');
  });

  it('counts more than one low survivor in the same file', () => {
    const report = reportOf({
      survivors: [
        survivor({ file: 'src/low.ts', line: 1, group: 'value', covered: false }),
        survivor({ file: 'src/low.ts', line: 2, group: 'value', covered: false }),
      ],
    });

    const markdown = survivorReportMarkdown(report, rankSurvivors(report, []));

    expect(markdown).toContain('- `src/low.ts`: 2 survivors');
  });

  it('omits a rank section that has no survivors', () => {
    const mediumOnly = reportOf({
      survivors: [survivor({ group: 'value', mutator: 'ObjectLiteral' })],
    });

    const mediumMarkdown = survivorReportMarkdown(mediumOnly, rankSurvivors(mediumOnly, []));

    expect(mediumMarkdown).not.toContain('### High');
    expect(mediumMarkdown).not.toContain('### Low');

    const highOnly = reportOf({
      survivors: [survivor({ group: 'controlFlow', mutator: 'ConditionalExpression' })],
    });

    const highMarkdown = survivorReportMarkdown(highOnly, rankSurvivors(highOnly, []));

    expect(highMarkdown).not.toContain('### Medium');
  });
});

describe('unreadableReportMarkdown', () => {
  it('states the reason with the marker and heading', () => {
    const markdown = unreadableReportMarkdown('no such file');

    expect(markdown.startsWith('<!-- sqve/mutation report -->\n## Mutation report\n')).toBe(true);
    expect(markdown).toContain('Could not read the report: no such file');
  });
});
