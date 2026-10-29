#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'assessed release check error: %s\n' "$*" >&2
  exit 1
}

[[ "$#" -eq 0 ]] || fail "no arguments are accepted"

version_pattern='(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
check_release() (
  package="$1"
  repository="$2"
  pin="$(jq -esr --arg package "$package" --arg pattern "^${version_pattern}\\z" '
    select(length == 1) | .[0] | select(type == "object")
    | .dependencies | select(type == "object") | .[$package]
    | select(type == "string") | select(test($pattern))
  ' package.json)" ||
    fail "$package must use an exact stable version pin"

  release="$(gh api --hostname github.com "repos/$repository/releases/latest")" ||
    fail "$package official upstream release request failed"
  tag="$(jq -esr --arg pattern "^v?${version_pattern}\\z" '
    select(length == 1) | .[0]
    | select(type == "object" and .draft == false and .prerelease == false)
    | .tag_name | select(type == "string") | select(test($pattern))
  ' <<< "$release")" || fail "$package malformed upstream release response"
  latest="${tag#v}"
  [[ "$latest" == "$pin" ]] ||
    fail "$package upstream release $tag differs from assessed pin $pin; assessment required"

  printf 'Assessed %s pin %s matches official release %s\n' "$package" "$pin" "$tag"
)

# Report both assessments even when one fails, including a malformed local pin.
status=0
check_release @noble/post-quantum paulmillr/noble-post-quantum || status=1
check_release zxing-wasm Sec-ant/zxing-wasm || status=1
exit "$status"
