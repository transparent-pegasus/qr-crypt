# herdr

Agent skill for controlling [herdr](https://herdr.dev/) — a terminal-native agent multiplexer — from inside one of its panes. Covers managing workspaces, tabs, and panes, running commands in splits, reading pane output, and waiting for state changes, all via the `herdr` CLI talking to the running instance over a local unix socket.

## Files

- [`SKILL.md`](SKILL.md) — the skill: concepts (workspaces / tabs / panes / ids), CLI commands, and recipes such as running a server in a sibling pane and waiting for readiness.

## Key properties

- Requires `HERDR_ENV=1`; the skill refuses to control herdr from outside a herdr-managed pane.
- Pane/tab/workspace ids can compact when siblings close — always re-read ids instead of caching them.
- For delegating work to idle sibling agent panes, see [`using-herdr-sibling-panes`](../using-herdr-sibling-panes/).
