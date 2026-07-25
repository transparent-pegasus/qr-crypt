# Task Workflow

This file is tracked. Delegated pane reports and plans still go under `.tmp/`, which is
gitignored and never committed.

## Herdrpowers Configuration

herdrpowers skills and commands resolve `<KEY>` placeholders from this section.

- `REPO_INSTRUCTION_FILES`: `CLAUDE.md` (`AGENTS.md` is a symlink to it)
- `BASE_BRANCH`: `dev`
- `REPORT_DIRECTORY`: `.tmp/` (gitignored)
- `DESIGN_DOC_PATH_PATTERN`: `.tmp/design-YYYYMMDD-<feature>.md`
- `PLAN_PATH_PATTERN`: `.tmp/plan-YYYYMMDD-<n>-<feature>.md`
- `PLAN_DIRECTORY`: `.tmp/`
- `BASELINE_VERIFICATION_COMMAND`: `aube run typecheck && aube run lint && aube run test`
- `SUPPLEMENTAL_VERIFICATION_COMMANDS`: `aube run build` (vite/env changes), `aube run test:e2e` (UI changes), `aube run test:pq` and `aube run test:qr-multipart` (protocol changes), `aube run build:prod` (.env.prod changes)
- `TEST_FRAMEWORK_AND_COMMANDS`: Vitest for unit/integration/UI, Playwright for e2e; every node execution goes through `aube run <script>` (npm is forbidden in this repo)
- `TEST_FILE_LOCATIONS`: `tests/{unit,integration,ui,pq,pq-vectors,qr-multipart,e2e,bench}`; shared setup in `tests/setup/`
- `TARGETED_TEST_COMMAND`: `aube run test -- <path>`
- `FULL_TEST_SUITE_COMMAND`: `aube run test && aube run test:e2e`

## Default procedure for every task request

Unless the request explicitly states otherwise, a task from the owner follows these
steps in order. Do not skip a step and do not collapse two steps into one.

1. **Plan.** `/herdrpowers:plan` — brainstorm and write the implementation plan.
   The plan is **not** complete when it is written: it is complete only after the
   `orchestration` **Reviewer** role has double-reviewed it (each reviewer agent reviews
   independently, no shared draft opinion), the findings are resolved, and the owner has
   approved the resolved plan. Only then may code be touched.

2. **Workspace isolation.** The `using-git-worktrees` skill — a dedicated branch and
   worktree, based on `dev`.

3. **Documentation impact review.** Before implementation, list every non-code file that
   the change will invalidate: `CLAUDE.md` (and `AGENTS.md`), affected files under
   `docs/`, agent-instruction directories (`.claude/`), example env/config files
   (`.env.example`, `.env.prod`), and CI/deploy definitions under `.github/`. The list is
   explicit and written down before any implementation starts. Revise it if the
   implementation turns out to affect something else.

4. **Execution.** Based on `/herdrpowers:execute_parallel`, but every dispatch
   goes through the `orchestration` skill (`using-herdr-sibling-panes` as the transport):
   - Implementation tasks, **test creation**, and **code review** go to `orchestration`
     **Coder** agents. Do not use the `test-engineer` or `code-reviewer` subagents.
   - Chores that come up while executing the plan (lookups, file moves, log gathering,
     mechanical edits) go to `orchestration` **Generalist** agents.
   - The `subagent-driven-development` skill's role boundaries are **overridden**: where
     it mandates the `code-reviewer` named subagent for task and final review, and the
     `test-engineer` named subagent as the sole author of test code, those roles are
     performed by Coder panes instead. Its remaining content (per-task fresh delegation,
     file handoffs, status protocol, progress ledger) still applies.
   - The Coder pane that writes tests owns **RED-GREEN-REFACTOR** per the
     `test-driven-development` skill; say so in the delegation brief. No implementation
     without a failing test first.
   - Review independence comes from each delegation starting a fresh pane context
     (`/new`). Where an idle pane of a different agent type is available, prefer it for
     review over the type that implemented the change.
   - On any test failure, unexpected behavior, or bug — in a pane or in the orchestrator
     — use the `systematic-debugging` skill **before** proposing or applying a fix. No
     speculative fixes.

5. **Documentation update.** Update every target from step 3 that the implemented result
   still affects, using the `update-docs` skill for files under `docs/`.

6. **Verification.** The `verification-before-completion` skill. Evidence before
   assertions: run the repository's declared verification commands and report the actual
   output. No completion claim without it. Also satisfy the repo rule in `CLAUDE.md`:
   follow `.claude/skills/freshness/SKILL.md` — add new time-decaying files to
   `targets.yaml`, refresh and verify the affected units for listed files that were
   touched or invalidated, stamp only units that passed, and verify (never stamp)
   invariants.

7. **Stop and wait for the owner's command.** When the owner instructs cleanup, use the
   `finishing-a-development-branch` skill for worktree and branch removal. Additional
   implementation likewise happens only on an explicit instruction.

## Pane execution ground rules

These hold for every delegation in step 4, and for anything the orchestrator runs itself.

- **Base is `dev`.** Worktrees and pull requests branch from `dev`, never from `main`.
  A `main`-based branch works against the production deploy flow.
- **Work happens in the worktree.** Verification commands, builds, and tests run inside
  the task's worktree, not in the primary checkout.
- **Panes have their own working directory.** A delegated pane does not inherit the
  orchestrator's cwd. Every brief states the **absolute worktree path** and requires the
  pane to confirm it is there before doing anything else.
- **Reports go to files.** Every delegated pane writes its report to a file under
  `.tmp/` and replies with that path. Do not rely on pane scrollback for the result.
- **Verify claims, do not trust them.** A pane reporting "verified" or "tests pass" is a
  claim, not evidence. Re-run the decisive command, or read the report file's quoted
  output, before accepting it.

## Prohibited

- The `dispatching-parallel-agents` skill. Parallel work is delegated to sibling herdr
  panes via the `orchestration` skill instead — never to in-process subagents.

## Deliberately unused

- The `executing-plans` skill. It exists to hand an approved plan to a *separate later
  session* with its own review checkpoints. Here, plans are executed in the same session
  through step 4 (`orchestration` pane delegation), which already provides the fresh
  context per task and the review checkpoints. Do not reach for it as an alternative
  execution path; if a plan must survive across sessions, the plan file under `.tmp/`
  plus this document is the handoff.

"Explicitly states otherwise" means the owner named the deviation in the request (for
example "skip the plan", "work in the current tree", "no worktree"). Silence is not
permission to skip.
