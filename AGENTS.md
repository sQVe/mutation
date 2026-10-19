# Mutation

Diff-scoped StrykerJS mutation testing with a JSON report, published as `@sqve/mutation`. Read the
[README](README.md) for usage.

- Run `pnpm run check` before finishing changes. It runs typechecking, the style check through
  `seam`, the format check, the build, and all tests, including the command tests that run Stryker
  with the Vitest and Bun runners.
- Fix style with `pnpm style:fix`; it lints with the house rules, then formats.
- A change to `src/` needs a changeset. Create it with `pnpm changeset`.
- Name values in camelCase and types in PascalCase. Never SCREAMING_CASE, not even for module
  constants.
- Declare a helper before the code that uses it. Join at most three checks in one condition, and do
  not mix `&&` with `||`; name the inner group instead.
- Comment only what the code cannot say, such as a constraint or a workaround. Do not cite tickets,
  ADRs, or reviews, and do not describe the code's history.
- Never tell a reader to write `// Stryker disable` comments in the README or in source.

## Tests

- Test behavior a caller can observe: the command's exit status and JSON report, or a pure
  function's output.
- Command tests run the real command on a small temporary Git repository. Keep fixtures to one or
  two small source files, set Stryker `concurrency` to 1 or 2, and run the Stryker runs one after
  another.
- Use temporary directories for fixtures and remove them when the test finishes.
- Never drop assertions or failure cases to save time.
