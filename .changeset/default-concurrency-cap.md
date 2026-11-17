---
'@sqve/mutation': minor
---

Default `concurrency` to `25%` of the CPU count. Stryker's own default of `cpuCount - 1` starts a
test runner per core, which timed out mutants on a large monorepo. A `concurrency` value in your
config still wins.
