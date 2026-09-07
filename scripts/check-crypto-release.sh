#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'crypto release check error: %s\n' "$*" >&2
  exit 1
}

version_pattern='(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
pin="$(jq -er --arg pattern "^${version_pattern}\\z" '
  .dependencies["@noble/post-quantum"]
  | select(type == "string") | select(test($pattern))
' package.json)" ||
  fail "@noble/post-quantum must use an exact stable version pin"

release="$(gh api --hostname github.com repos/paulmillr/noble-post-quantum/releases/latest)" ||
  fail "official upstream release request failed"
tag="$(jq -esr --arg pattern "^v?${version_pattern}\\z" '
  select(length == 1) | .[0]
  | select(type == "object" and .draft == false and .prerelease == false)
  | .tag_name | select(type == "string") | select(test($pattern))
' <<< "$release")" || fail "malformed upstream release response"
latest="${tag#v}"
[[ "$latest" == "$pin" ]] ||
  fail "upstream release $tag differs from assessed pin $pin; assessment required"

printf 'Assessed @noble/post-quantum pin %s matches official release %s\n' "$pin" "$tag"
