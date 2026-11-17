---
'@sqve/mutation': minor
---

Move the shared run settings into the package. A project config now holds only what is particular to
it, and a value the project sets still wins.

- `concurrency` defaults to `25%` of the CPU count. Stryker's own `cpuCount - 1` starts a test
  runner per core, which timed out mutants on a large monorepo.
- `timeoutMS: 20000`, `timeoutFactor: 4`, and `dryRunTimeoutMinutes: 20`.
- `fileLogLevel: 'off'`.
- `tempDirName: '.tau/stryker-tmp'`, `cleanTempDir: true`, `incremental: true`, and
  `incrementalFile: '.tau/stryker-incremental.json'`, so runs reuse earlier results and leave no
  temp directory behind. `audit` and `--same-folder-tests` runs turn `incremental` off, because they
  must not reuse another run's result.
- `coverageAnalysis: 'perTest'`.

The temp directory and the incremental file live under `.tau/`, so ignore that folder in Git. The
report holds only the mutants of the current diff, because Stryker's incremental file can add a
result from an earlier run.
