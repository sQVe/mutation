import { readFileSync, writeFileSync } from 'node:fs';

import type { CliProcess } from './mutationCli.ts';
import { parseSurvivorReport, rankSurvivors } from './survivorReport.ts';
import type { SharedSurvivorReport } from './survivorReport.ts';
import {
  survivorReportMarkdown,
  unreadableReportMarkdown,
  warningAnnotations,
} from './survivorReportOutput.ts';

export interface ReportCommand {
  reportPath: string;
  lowWeightPaths: string[];
  markdownPath?: string;
}

const usageText =
  'Usage: mutation report <report.json> [--low-weight <glob>]... [--markdown <path>]';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const parseReportCommand = (argv: readonly string[]): ReportCommand => {
  const [command, ...rest] = argv;

  if (command !== 'report') {
    throw new Error(usageText);
  }

  const positionals: string[] = [];
  const lowWeightPaths: string[] = [];
  let markdownPath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] ?? '';

    if (argument === '--low-weight') {
      const value = rest[index + 1];

      if (value === undefined) {
        throw new Error(`--low-weight needs a glob. ${usageText}`);
      }

      lowWeightPaths.push(value);
      index += 1;

      continue;
    }

    if (argument === '--markdown') {
      const value = rest[index + 1];

      if (value === undefined) {
        throw new Error(`--markdown needs a path. ${usageText}`);
      }

      markdownPath = value;
      index += 1;

      continue;
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option "${argument}". ${usageText}`);
    }

    positionals.push(argument);
  }

  const [reportPath, ...extra] = positionals;

  if (reportPath === undefined) {
    throw new Error(`report needs a report file. ${usageText}`);
  }

  if (extra.length > 0) {
    throw new Error(`report takes one report file. ${usageText}`);
  }

  return {
    reportPath,
    lowWeightPaths,
    ...(markdownPath === undefined ? {} : { markdownPath }),
  };
};

const writeMarkdown = (path: string | undefined, text: string): void => {
  if (path !== undefined) {
    writeFileSync(path, text);
  }
};

// Reads one report and writes its annotations and Markdown. A usage, read, or shape error still
// writes the Markdown when a path was given, so the action can report the failure on the PR.
export const runReportCommand = (cliProcess: CliProcess, argv: readonly string[]): void => {
  let command: ReportCommand;

  try {
    command = parseReportCommand(argv);
  } catch (error) {
    cliProcess.stderr?.write(`${messageOf(error)}\n`);
    cliProcess.exitCode = 1;

    return;
  }

  let report: SharedSurvivorReport;

  try {
    report = parseSurvivorReport(readFileSync(command.reportPath, 'utf8'));
  } catch (error) {
    const reason = messageOf(error);

    writeMarkdown(command.markdownPath, unreadableReportMarkdown(reason));
    cliProcess.stderr?.write(`${reason}\n`);
    cliProcess.exitCode = 1;

    return;
  }

  const ranked = rankSurvivors(report, command.lowWeightPaths);

  for (const annotation of warningAnnotations(ranked)) {
    cliProcess.stdout.write(`${annotation}\n`);
  }

  writeMarkdown(command.markdownPath, survivorReportMarkdown(report, ranked));

  cliProcess.exitCode = report.status === 'error' ? 1 : 0;
};
