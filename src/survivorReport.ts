import { matchesGlob } from 'node:path';

import { z } from 'zod';

export interface SurvivorEntry {
  file: string;
  line: number;
  function?: string;
  rank: SurvivorRank;
  survivors: SharedSurvivor[];
}

export interface RankedSurvivors {
  high: SurvivorEntry[];
  medium: SurvivorEntry[];
  low: SharedSurvivor[];
}

export const mutantGroups = ['controlFlow', 'value', 'literal'] as const;
export type MutantGroup = (typeof mutantGroups)[number];

export const survivorRanks = ['High', 'Medium', 'Low'] as const;
export type SurvivorRank = (typeof survivorRanks)[number];

const coordinate = z.number().int().min(1);

const survivorSchema = z.object({
  file: z.string(),
  line: coordinate,
  column: coordinate,
  endLine: coordinate.optional(),
  endColumn: coordinate.optional(),
  mutator: z.string(),
  group: z.enum(mutantGroups),
  original: z.string(),
  replacement: z.string(),
  covered: z.boolean().nullable(),
  function: z.string().optional(),
});

const totalsSchema = z.object({
  mutants: z.number(),
  killed: z.number(),
  survived: z.number(),
  noCoverage: z.number(),
  timeout: z.number(),
  invalid: z.number(),
});

const statusSchema = z.enum(['pass', 'survivors', 'nothing', 'error']);

const reportSchema = z.object({
  version: z.literal(1),
  status: statusSchema,
  error: z.string().optional(),
  survivors: z.array(survivorSchema),
  falseSurvivors: z.array(survivorSchema).optional(),
  totals: totalsSchema,
});

export type SharedSurvivor = z.infer<typeof survivorSchema>;
export type SharedTotals = z.infer<typeof totalsSchema>;
export type SharedSurvivorReport = z.infer<typeof reportSchema>;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const parseSurvivorReport = (text: string): SharedSurvivorReport => {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`The report is not valid JSON: ${messageOf(error)}`, { cause: error });
  }

  const parsed = reportSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(`The report is not in the shared shape: ${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
};

const rankOrder: Record<SurvivorRank, number> = { High: 0, Medium: 1, Low: 2 };

const higherRank = (left: SurvivorRank, right: SurvivorRank): SurvivorRank =>
  rankOrder[left] <= rankOrder[right] ? left : right;

const rankOf = (survivor: SharedSurvivor, isLowWeight: (file: string) => boolean): SurvivorRank => {
  const lowWeight = isLowWeight(survivor.file);

  if (survivor.covered === false) {
    return 'Low';
  }

  if (survivor.group === 'literal' && lowWeight) {
    return 'Low';
  }

  if (survivor.group === 'controlFlow' && !lowWeight) {
    return 'High';
  }

  return 'Medium';
};

const entryKeyOf = (survivor: SharedSurvivor) =>
  `${survivor.file}\0${survivor.function ?? `#${survivor.line}`}`;

const byPosition = (left: SharedSurvivor, right: SharedSurvivor) =>
  left.line - right.line || left.column - right.column;

const byEntry = (left: SurvivorEntry, right: SurvivorEntry) => {
  if (left.file !== right.file) {
    return left.file < right.file ? -1 : 1;
  }

  return left.line - right.line;
};

export const rankSurvivors = (
  report: SharedSurvivorReport,
  lowWeightGlobs: readonly string[],
): RankedSurvivors => {
  const isLowWeight = (file: string) => lowWeightGlobs.some((glob) => matchesGlob(file, glob));
  const survivors = [...report.survivors, ...(report.falseSurvivors ?? [])];
  const entries = new Map<string, SurvivorEntry>();

  for (const survivor of survivors) {
    const key = entryKeyOf(survivor);
    const rank = rankOf(survivor, isLowWeight);
    const entry = entries.get(key);

    if (entry === undefined) {
      entries.set(key, {
        file: survivor.file,
        line: survivor.line,
        ...(survivor.function === undefined ? {} : { function: survivor.function }),
        rank,
        survivors: [survivor],
      });

      continue;
    }

    entry.rank = higherRank(entry.rank, rank);
    entry.line = Math.min(entry.line, survivor.line);
    entry.survivors.push(survivor);
  }

  const ranked = [...entries.values()].toSorted(byEntry);

  for (const entry of ranked) {
    entry.survivors.sort(byPosition);
  }

  const low = ranked.filter((entry) => entry.rank === 'Low').flatMap((entry) => entry.survivors);

  return {
    high: ranked.filter((entry) => entry.rank === 'High'),
    medium: ranked.filter((entry) => entry.rank === 'Medium'),
    low,
  };
};
