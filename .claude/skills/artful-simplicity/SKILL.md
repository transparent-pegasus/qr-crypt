---
name: artful-simplicity
description: Ask whether this repository's simplicity — implementation design, logic, tests, docs and comments — is at the level of art. Use for design review, simplicity audit, excessive tests, redundant comments, over-engineering audit, /artful-simplicity.
---

# Artful simplicity

Is the simplicity of this repository's implementation design, logic, tests, and
docs/comments at the level of art? In particular, do the tests cover only logic,
and do the docs and comments say what is needed in the shortest words?

## The bar

Textbook: from one file alone, a competent engineer who has never seen this
repository can name the single idea it embodies, predict its body from its name,
and hold nothing else in their head.

- A cold reading decides local comprehensibility and nothing else. "What breaks
  without it?" is a repository-level question and the reader has one file, so a
  reader who answers "nothing" is following the procedure correctly and is often
  wrong. `delete` and `fold` are candidate labels, never prescriptions; `rewrite`
  needs no evidence beyond the reading.
- Delete only after proving reachability across `src` and `tests`, that no
  freshness unit or invariant names it, and stating the security consequence of
  its removal.
- Fold only after a semantic-equivalence proof covering pending,
  already-resolved, cancellation, close/reopen, and error. That list is not
  generic: an argument that covered the unresolved async state and never examined
  the already-resolved one is how the one avoidable behavior regression shipped.
- Hunt contradictions, not excess. Every real finding so far was two things
  disagreeing — two definitions of one function, two surfaces disagreeing about
  one switch — not too much code.
- Move a concept between files only when two or more independent readers placed
  its pieces in different files. That is what separates a discovered boundary
  from an invented one.
- State four things before any behavior change: what changes; who observes it, as
  a reachable path; direction, safer or less safe; what breaks under the opposite
  choice. Direction decides, not size.

Never a finding: whatever `../freshness/targets.yaml` marks append-only or frozen.
Deleting one of those wipes stored preferences or breaks a golden; it does not
simplify.
