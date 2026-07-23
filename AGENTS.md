# Rules

- use $orchestration at every task start.
- On completing any task: register any newly introduced time-decaying file in `.claude/skills/freshness/targets.yaml`; for listed files the task touched or invalidated, refresh and verify the affected units per `.claude/skills/freshness/SKILL.md`, stamping `last_checked` only after verify passes (invariants are verified, never stamped).
