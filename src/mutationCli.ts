import { errorMessageOf } from './errorMessage.ts';
import { failedMutationReport } from './mutationReport.ts';
import type { MutationMode, MutationOutcome } from './mutationReport.ts';
import { parseCommand } from './mutationScope.ts';
import { runReportCommand } from './reportCommand.ts';

export interface CliProcess {
  argv: readonly string[];
  cwd: () => string;
  stdout: { write: (text: string) => unknown };
  stderr?: { write: (text: string) => unknown };
  exitCode: number | string | null | undefined;
}

const outcomeOf = async (
  cliProcess: CliProcess,
): Promise<{ report: MutationOutcome; exitCode: number }> => {
  let mode: MutationMode | null = null;

  try {
    const command = parseCommand(cliProcess.argv.slice(2));

    mode = command.mode;

    const { mutate } = await import('./mutation.ts');

    return await mutate(command, cliProcess.cwd());
  } catch (error) {
    const message = errorMessageOf(error);

    return { report: failedMutationReport(mode, message), exitCode: 1 };
  }
};

export const runCli = async (cliProcess: CliProcess): Promise<void> => {
  const argv = cliProcess.argv.slice(2);

  if (argv[0] === 'report') {
    runReportCommand(cliProcess, argv);

    return;
  }

  const { report, exitCode } = await outcomeOf(cliProcess);

  cliProcess.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
  cliProcess.exitCode = exitCode;
};
