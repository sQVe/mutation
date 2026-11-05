import type {
  RankedSurvivors,
  SharedSurvivor,
  SharedSurvivorReport,
  SurvivorEntry,
  SurvivorRank,
} from './survivorReport.ts';

const marker = '<!-- sqve/mutation report -->';

const heading = '## Mutation report';

const escapeData = (text: string) =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const escapeProperty = (text: string) =>
  escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

const locationProperties = (survivor: SharedSurvivor): string[] => {
  const properties = [
    `file=${escapeProperty(survivor.file)}`,
    `line=${survivor.line}`,
    `col=${survivor.column}`,
  ];

  if (survivor.endLine !== undefined) {
    properties.push(`endLine=${survivor.endLine}`);
  }

  if (survivor.endColumn !== undefined) {
    properties.push(`endColumn=${survivor.endColumn}`);
  }

  return properties;
};

const annotationOf = (survivor: SharedSurvivor, rank: SurvivorRank): string => {
  const properties = [
    ...locationProperties(survivor),
    `title=${escapeProperty(`Mutation survivor (${rank})`)}`,
  ];

  const message = escapeData(
    `${survivor.mutator}: ${survivor.original} => ${survivor.replacement}`,
  );

  return `::warning ${properties.join(',')}::${message}`;
};

export const warningAnnotations = (ranked: RankedSurvivors): string[] =>
  [...ranked.high, ...ranked.medium, ...ranked.low].flatMap((entry) =>
    entry.survivors.map((survivor) => annotationOf(survivor, entry.rank)),
  );

const longestBacktickRun = (text: string): number => {
  let longest = 0;

  for (const run of text.matchAll(/`+/g)) {
    longest = Math.max(longest, run[0].length);
  }

  return longest;
};

const codeSpan = (text: string): string => {
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';

  return `${fence}${pad}${text}${pad}${fence}`;
};

const snippet = (text: string): string => {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim();

  return collapsed === '' ? '(empty)' : codeSpan(collapsed);
};

const entryLocation = (entry: SurvivorEntry): string => {
  const at = `${entry.file}:${entry.line}`;

  return entry.function === undefined ? at : `${at} (${entry.function})`;
};

const survivorBullet = (survivor: SharedSurvivor): string =>
  `- ${snippet(survivor.mutator)}: ${snippet(survivor.original)} => ${snippet(survivor.replacement)}`;

const entryMarkdown = (entry: SurvivorEntry): string[] => [
  `- ${codeSpan(entryLocation(entry))}`,
  ...entry.survivors.map((survivor) => `  ${survivorBullet(survivor)}`),
];

const countSurvivors = (entries: SurvivorEntry[]) =>
  entries.reduce((sum, entry) => sum + entry.survivors.length, 0);

const summaryLine = (report: SharedSurvivorReport, ranked: RankedSurvivors): string => {
  const high = countSurvivors(ranked.high);
  const medium = countSurvivors(ranked.medium);
  const low = countSurvivors(ranked.low);
  const total = high + medium + low;

  return `${report.totals.mutants} mutants, ${report.totals.killed} killed: ${total} survivors (${high} High, ${medium} Medium, ${low} Low).`;
};

const lowSection = (entries: SurvivorEntry[]): string[] => {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    counts.set(entry.file, (counts.get(entry.file) ?? 0) + entry.survivors.length);
  }

  const files = [...counts.keys()].toSorted();

  return [
    '### Low',
    '',
    'Not covered, or a literal mutant in a low-weight path.',
    '',
    ...files.map((file) => {
      const count = counts.get(file) ?? 0;
      const noun = count === 1 ? 'survivor' : 'survivors';

      return `- ${codeSpan(file)}: ${count} ${noun}`;
    }),
    '',
  ];
};

const statusText = (report: SharedSurvivorReport): string => {
  if (report.status === 'pass') {
    return `No survivors: ${report.totals.mutants} mutants, ${report.totals.killed} killed.`;
  }

  if (report.status === 'nothing') {
    return 'No mutants in scope.';
  }

  return report.error ?? 'The report has status "error" without an error message.';
};

export const survivorReportMarkdown = (
  report: SharedSurvivorReport,
  ranked: RankedSurvivors,
): string => {
  const lines = [marker, heading, ''];

  if (report.status !== 'survivors') {
    lines.push(statusText(report));

    return `${lines.join('\n')}\n`;
  }

  lines.push(summaryLine(report, ranked), '');

  if (ranked.high.length > 0) {
    lines.push(
      '### High',
      '',
      'A branch or condition that no test caught, outside low-weight paths.',
      '',
      ...ranked.high.flatMap(entryMarkdown),
      '',
    );
  }

  if (ranked.medium.length > 0) {
    lines.push(
      '### Medium',
      '',
      'Any other survivor that tests run, or may run, without catching it.',
      '',
      ...ranked.medium.flatMap(entryMarkdown),
      '',
    );
  }

  if (ranked.low.length > 0) {
    lines.push(...lowSection(ranked.low));
  }

  return `${lines.join('\n')}\n`;
};

export const unreadableReportMarkdown = (reason: string): string =>
  [marker, heading, '', `Could not read the report: ${reason}`, ''].join('\n');
