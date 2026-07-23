---
name: freshness
description: Batch-refresh everything in this repo that decays with time — package updates (aube), vulnerability/advisory info, threat model, security docs, browser matrix, dated benchmarks, ACVP vectors, external links. Reads targets.yaml in this directory as the registry of update targets. Use for パッケージ更新, 脆弱性情報の更新, 脅威モデル更新, 定期更新, dependency refresh, stale docs, freshness sweep, /freshness.
---

# Freshness sweep

Everything time-decaying in this repo is registered in [`targets.yaml`](targets.yaml)
next to this file — the single source of truth for WHAT to refresh, HOW, and
WHEN. This skill is the procedure that consumes it.

Two registry sections:

- **`units`** — coherent update operations (a unit may span several files).
  Due when `last_checked` is null or `today - last_checked >= cadence_days`.
- **`invariants`** — check-only guards. A sweep verifies them and must never
  "refresh" them: several are append-only exactly because removing old values
  wipes user data (see Hard rules).

## Workflow

1. **Read `targets.yaml`.** Compute due units from `last_checked` +
   `cadence_days` against today's date.
   - No arguments → sweep all due units, then verify all invariants.
   - Unit ids as arguments (e.g. `/freshness deps threat-model`) → only those,
     plus every invariant touching the same files.
   - `all` → every unit regardless of due date.
2. **Order matters.** Run `deps` (and `crypto-noble` if due) first — advisory
   and version findings feed the doc units via each unit's `sync:` list. Then
   the remaining due units in registry order.
3. **Per unit:** follow `method`, run `verify`, and only after verify passes
   stamp `last_checked` with today's date (YYYY-MM-DD) — stamp even when no
   content change was needed; the stamp means "reviewed", not "changed".
   A failing verify leaves `last_checked` untouched and goes in the report.
4. **Propagate.** `sync:` ids form a deduplicated, transitive work queue:
   when a unit executes, enqueue its `sync:` units; each dequeued unit runs
   in full — its own `method`, its own `verify`, its own stamp — exactly like
   a due unit (e.g. a new advisory → threat-model §5.1 + security-review §1
   in the same sweep). A unit never runs twice in one sweep; a synced unit is
   never content-patched without its verify, and never stamped without
   executing.
5. **Invariants.** Run every invariant's `verify` — including, on selective
   runs, invariants touching any file actually edited during the sweep, not
   only the predeclared unit files. Invariants have no `last_checked`: they
   are verified, never stamped. Any failure is a release blocker: report it,
   do not "fix" it by loosening the rule.
6. **Report.** One table: unit | due reason | action taken | verify result |
   files touched. List skipped-but-due units explicitly. Update the registry's
   own `updated:` date if the registry itself changed.

## Hard rules

- **aube, never npm.** Every package-management and package-script command
  runs as `aube …` / `aube run …` (`aube outdated`, `aube audit`,
  `aube update <pkg>`, `aube ci`). Note `aube update <pkg>` stays in-range;
  cross-range/exact-pin moves need `aube update --latest [--exact]` and prior
  approval. Non-package tools (git, mise, curl, rg) are used directly.
- **No pushes from a sweep.** A freshness sweep runs locally; it never
  pushes branches or triggers deploys to "verify" something (ci-actions
  verifies via local checks or an existing user-authorized CI run).
- **Crypto pin discipline.** `@noble/post-quantum` moves only through the
  `crypto-noble` unit: changelog + FIPS errata read, KAT vectors
  (`test:pq-vectors`) and goldens green, security-review §1 updated — in one
  change. Never as a routine `deps` bump.
- **Append-only allowlists.** Boot allowlist, profile/wire vocabulary, and
  legacy normalization keep every historical id. Removing one bricks stored
  preferences and can force `wipeOnOnline` → data wipe. When in doubt, add,
  never delete.
- **No self-certified vectors.** ACVP expected values come from upstream NIST
  data only — never regenerated from our own implementation.
- **Absolute dates.** Every dated claim written during a sweep uses YYYY-MM-DD,
  no "recently"/"current".
- **Exact pins stay exact** (supply-chain history in threat-model §5.1) until
  the advisory check in `method` clears them.

## Registry maintenance

The registry must stay exhaustive: any task that introduces a new
time-decaying file (a dated table, a pinned version, a vendored dataset, an
external URL, a mirrored constant) adds it to `targets.yaml` in the same
change — that duty is anchored by the one-line rule in `/AGENTS.md`. When a
listed file is deleted or a pin becomes irrelevant, remove or annotate the
entry rather than letting it rot; note intentional gaps under `excluded:`.
