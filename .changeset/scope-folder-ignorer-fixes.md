---
'@sqve/mutation': patch
---

Match `mutate` globs that start with `./` or `../`, and absolute globs, for both inclusion and `!`
exclusion, as Stryker does. Before, such a config silently dropped every changed file. With
`--same-folder-tests` and the Bun runner, ignore a top-level `testFiles` in the config, so only the
tests in the folder run. Refuse a config that names an ignorer other than `tauMessageIgnorer` when
`--max-mutants` or `--same-folder-tests` is set, because the mutant count cannot apply it.

Fail the status for a false survivor, as for a survivor. A static mutant that makes a Vitest test
skip itself looks the same as a test file load failure in Stryker's report, so it can no longer hide
a real survivor.
