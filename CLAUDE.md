@CLAUDE.local.md

# Project Goal

Build fully offline encryption engineered against nation-state cryptanalysis and compromise; reject any transfer—including removable storage—that cannot meet this threat model.

# Rules

- No backward compatibility. Installs never update, so no legacy value, migration, or rollback path.
- On task completion, follow `.claude/skills/freshness/SKILL.md`: add new time-decaying files to `targets.yaml`; for listed files touched or invalidated, refresh and verify affected units; stamp only passed units; verify, never stamp, invariants.

# Simplicity

The bar is textbook: from one file alone, a competent engineer who has never seen this repository can name the single idea it embodies, predict its body from its name, and hold nothing else in their head.

- A cold reading decides local comprehensibility and nothing else. "What breaks without it?" is a repository-level question and the reader has one file, so a reader who answers "nothing" is following the procedure correctly and is often wrong. `delete` and `fold` are candidate labels, never prescriptions; `rewrite` needs no evidence beyond the reading.
- Delete only after proving reachability across `src` and `tests`, that no freshness unit or invariant names it, and stating the security consequence of its removal.
- Fold only after a semantic-equivalence proof covering pending, already-resolved, cancellation, close/reopen, and error. That list is not generic: an argument that covered the unresolved async state and never examined the already-resolved one is how the one avoidable behavior regression shipped.
- Hunt contradictions, not excess. Every real finding so far was two things disagreeing — two definitions of one function, two surfaces disagreeing about one switch — not too much code.
- Move a concept between files only when two or more independent readers placed its pieces in different files. That is what separates a discovered boundary from an invented one.
- State four things before any behavior change: what changes; who observes it, as a reachable path; direction, safer or less safe; what breaks under the opposite choice. Direction decides, not size.
- Never a finding: anything `targets.yaml` marks append-only or frozen. Deleting one wipes stored preferences or breaks a golden; it does not simplify.
