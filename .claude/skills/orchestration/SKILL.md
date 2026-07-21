---
name: orchestration
description: "Route every task received directly from the user through the pane that received it (the orchestrator) in herdr unless the user explicitly denies orchestration. Does NOT apply to tasks delegated from another pane — execute those yourself, never re-delegate. Role assignments are defined in a swappable roles.yaml file next to the skill: planning/design is done by the orchestrator and double-reviewed by Reviewer agents; complex coding goes to Coder agents; everything else goes to Generalist agents, via using-herdr-sibling-panes. Roles bind to agent types, not reserved panes — any idle pane of the right type can take any task."
---

# Orchestration

## Role assignments (swap in roles.yaml)

Role-to-agent assignments live in [`roles.yaml`](roles.yaml) — the single source of truth for who does what. To change an assignment, edit ONLY that file; the rest of the skill refers to roles, not tool names. Read `roles.yaml` at the start of every orchestrated task to resolve which agent type each role maps to.

Panes are NOT reserved per role. Roles bind to agent types, not to specific panes: at delegation time, pick any idle pane of the matching agent type. A pane that just finished a review can take a coder or generalist task next, and vice versa. When no pane of the right type is idle, wait or run the work in the orchestrator pane — do not interrupt a working pane.

## Orchestrator

Apply this skill only when the task came directly from the user. Whichever pane the user enters the instruction into becomes the orchestrator for that task — do not assume or require a specific tool for it. The orchestrator keeps final synthesis and user communication; delegated agents report back to it.

**No re-delegation.** If your task arrived as a delegated instruction from another pane (not from the user), this skill does not apply: execute the task yourself in your own pane and never delegate it onward, even if it looks routine. Re-delegation creates cascades where multiple panes contend for the same siblings and no one does the work.

Use `using-herdr-sibling-panes` for every delegation. Follow its composer-safe `/clear` → instruction submission sequence and wait for the delegated result before integrating it. Do not use `pane run` for agent-pane prompts.

## Task routing

1. **Planning / design**: the orchestrator does the planning and design work itself, then sends the resulting plan for double review to both Reviewer agents with the same self-contained task.
2. **Complex coding**: delegate to a Coder agent. See "Complex coding boundary" below.
3. **Everything else**: delegate to a Generalist agent — simple coding, search, file inspection, tests, lint, formatting, and other mechanical or routine operations.

When categories overlap, use the heavier category (planning/design > complex coding > everything else).

Every delegation must satisfy the "Delegation contract" below.

## Complex coding boundary

Coding work is **complex** (→ Coder) when ANY of the following holds:

* **Cross-cutting change**: the change spans 3+ files or 2+ modules/layers whose interactions must stay consistent (e.g. API + client + schema).
* **Design freedom**: there is no single obvious implementation — data structures, interfaces, or algorithms must be chosen among meaningful alternatives.
* **Stateful / concurrent logic**: async flows, locking, streaming, retries, caching, or anything where ordering and partial-failure semantics matter.
* **Non-obvious debugging**: the root cause is unknown and must be inferred from behavior; reproducing or bisecting is part of the work.
* **Risky refactor**: behavior must be preserved while structure changes, and existing tests do not fully pin the behavior down.
* **Algorithmic or performance work**: correctness or complexity analysis is required, not just wiring code together.

Coding work is **simple** (→ Generalist) when ALL of the following hold:

* The change is localized (1–2 files) and the intended edit can be stated precisely up front.
* It follows an existing pattern in the codebase (add a similar handler, field, test case, config entry).
* Failure is cheap and visible — a wrong result is caught immediately by tests, types, lint, or a quick run.

Examples: renaming a symbol, adding a CRUD endpoint that mirrors an existing one, writing tests for pinned-down behavior, bumping a dependency, fixing a lint/type error → Generalist. Introducing a new subsystem, reworking the streaming pipeline, fixing a race condition, changing an interface used across modules → Coder.

Default when uncertain: treat it as complex and send it to the Coder — a misrouted simple task costs little there, while a complex task misrouted to the Generalist produces subtle breakage.

## Plan/design double review

Draft the plan in the orchestrator pane, then run both reviews through `using-herdr-sibling-panes` (one to each Reviewer agent, in separate panes), wait for both to complete, compare the findings, resolve disagreements, and only then act or report. Reviewers are reviewers, not substitutes for the orchestrator's final judgment.

Degrade instead of blocking when the full Reviewer set is unavailable. A Reviewer agent counts as available if any pane of that type exists in the session, even if it is currently busy — wait for busy panes, never interrupt them. If only one Reviewer agent type is available, run a single delegated review with it and state in the final report that the second independent review was skipped. If none is available, the orchestrator critically reviews its own plan and states that no independent review happened. Never delegate a review of a plan to the pane that drafted it.

## Delegation contract

Each delegated instruction must state:

1. The task and relevant context.
2. Whether edits are allowed.
3. The exact files or commands in scope.
4. The expected output and completion signal.
5. That the recipient must execute the task itself and must not re-delegate or orchestrate (e.g. "Execute this request yourself, directly. Re-delegating to other panes or orchestrating is prohibited.").

Use the sibling-pane workflow exactly, including its bundled `composer-submit.sh` helper and settle points. Do not replace it with `pane run` or raw back-to-back key calls, and do not send a redundant follow-up prompt asking a pane to run the task. An orchestrator receives the task when the delegated work finishes.
