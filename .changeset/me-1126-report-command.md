---
'@sqve/mutation': minor
---

Add a `report` command that reads a shared mutation report, ranks survivors, prints GitHub warning
annotations, and writes Markdown for a pull request comment, plus a composite GitHub Action that
posts or updates the comment. Each survivor in the JSON report now has a `group`: `controlFlow`,
`value`, or `literal`.
