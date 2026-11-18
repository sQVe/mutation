# Mutation

Diff-scoped StrykerJS mutation testing with a JSON report, published as `@sqve/mutation`. Read the
[README](README.md) for usage.

- Run `pnpm run check` before finishing changes. It runs typechecking, `stomme check`, the style
  check through `stomme-ts-style`, the format check, the build, and all tests, including the command
  tests that run Stryker with the Vitest and Bun runners.
- Fix style with `pnpm style:fix`; it lints with the house rules, then formats.
- A change to `src/` needs a changeset. Create it with `pnpm changeset`.
- Name values in camelCase and types in PascalCase. Never SCREAMING_CASE, not even for module
  constants.
- Never tell a reader to write `// Stryker disable` comments in the README or in source.

## Tests

- Test behavior a caller can observe: the command's exit status and JSON report, or a pure
  function's output.
- Command tests run the real command on a small temporary Git repository. Keep fixtures to one or
  two small source files, set Stryker `concurrency` to 1 or 2, and run the Stryker runs one after
  another.
- Use temporary directories for fixtures and remove them when the test finishes.
- Never drop assertions or failure cases to save time.

<!-- prettier-ignore-start -->
<!-- stomme:start -->
# Shared rules

- Run the full check before finishing changes: `pnpm run check`.
- Format with the `format` script in `package.json`.
- Follow the decisions in [docs/adr](docs/adr/README.md).
- Follow the shared ADRs in [docs/stomme/shared/adr](docs/stomme/shared/adr/README.md).
- Record new decisions in [docs/adr](docs/adr/README.md).
- Edit an ADR in place when its details change.
- Comment only what the code cannot say. Never describe history.
- Document decisions, not features. See [ADR 0001](docs/stomme/shared/adr/0001-documentation-scope.md).
- Read [the general guide](docs/stomme/shared/coding.md).
- Read [the TypeScript guide](docs/stomme/languages/typescript/guide.md).
<!-- stomme:end -->
<!-- prettier-ignore-end -->
