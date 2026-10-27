# @sqve/mutation

## 0.1.3

### Patch Changes

- [#11](https://github.com/sQVe/mutation/pull/11)
  [`6d93424`](https://github.com/sQVe/mutation/commit/6d9342477d578f8bedee34ff5990c63f1e4969b0)
  Thanks [@sQVe](https://github.com/sQVe)! - Skip the string mutants of a message pushed onto a
  `problems`, `messages`, `errors`, `warnings`, `issues`, or `failures` array in
  `tauMessageIgnorer`. Strings pushed onto other arrays, or onto a member such as `this.problems`,
  keep their mutants.

## 0.1.2

### Patch Changes

- [#9](https://github.com/sQVe/mutation/pull/9)
  [`1c34352`](https://github.com/sQVe/mutation/commit/1c34352f052ad89078ca92aa2b465bfde2d2928c)
  Thanks [@sQVe](https://github.com/sQVe)! - Fail the run with an error when Stryker reports a
  mutant status the gate does not know, such as `Pending`, instead of passing.

## 0.1.1

### Patch Changes

- [#5](https://github.com/sQVe/mutation/pull/5)
  [`a95479f`](https://github.com/sQVe/mutation/commit/a95479fbf76d16066847b153c62b6de4825baf41)
  Thanks [@sQVe](https://github.com/sQVe)! - Correct the README on defaults: the command always adds
  the ignorer and its plugin, even to `plugins` and `ignorers` lists you set. Only `ignoreStatic`
  and `timeoutMS` take your value.

## 0.1.0

### Minor Changes

- [#1](https://github.com/sQVe/mutation/pull/1)
  [`734e5e2`](https://github.com/sQVe/mutation/commit/734e5e27bf94b459ce44c87e9590927db96cb571)
  Thanks [@sQVe](https://github.com/sQVe)! - Add the `mutation` command. It runs StrykerJS on the
  lines a Git diff changes, or on whole files, with the Vitest or the Bun runner, and prints a JSON
  report. The package also exports the `tauMessageIgnorer` Stryker plugin as
  `@sqve/mutation/ignorer`.

### Patch Changes

- [#3](https://github.com/sQVe/mutation/pull/3)
  [`1fdd236`](https://github.com/sQVe/mutation/commit/1fdd236980f5ab2f10013615cf7854c63a4cadc4)
  Thanks [@sQVe](https://github.com/sQVe)! - Leave files that the Stryker config's `ignorePatterns`
  ignores out of the changed scope, matching Stryker's own rules, instead of reporting them as
  unmutated. With `--same-folder-tests`, refuse an unsupported runner before any folder runs, even
  when a changed file's folder has no tests.

- [#4](https://github.com/sQVe/mutation/pull/4)
  [`53c5db9`](https://github.com/sQVe/mutation/commit/53c5db9534495de1293ca15485cef78fa9b886b7)
  Thanks [@sQVe](https://github.com/sQVe)! - Match `mutate` globs that start with `./` or `../`, and
  absolute globs, for both inclusion and `!` exclusion, as Stryker does. Before, such a config
  silently dropped every changed file. With `--same-folder-tests` and the Bun runner, ignore a
  top-level `testFiles` in the config, so only the tests in the folder run. Refuse a config that
  names an ignorer other than `tauMessageIgnorer` when `--max-mutants` or `--same-folder-tests` is
  set, because the mutant count cannot apply it.

  Fail the status for a false survivor, as for a survivor. A static mutant that makes a Vitest test
  skip itself looks the same as a test file load failure in Stryker's report, so it can no longer
  hide a real survivor.
