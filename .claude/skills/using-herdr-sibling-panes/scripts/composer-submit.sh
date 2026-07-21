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

if [[ -z $pane_id || -z $instruction ]]; then
  echo "pane id and instruction must be non-empty" >&2
  exit 2
fi

# An agent composer can retain a previous draft/follow-up after it reports
# idle. A single Ctrl+C clears that state; Esc cancels the resulting
# exit/follow-up overlay.
rtk herdr pane send-keys "$pane_id" ctrl+c
rtk sleep "$input_settle_seconds"
rtk herdr pane send-keys "$pane_id" esc
rtk sleep "$input_settle_seconds"

# `pane run` cannot be used here: composers process pasted text
# asynchronously, and the single Enter it sends can be consumed by slash
# completion/default messaging.
rtk herdr pane send-text "$pane_id" "/clear"
rtk sleep "$input_settle_seconds"
rtk herdr pane send-keys "$pane_id" esc ctrl+enter
rtk sleep "$clear_settle_seconds"

rtk herdr pane send-text "$pane_id" "$instruction"
rtk sleep "$input_settle_seconds"
rtk herdr pane send-keys "$pane_id" esc ctrl+enter
rtk sleep "$input_settle_seconds"

rtk herdr pane read "$pane_id" --source recent --lines 40
