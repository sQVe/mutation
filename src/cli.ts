#!/usr/bin/env node
import { mutate } from './mutation.ts';
import { failedMutationReport } from './mutationReport.ts';
import type { MutationMode, MutationOutcome } from './mutationReport.ts';
import { parseCommand } from './mutationScope.ts';

const main = async () => {
  let result: { report: MutationOutcome; exitCode: number };
  let mode: MutationMode | null = null;

  try {
    const command = parseCommand(process.argv.slice(2));

    mode = command.mode;
    result = await mutate(command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    result = { report: failedMutationReport(mode, message), exitCode: 1 };
  }

  process.stdout.write(`${JSON.stringify(result.report, undefined, 2)}\n`);
  process.exitCode = result.exitCode;
};

await main();
