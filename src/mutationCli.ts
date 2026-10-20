import { mutate } from './mutation.ts';
import { failedMutationReport } from './mutationReport.ts';
import type { MutationMode, MutationOutcome } from './mutationReport.ts';
import { parseCommand } from './mutationScope.ts';

export interface CliProcess {
  argv: readonly string[];
  cwd: () => string;
  stdout: { write: (text: string) => unknown };
  exitCode: number | string | null | undefined;
}

const outcomeOf = async (
  cliProcess: CliProcess,
): Promise<{ report: MutationOutcome; exitCode: number }> => {
  let mode: MutationMode | null = null;

  try {
    const command = parseCommand(cliProcess.argv.slice(2));

    mode = command.mode;

    return await mutate(command, cliProcess.cwd());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return { report: failedMutationReport(mode, message), exitCode: 1 };
  }
};

export const runCli = async (cliProcess: CliProcess): Promise<void> => {
  const { report, exitCode } = await outcomeOf(cliProcess);

  cliProcess.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
  cliProcess.exitCode = exitCode;
};
