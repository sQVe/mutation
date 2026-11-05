import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflowText = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

// A job runs from its two-space key to the next two-space key or the end of the file.
const jobText = (name: string): string => {
  const header = `\n  ${name}:\n`;
  const start = workflowText.indexOf(header);

  if (start === -1) {
    throw new Error(`ci.yml has no job ${name}`);
  }

  const rest = workflowText.slice(start + header.length);
  const next = rest.search(/\n {2}[a-z][\w-]*:\n/);

  return next === -1 ? rest : rest.slice(0, next);
};

describe('ci.yml mutation jobs', () => {
  it('gives the job that runs pull request code no write permission', () => {
    const mutation = jobText('mutation');

    expect(mutation).not.toContain('pull-requests: write');
    expect(mutation).not.toContain('uses: ./');
    expect(mutation).toContain('persist-credentials: false');
  });

  it('uploads the report even when the mutation run fails', () => {
    expect(jobText('mutation')).toMatch(
      /uses: actions\/upload-artifact@[0-9a-f]{40}[^\n]*\n {8}if: always\(\)\n/,
    );
  });

  it('runs the report job with the token on trusted code only', () => {
    const report = jobText('mutation-report');

    expect(report).toContain('needs: mutation');
    expect(report).toContain("if: always() && github.event_name == 'pull_request'");
    expect(report).toContain('pull-requests: write');
    expect(report).toMatch(/ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n/);
    expect(report).not.toContain('cache:');
  });
});
