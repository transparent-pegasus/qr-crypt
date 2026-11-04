@CLAUDE.local.md

# Project Goal

Build fully offline encryption engineered against nation-state cryptanalysis and compromise; reject any transfer—including removable storage—that cannot meet this threat model.

# Rules

- This project's core principles live in two skills: `.claude/skills/artful-simplicity/SKILL.md` for the simplicity bar and `.claude/skills/nation-state-security/SKILL.md` for the threat model.
- No backward compatibility in active paths. Offline installs never update, so no legacy value, migration, or rollback path. One exception, and only where `.claude/skills/freshness/targets.yaml` invariants already document it: boot-time preference *reads* stay append-only, because a stored value that becomes unreadable forces `wipeOnOnline` true and exposes data to a later network-confirmed wipe. Write paths stay strict.
- Dedicated native relay Store updates are permitted only under `docs/spec/native-relay.md` §1: use a separate online device and preserve interoperability with every authorized fixed offline release. This does not permit offline updates, old parsers, migration, or rollback paths.
- Branch off `origin/dev` for every change. `dev` is protected, so a direct push is rejected and even a one-line edit goes through a branch and a PR.
- On task completion, follow `.claude/skills/freshness/SKILL.md`: add new time-decaying files to `targets.yaml`; for listed files touched or invalidated, refresh and verify affected units; stamp only passed units; verify, never stamp, invariants.
