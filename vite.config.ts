import { format, lint, vitest } from '@sqve/stomme-ts-style';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    extends: [lint, vitest],
    ignorePatterns: ['dist/**'],
  },
  fmt: {
    ...format,
    // Local agent state is not source and must not be reformatted.
    ignorePatterns: ['pnpm-lock.yaml', '.tau/**', 'dist/**', 'docs/stomme/**'],
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
