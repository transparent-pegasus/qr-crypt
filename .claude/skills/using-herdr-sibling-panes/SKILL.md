---
name: using-herdr-sibling-panes
description: "Use when inside herdr (HERDR_ENV=1), the current pane is acting as the orchestrator for the task, and idle sibling agent panes can take delegated work — operational repo tasks standalone, or any routed task as the delegation transport for the orchestration skill."
---

# Using herdr sibling panes

`HERDR_ENV=1` is required. If it is missing, stop.

For pane layout, read [`herdr`](../herdr/SKILL.md). Use this skill only for multi-pane delegation to idle sibling agent panes.

## When to use

Use when you are inside herdr, your pane is acting as the orchestrator for the task (whichever pane received the task — no specific tool is assumed or required), and one or more sibling agent panes are idle.

What to delegate depends on how this skill was entered:

* **Driven by the `orchestration` skill**: this skill is the delegation transport; the orchestration skill's task routing decides what goes to which agent, including complex coding.
* **Standalone**: delegate only independent operational work such as tests, lint, formatting, file reads, git status/diff/log, server logs, and command output. Do not delegate coding, design, root-cause debugging, planning, or reasoning-heavy work.

## Workflow

1. Run `herdr pane list` and identify your own pane (the orchestrator) and idle sibling agent panes.
2. Select only sibling agent panes with `agent_status: idle` or `done`.
3. Distribute independent work items across the available panes, one instruction per pane.
4. Before every delegation, cancel any retained draft/follow-up and clear the target agent pane with the composer-safe submit sequence below.
5. Submit one self-contained instruction with the same composer-safe sequence.
6. Do not send a second prompt such as "Please run the task I just sent." The submitted instruction is already running.
7. Confirm the task started by checking `herdr pane list` or reading output until the pane is `working`. A very short task may finish before polling; in that case verify the new response in `pane read`.
8. If the intended instruction alone still sits in the composer, send only the force-send sequence (`esc ctrl+enter`) once and inspect again. If it contains stale or concatenated text, cancel it (`ctrl+c`, settle, `esc` — the first two steps of the fallback sequence below) and resubmit from step 4. Never append or retype into a non-empty composer.
9. Wait for the instruction's unique completion marker, then re-read `pane list`. If it is still `working`, wait for `idle`; if it is already `idle` or `done`, continue.
10. Read the completed result and integrate it in the orchestrator pane.

## Composer-safe submission

Agent CLIs take input through a composer — a stateful input box with slash-command autocomplete, follow-up suggestions, and message queueing. Composers cannot be driven reliably with `herdr pane run`, regardless of which agent runs in the pane:

* **Wrong submit key.** A composer may reserve plain Enter for a default action (nudge, accept a suggestion) and require a different chord to force-send the prompt.
* **Keys consumed by UI.** Slash-command and autocomplete popups can swallow the single Enter that `pane run` sends, leaving the text sitting in the composer.
* **Retained state and races.** A composer can keep the previous prompt or queued follow-ups after completion, and text insertion and key handling are asynchronous, so back-to-back CLI calls can race even with the right keys. Later delegation text then concatenates onto stale input such as an unsubmitted `/clear`.

Therefore, never submit `/clear` or delegated prompts to an agent pane with `pane run`. Always use a submission sequence that cancels retained state, waits at bounded settle points, clears the conversation, and force-submits exactly one instruction. The bundled helper implements exactly that sequence:

```bash
COMPOSER_SUBMIT=.claude/skills/using-herdr-sibling-panes/scripts/composer-submit.sh
rtk "$COMPOSER_SUBMIT" "$PANE" "$INSTRUCTION"
```

The helper first refuses panes whose agent status is not `idle` or `done`, and
accepts either status again after `/clear` (Codex may report `done` for a
successfully cleared conversation). It
uses `ctrl+c` to cancel retained state for supported non-Codex composers, but
uses `esc` followed by `ctrl+u` for Codex because `ctrl+c` on an empty idle
Codex composer can terminate the TUI. Codex v0.145 is submitted with
`esc enter`; `ctrl+enter` leaves pasted text in its composer. Claude Code is
submitted with plain `enter`; `esc ctrl+enter` leaves pasted text in its
composer. Other supported composers use `esc ctrl+enter`. Before first use
with a new agent CLI, verify these cancel, dismiss, and force-send keys against
that composer and adjust the helper if they differ.

If the helper is unavailable, use this exact fallback. Do not remove the settle points:

```bash
# Codex: use `esc`, settle, then `ctrl+u` instead of this `ctrl+c` step,
# and use `esc enter` instead of both `esc ctrl+enter` submit steps.
# Claude Code: use plain `enter` instead of both submit steps.
rtk herdr pane send-keys "$PANE" ctrl+c
rtk sleep 0.40
rtk herdr pane send-keys "$PANE" esc
rtk sleep 0.40
rtk herdr pane send-text "$PANE" "/clear"
rtk sleep 0.40
rtk herdr pane send-keys "$PANE" esc ctrl+enter
rtk sleep 0.75
rtk herdr pane send-text "$PANE" "$INSTRUCTION"
rtk sleep 0.40
rtk herdr pane send-keys "$PANE" esc ctrl+enter
```

Use `pane run` normally for shells and other terminal programs; this workaround is specifically for agent composers.

## Task contract

Every instruction must include the repo path, exact command or path, edit policy, report format, and a unique final completion marker that `wait output` can match. Keep the marker at 16 ASCII characters or fewer so terminal wrapping cannot split it. The complete marker must not occur verbatim in the submitted prompt, because `wait output` also sees user text; describe it as two fragments that the delegated agent must concatenate.

```bash
PANE=1-2
INSTRUCTION="Please run rtk make lint in /path/to/repo. Make no edits. Report the command, exit code, and errors. End with LINT_OK immediately followed by _7F3A."
COMPOSER_SUBMIT=.claude/skills/using-herdr-sibling-panes/scripts/composer-submit.sh
rtk "$COMPOSER_SUBMIT" "$PANE" "$INSTRUCTION"
rtk herdr pane list
rtk herdr pane read 1-2 --source recent --lines 40
rtk herdr wait output 1-2 --match "LINT_OK_7F3A" --timeout 300000
rtk herdr pane list
# If the target is still working:
rtk herdr wait agent-status 1-2 --status idle --timeout 300000
rtk herdr pane read 1-2 --source recent --lines 120
```

Re-read pane ids after panes close because ids can compact. Do not send work to `working` or `blocked` panes, and do not rely on a single terminal status name for completion.
