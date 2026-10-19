---
'@sqve/mutation': patch
---

Leave files that the Stryker config's `ignorePatterns` ignores out of the changed scope, matching
Stryker's own rules, instead of reporting them as unmutated. With `--same-folder-tests`, refuse an
unsupported runner before any folder runs, even when a changed file's folder has no tests.
