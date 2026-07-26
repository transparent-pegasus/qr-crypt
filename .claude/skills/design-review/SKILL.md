---
name: design-review
description: Judge whether this repository's design simplicity holds up — implementation logic, test scope, and the wording of docs and comments. Read-only: findings go to .tmp/, nothing is edited. Use for 設計レビュー, シンプルさ監査, 過剰なテスト, 冗長なコメント, over-engineering audit, /design-review.
---

# Design review

One question, three axes: is this the shortest thing that still works?

## Scope

`/design-review` covers the tracked files (`git ls-files`) except
`design-system/pages/` — archival exports of the retired RSA-era UI.
`/design-review <path>…` narrows to those paths together with their tests and
the docs that mirror them.

## Axes

1. **Logic.** Excess: an abstraction with one implementation; a config value
   that never varies; a branch or export nothing reaches; a re-implementation of
   what the repo already has; a call chain crossing layers to do three lines of
   work.
2. **Tests.** They verify logic — no more, no less. Excess: assertions about
   appearance (class names, styles, layout; a class used only as a locator is
   fine); a case that adds no observation another already makes; a test that
   mirrors the implementation instead of its contract. Missing: a branch, bound,
   or failure path nothing exercises.
3. **Words.** Docs and comments say it in the fewest words that keep the
   information whole. Excess: a comment restating the code; a fact stated in two
   places; preamble. Missing: a non-obvious constraint left unwritten — why a
   value is that value.

## Before filing

Excess needs proof, not resemblance: show that no second consumer, trust
boundary, failure mode, or policy decision depends on the thing. One finding per
distinct smell.

## Not excess

- Whatever the `invariants:` in [`../freshness/targets.yaml`](../freshness/targets.yaml)
  protect — append-only allowlists, historical read paths, retired-profile
  negative tests.
- Frozen goldens and vendored KAT/ACVP vectors, with the provenance comments
  that pin them.
- Security disclosure copy — the file lists of that registry's `ui-security-copy`
  and `readme` units.
- One contract asserted at two layers, when each layer can fail on its own.

`CLAUDE.md`'s "no backward compatibility" governs new design. It does not
authorize deleting a read path that stored user data still needs.

## Output

Write `.tmp/design-review-<today, YYYY-MM-DD>.md`; change nothing else.

One section per axis, headed `## Logic`, `## Tests`, `## Words`. Each opens with

`判定: 合格|要修正 (N件)`

then one line per finding:

`path:line — what is excess or missing — what replaces it — what is lost`

The cost is mandatory: a finding that cannot name one is not yet understood.
Close with one line for the repository — does its simplicity hold, or where does
it break first?
