import { describe, expect, it } from 'vitest';

import { parseReportCommand } from './reportCommand.ts';

describe('parseReportCommand', () => {
  it('rejects a command other than report with the usage text', () => {
    expect(() => parseReportCommand(['audit'])).toThrow(/^Usage: mutation report/);
  });

  it('rejects --markdown without a path', () => {
    expect(() => parseReportCommand(['report', 'report.json', '--markdown'])).toThrow(
      /--markdown needs a path/,
    );
  });

  it('rejects an unknown option', () => {
    expect(() => parseReportCommand(['report', 'report.json', '--unknown'])).toThrow(
      /Unknown option "--unknown"/,
    );
  });

  it('rejects more than one report file', () => {
    expect(() => parseReportCommand(['report', 'a.json', 'b.json'])).toThrow(
      /report takes one report file/,
    );
  });

  it('omits markdownPath when no --markdown is given', () => {
    const command = parseReportCommand(['report', 'a.json']);

    expect(Object.hasOwn(command, 'markdownPath')).toBe(false);
  });
});
