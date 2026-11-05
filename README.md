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
mutation report <report.json> [--low-weight <glob>]... [--markdown <path>]
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
  turns `vitest.related` off. In-source tests (`test.includeSource`) do not run in this mode. The
  generated patterns are relative to the config's `root`. In Bun mode the command drops a top-level
  `testFiles` from your config. The switch is off by default.
- `--max-mutants` sets a cap. There is no cap by default. `--max-mutants` and `--same-folder-tests`
  count mutants with the built-in `tauMessageIgnorer` only, because Stryker has no small public way
  to load other ignorers for the count. When the config's `ignorers` names any other ignorer, the
  command exits 1 with an error before any Stryker run.
- `--config` names the Stryker config. The default is `stryker.config.json` in the root.
- `report <report.json>` reads a report in the shared shape below, prints a GitHub warning
  annotation per survivor, and writes Markdown for a pull request comment. See
  [Report command](#report-command).

The command sets `thresholds.break` to `null`, so the report alone decides the exit code. It
replaces `mutate` with the computed ranges and writes Stryker's JSON report to a temporary
directory.

## Defaults

The command applies these defaults to your config. It always adds the ignorer and its plugin, even
to lists you set. For `ignoreStatic` and `timeoutMS`, a value you set wins.

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
- an element of an array that is the value of a property named `lines`;
- an argument of `problems.push(...)`, `messages.push(...)`, `errors.push(...)`,
  `warnings.push(...)`, `issues.push(...)`, or `failures.push(...)`, where the array is a plain
  identifier.

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
      "group": "value",
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

The `version` stays `1`, and every existing field keeps its name and meaning. Every survivor, in
`survivors` and `falseSurvivors`, has a required `group`: `controlFlow`, `value`, or `literal`. The
producer sets it, because only the producer knows the details. `covered` is `true`, `false`, or
`null` when the producer does not know. A survivor may carry an optional `function`, the enclosing
function name.

A cargo-mutants survivor maps like this. The adapter writes `covered` as `null`:

```json
{
  "file": "crates/tikk-core/src/lib.rs",
  "line": 6,
  "column": 16,
  "endLine": 6,
  "endColumn": 18,
  "mutator": "BinaryOperator",
  "group": "controlFlow",
  "original": "==",
  "replacement": "!=",
  "covered": null,
  "function": "is_even"
}
```

cargo-mutants totals map `missed` to `survived`, `caught` to `killed`, `unviable` to `invalid`, and
`noCoverage` to `0`.

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
  report's `config.ignoreStatic` is true. Otherwise it is every test in the report. The mutant may
  have made a test file throw while Vitest loaded it, or it may have made a test skip itself, such
  as with `it.skipIf`. Stryker's report does not tell the two apart. `falseSurvivors` lists them in
  the shape of `survivors`. They are not in `survivors` or `totals.survived`, but they change the
  status like survivors: `survivors`, and exit code 2 in `changed` mode. Check each one by hand. The
  Bun runner scores a load failure as `Killed`, so it has none.

## Report command

`mutation report <report.json>` reads a report in the shared shape and ranks its survivors without
running Stryker. It prints one GitHub `::warning` workflow command per survivor on stdout, ordered
High, Medium, then Low. With `--markdown <path>` it also writes Markdown for the pull request
comment and the job summary.

`--low-weight <glob>` marks a path as low weight. Repeat it for several globs. A survivor is Low
when it is uncovered (`covered` is false), or when it is a `literal` survivor in a low-weight path.
Otherwise it is High when its `group` is `controlFlow` and the path is not low weight, and Medium
for every other survivor. A low-weight `controlFlow` survivor is Medium; a low-weight `literal` is
Low.

Survivors of one file and the same `function`, or else of one line, form one entry. The entry takes
the highest rank of its survivors. High and Medium list each entry and its survivors. Low folds into
one count per file. The exit code is 0 for `pass`, `nothing`, and `survivors`, and 1 for a status
`error`, a missing or unreadable file, an invalid report, or a usage error. An unreadable or invalid
report still writes Markdown that names the reason.

## GitHub Action

The repository root has a composite action that runs the report command, appends the Markdown to the
job summary, and posts or updates one sticky pull request comment. The comment is updated when an
existing comment starts with the report marker and was made by a Bot; otherwise the action posts a
new one. A failed comment post only warns, so the comment step warns and the run still passes on a
fork pull request with a read-only token. The action exits with the report command's exit code.

Run the action in its own job, apart from the job that runs the mutation tool. The action needs
`pull-requests: write`, and any code that runs on the same runner before it can reach that token,
for example by changing the environment of later steps through `$GITHUB_ENV`. The mutation job runs
the pull request's code and its dependencies' install scripts, so it gets a read-only token and
hands the report over as an artifact. The report job then runs no code from the pull request:

- It checks out nothing from the pull request, so it never loads the pull request's `action.yml`.
- It pins the action to a commit and the reporter to a published version, and never runs the
  repository's installed copy.
- It restores no dependency cache, because a pull request run can save one.
- It reads the report only as data. The reporter validates it, and the pull request number comes
  from the event.

```yaml
jobs:
  mutation:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      # Install the project's dependencies, @sqve/mutation and Stryker included.
      - run: pnpm install --frozen-lockfile
      # The report job decides the result, so a run with survivors must not stop this job.
      - run: pnpm exec mutation changed "$baseSha" > "$RUNNER_TEMP/mutation.json" || true
        env:
          baseSha: ${{ github.event.pull_request.base.sha }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: mutation-report
          path: ${{ runner.temp }}/mutation.json
          if-no-files-found: error

  mutation-report:
    needs: mutation
    if: always()
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: actions/download-artifact@v4
        with:
          name: mutation-report
          path: ${{ runner.temp }}/mutation-report
      - uses: sQVe/mutation@<commit SHA>
        with:
          report: ${{ runner.temp }}/mutation-report/mutation.json
          command: npx --yes @sqve/mutation@<version>
          low-weight-paths: |
            src/generated/**
```

Pin `sQVe/mutation` to a full commit SHA and `@sqve/mutation` to an exact version, so a new commit
on this repository's `main` or a new npm release cannot change what runs with the token.
`fetch-depth: 0` fetches the base commit that `changed` compares with. The action gives its token
only to the `gh api` calls, not to the report command. A pull request can still change the workflow
file itself, but only a person who can already push a branch can open one from the same repository,
and a push can already run any workflow.

Inputs:

| Input              | Required | Default                    | Meaning                                                     |
| ------------------ | -------- | -------------------------- | ----------------------------------------------------------- |
| `report`           | yes      |                            | Path to the report JSON.                                    |
| `low-weight-paths` | no       |                            | Newline-separated globs, passed as repeated `--low-weight`. |
| `command`          | no       | `npx --yes @sqve/mutation` | How to run the CLI.                                         |
| `github-token`     | no       | `${{ github.token }}`      | Token that posts or updates the comment.                    |

The action needs `pull-requests: write` to post the comment.
