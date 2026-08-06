@CLAUDE.local.md

# Project Goal

Build fully offline encryption engineered against nation-state cryptanalysis and compromise; reject any transfer—including removable storage—that cannot meet this threat model.

# Rules

- No backward compatibility in active paths. Installs never update, so no legacy value, migration, or rollback path. One exception, and only where `.claude/skills/freshness/targets.yaml` invariants already document it: boot-time preference *reads* stay append-only, because a stored value that becomes unreadable forces `wipeOnOnline` true and exposes data to a later network-confirmed wipe. Write paths stay strict.
- On task completion, follow `.claude/skills/freshness/SKILL.md`: add new time-decaying files to `targets.yaml`; for listed files touched or invalidated, refresh and verify affected units; stamp only passed units; verify, never stamp, invariants.
- This project's core principles live in two skills: `.claude/skills/artful-simplicity/SKILL.md` for the simplicity bar and `.claude/skills/nation-state-security/SKILL.md` for the threat model.
