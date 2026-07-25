@WORKFLOW.md

# Project Goal

Build fully offline encryption engineered against nation-state cryptanalysis and compromise; reject any transfer—including removable storage—that cannot meet this threat model.

# Rules

- No backward compatibility. Installs never update, so no legacy value, migration, or rollback path.
- On task completion, follow `.claude/skills/freshness/SKILL.md`: add new time-decaying files to `targets.yaml`; for listed files touched or invalidated, refresh and verify affected units; stamp only passed units; verify, never stamp, invariants.
