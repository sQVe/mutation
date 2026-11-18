# Architecture decision records

Record lasting decisions and the reasons behind them, not how a feature works.

## Before writing

Follow [ADR 0001](../stomme/shared/adr/0001-documentation-scope.md) for documentation scope and the
ADR process. Before opening the [template](./TEMPLATE.md), answer:

- What choice are we making, and what lasting reason stands behind it?
- What credible alternative did we consider, and why did we reject it?

If the answers only restate what the code does, do not write an ADR. If the choice holds for every
stomme project, it belongs in the [shared ADRs](../stomme/shared/adr/README.md).

Use a title that names the choice, and state that choice in the first sentence of the Decision
section. Give each rejected or deferred alternative its own heading under Alternatives considered.

## Keeping ADRs current

An ADR states the current decision. When its details change, edit it in place. Supersede it only
when the core choice reverses. The new ADR then states the whole current rule and has a Supersedes
line that names the old ADR without a link. Delete the old file, and add a row for it to the Retired
table. Numbers are never reused. To read a retired ADR, run `git show <commit>:docs/adr/<file>` with
the commit in its row.

## Index

## Retired

| ADR | Title | Replaced by | Last commit |
| --- | ----- | ----------- | ----------- |
