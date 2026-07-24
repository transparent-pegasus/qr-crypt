#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: composer-submit.sh <pane-id> <instruction>" >&2
  exit 2
fi

pane_id=$1
instruction=$2
input_settle_seconds=${HERDR_COMPOSER_INPUT_SETTLE_SECONDS:-0.40}
clear_settle_seconds=${HERDR_COMPOSER_CLEAR_SETTLE_SECONDS:-0.75}
clear_poll_attempts=${HERDR_COMPOSER_CLEAR_POLL_ATTEMPTS:-20}

if [[ -z $pane_id || -z $instruction ]]; then
  echo "pane id and instruction must be non-empty" >&2
  exit 2
fi

pane_info=$(rtk herdr pane get "$pane_id")
agent=$(rtk proxy jq -r '.result.pane.agent // ""' <<<"$pane_info")
agent_status=$(rtk proxy jq -r '.result.pane.agent_status // ""' <<<"$pane_info")

case "$agent_status" in
  idle|done) ;;
  *)
    echo "refusing to submit to pane $pane_id with agent_status=$agent_status" >&2
    exit 3
    ;;
esac

# An agent composer can retain a previous draft/follow-up after it reports
# idle. Codex treats Ctrl+C on an empty idle composer as an exit request, so
# clear only its input buffer with Esc -> Ctrl+U. Other supported composers
# use Ctrl+C to cancel retained state, followed by Esc to dismiss overlays.
if [[ "$agent" == "codex" ]]; then
  rtk herdr pane send-keys "$pane_id" esc
  rtk sleep "$input_settle_seconds"
  rtk herdr pane send-keys "$pane_id" ctrl+u
  rtk sleep "$input_settle_seconds"
else
  rtk herdr pane send-keys "$pane_id" ctrl+c
  rtk sleep "$input_settle_seconds"
  rtk herdr pane send-keys "$pane_id" esc
  rtk sleep "$input_settle_seconds"
fi

submit_composer() {
  case "$agent" in
    codex)
      # Codex v0.145 uses Enter to submit. Ctrl+Enter leaves pasted text in the
      # composer and causes the following instruction to be concatenated.
      rtk herdr pane send-keys "$pane_id" esc enter
      ;;
    claude)
      # Claude Code submits with a plain Enter. Esc+Ctrl+Enter leaves the pasted
      # instruction in the composer.
      rtk herdr pane send-keys "$pane_id" enter
      ;;
    *)
      rtk herdr pane send-keys "$pane_id" esc ctrl+enter
      ;;
  esac
}

# `pane run` cannot be used here: composers process pasted text
# asynchronously, and the single Enter it sends can be consumed by slash
# completion/default messaging.
rtk herdr pane send-text "$pane_id" "/clear"
rtk sleep "$input_settle_seconds"
submit_composer
rtk sleep "$clear_settle_seconds"

clear_ready=false
for _ in $(rtk proxy seq 1 "$clear_poll_attempts"); do
  pane_info=$(rtk herdr pane get "$pane_id")
  agent_status=$(rtk proxy jq -r '.result.pane.agent_status // ""' <<<"$pane_info")
  case "$agent_status" in
    idle|done)
      clear_ready=true
      break
      ;;
  esac
  rtk sleep "$input_settle_seconds"
done
if [[ "$clear_ready" != "true" ]]; then
  echo "timed out waiting for pane $pane_id to clear; agent_status=$agent_status" >&2
  exit 4
fi

rtk herdr pane send-text "$pane_id" "$instruction"
rtk sleep "$input_settle_seconds"
submit_composer
rtk sleep "$input_settle_seconds"

rtk herdr pane read "$pane_id" --source recent --lines 40
