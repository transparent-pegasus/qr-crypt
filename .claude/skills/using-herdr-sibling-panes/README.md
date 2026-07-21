# using-herdr-sibling-panes

Agent skill for delegating work from an orchestrator pane to idle sibling agent panes inside [herdr](../herdr/) — operational repo work (tests, lint, file reads, git inspection, command output) when used standalone, or any routed task when serving as the delegation transport for the [orchestration](../orchestration/) skill. Provides a race-free, composer-safe submission sequence and a task contract with unique completion markers.

## Files

- [`SKILL.md`](SKILL.md) — the skill: when to delegate, the workflow, the composer-safe submission sequence, and the task contract.
- [`scripts/composer-submit.sh`](scripts/composer-submit.sh) — bundled helper that cancels retained composer state, clears the conversation, and force-submits exactly one instruction with bounded settle points.

## Key properties

- Requires `HERDR_ENV=1` and applies to whichever pane is acting as the orchestrator for the task.
- Never uses `pane run` for agent-pane prompts — agent composers need cancel/dismiss/force-send key sequences with settle delays to avoid stale or concatenated input. Verify the helper's key bindings against a new agent CLI before first use.
- Completion is detected by matching a unique marker with `herdr wait output`, split into fragments in the prompt so the marker never matches the prompt itself.
