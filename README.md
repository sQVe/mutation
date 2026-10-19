# mutation

Diff-scoped [StrykerJS](https://stryker-mutator.io) mutation testing with a JSON report, for Vitest
and Bun projects. The package is `@sqve/mutation` and the command is `mutation`.

`mutation` runs Stryker in the Git repository of the current directory. It needs a Stryker config in
the repository root and prints one JSON report on stdout. Stryker's own output goes to stderr.

## Install

Install the package, Stryker, and the runner for your tests:

```bash
pnpm add -D @sqve/mutation @stryker-mutator/api @stryker-mutator/core \
  @stryker-mutator/instrumenter @stryker-mutator/util @stryker-mutator/vitest-runner
```

For Bun, install `@hughescr/stryker-bun-runner` instead of the Vitest runner. Node 24.21 or newer
runs the command.

## Usage

```bash
mutation [--same-folder-tests] changed <base> [--max-mutants <n>] [--config <path>]
mutation [--same-folder-tests] audit <path>... [--max-mutants <n>] [--config <path>]
```

- `changed <base>` mutates the lines that `git diff -U0 <base>` adds against the working tree, and
  every line of each untracked file.
- `audit <path>...` mutates whole files.
- `audit` runs Stryker with `disableBail: true`, so `killedBy` lists every test that fails a mutant.
  `changed` runs with `disableBail: false`. Both override the config value. `audit` also sets
  `incremental: false`, because a reused result from a run with bail on lists only one test.
- `--same-folder-tests` runs Stryker once per folder. Each run executes only the `*.test.ts` and
  `*.test.tsx` files directly in that folder, so a test in another folder cannot cover or kill a
  mutant. A folder with no such test reports its mutants as `NoCoverage` without a run. The switch
  needs `testRunner` to be `vitest` or `bun`. The Bun runner gets the files as `bun.testFiles`. The
  Vitest runner gets a generated config that extends your Vitest config (`vitest.configFile`, or the
  `vitest.config.*` or `vite.config.*` file in the root), sets `test.include` to those files, and
  turns `vitest.related` off. The switch is off by default.
- `--max-mutants` sets a cap. There is no cap by default.
- `--config` names the Stryker config. The default is `stryker.config.json` in the root.

The command sets `thresholds.break` to `null`, so the report alone decides the exit code. It
replaces `mutate` with the computed ranges and writes Stryker's JSON report to a temporary
directory.

## Defaults

The command applies these defaults to your config. A value you set always wins.

| Key            | Default                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `plugins`      | Your list (Stryker's `@stryker-mutator/*` if unset) plus the package's ignorer. |
| `ignorers`     | Your list plus `tauMessageIgnorer`.                                             |
| `ignoreStatic` | `true`.                                                                         |
| `timeoutMS`    | Stryker's own default. The command does not set it.                             |

The ignorer is also an export, `@sqve/mutation/ignorer`. It skips the string mutants of:

- the message of a built-in error: argument 0 of `Error`, `TypeError`, `RangeError`, `SyntaxError`,
  `ReferenceError`, `EvalError`, or `URIError`, and argument 1 of `AggregateError`;
- argument 0 of `new X(...)` when `X` ends in `Error` and the call has exactly one argument;
- an argument after the first of `invariant(...)`;
- the `error` value of an object literal that also has `ok: false`;
- the value of a property named `message`, `title`, `text`, or `disabledReason` in any object
  literal;
- an element of an array that is the value of a property named `lines`.

In each of these places, the ignorer skips:

- a string literal;
- a template literal whose expressions are only identifiers, member accesses, or calls whose
  arguments are identifiers, member accesses, or literals;
- each string branch of a conditional, such as `ready ? 'Ready' : 'Not ready'`. The condition keeps
  its mutants.

A template with a conditional, logical, binary, unary, or update expression is kept whole, because
Stryker cannot skip a node without its children. The ignorer reads only syntax, so text that reaches
one of these places through a variable is not skipped.

## What your config sets

Your Stryker config holds your own policy:

- `mutate`: globs of the production files. A file counts as production code when a positive glob
  matches it and no `!` glob does. The list must be non-empty, or the command exits 1 with an error
  that names the config.
- `testRunner` and the runner's `plugins` entry, such as `@stryker-mutator/vitest-runner` or
  `@hughescr/stryker-bun-runner`. With pnpm, list the runner in `plugins`, because Stryker's
  `@stryker-mutator/*` pattern does not find it there.
- Timeouts, such as `timeoutMS` and the runner's own timeout.
- Left-out modules, as `!` globs in `mutate` and `ignorePatterns`.
- Any other Stryker option, such as `coverageAnalysis` and `concurrency`.

A minimal config for Vitest:

```json
{
  "testRunner": "vitest",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "coverageAnalysis": "perTest",
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"],
  "checkers": []
}
```

## Cap

Without `--max-mutants`, every file in scope runs. With it, the command counts the mutants of each
file with the Stryker instrumenter before the run. Ignored mutants do not count. Files get their
budget in path order. A file that does not fit is not mutated and is listed in `unmutated`. Later
files that fit still run. After the run, a file that had mutants in the count but none in Stryker's
report is also listed in `unmutated`. The exit code is 1 in both modes when any file is unmutated.

The count includes static mutants, because Stryker finds them only after its first test run. With
`ignoreStatic` they count against the cap although Stryker ignores them.

## Exit codes

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| 0    | `pass`, `nothing`, or survivors in `audit` mode                           |
| 2    | `survivors` in `changed` mode                                             |
| 1    | `error`: usage, Stryker failure, unmutated files, or only invalid mutants |

## Report

```json
{
  "version": 1,
  "mode": "changed",
  "status": "survivors",
  "error": "only with status error",
  "survivors": [
    {
      "file": "src/a.ts",
      "line": 3,
      "column": 7,
      "endLine": 3,
      "endColumn": 11,
      "mutator": "Regex",
      "original": "/a+/",
      "replacement": "/a/",
      "covered": true
    }
  ],
  "falseSurvivors": [],
  "unmutated": ["src/b.ts"],
  "totals": {
    "mutants": 10,
    "killed": 8,
    "survived": 1,
    "noCoverage": 1,
    "timeout": 0,
    "invalid": 0,
    "falseSurvived": 0
  }
}
```

- In `audit` mode the report also has `testsWithNoUniqueKill`. It lists each test whose killed
  mutants are all killed by another test too, and each test that kills no mutant (`kills` is `[]`).
  Entries are sorted by `file` (the test file), then `test` (the test name). `kills` have the shape
  of `survivors` without `covered`. Only `Killed` mutants with a `killedBy` list count. The list
  never changes `status` or the exit code. It is `[]` when Stryker did not run. `changed` mode and a
  report with `mode` `null` have no such field.
- `mode` is `null` when the command line named none.
- `status` is `pass`, `survivors`, `nothing`, or `error`. `nothing` means no production line or no
  mutant was in scope.
- Survivors are `Survived` and `NoCoverage` mutants. `covered` is false for `NoCoverage`. Lines and
  columns count from 1, and the end column is exclusive.
- `totals.invalid` counts `CompileError` and `RuntimeError` mutants. When every mutant is invalid,
  the status is `error`.
- A false survivor is a static mutant that the Vitest runner reports as `Survived` although fewer
  tests completed than planned. The planned count is the number of tests in `coveredBy` when the
  report's `config.ignoreStatic` is true. Otherwise it is every test in the report. The mutant made
  a test file throw while Vitest loaded it, so no test in that file ran. `falseSurvivors` lists them
  in the shape of `survivors`. They are not in `survivors` or `totals.survived`, and they do not
  change the status. The Bun runner scores a load failure as `Killed`, so it has none.
