# Development

Set up a checkout and check changes before a pull request.

## Prerequisites

- [mise](https://mise.jdx.dev/getting-started.html), which installs the pinned stomme binary.
- Node.js 24.21.0 or later. `@sqve/stomme-ts-style` requires it.
- Bun 1.4.2. The command tests run the Bun runner.
- The pnpm version specified by `packageManager` in [package.json](../package.json).

## Set up

Run these commands from the checkout:

```sh
mise trust
mise install
pnpm install --frozen-lockfile
pnpm run check
```

Run `mise trust` before `mise install`. Older mise releases skip an untrusted `mise.toml`, install
nothing, and exit 0.

## Check

`pnpm run check` runs these steps in order:

1. `pnpm typecheck`: type-check with `tsc --noEmit`.
2. `pnpm stomme:check`: run `mise exec -- stomme check` for the shared stomme rules.
3. `pnpm style:check`: run the lint rules through `stomme-ts-style`.
4. `pnpm format:check`: check formatting.
5. `pnpm build`: build `dist/`.
6. `pnpm test`: run all tests, including the command tests that run Stryker with the Vitest and Bun
   runners.

Always run stomme through `mise exec`. A bare `stomme` on `PATH` may be another version.

## Change code

- `pnpm style:fix` applies safe lint fixes, then formats.
- `pnpm changeset` creates the changeset that every change to `src/` needs.
- After a change to the stomme pin, language, or layers in `stomme.toml`, run
  `mise exec -- stomme sync`. It rewrites `docs/stomme/` and the block in `AGENTS.md`. Never edit
  those by hand.
