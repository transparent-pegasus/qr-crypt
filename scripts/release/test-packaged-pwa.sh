#!/usr/bin/env bash
set -euo pipefail

[[ "$ARCHIVE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$ ]]
archive_root="${ARCHIVE_NAME%.zip}"
archive_path="$RUNNER_TEMP/qr-crypt-release/$ARCHIVE_NAME"
document_root="$RUNNER_TEMP/qr-crypt-release-extracted/$archive_root"
[[ -d "$document_root" && -f "$archive_path" ]]

(
  cd "$RUNNER_TEMP/qr-crypt-release"
  sha256sum -c SHA256SUMS
)
tested_archive_sha256="$(sha256sum "$archive_path" | cut -d ' ' -f 1)"

verify_archive() {
  python3 scripts/release/verify-tested-archive.py \
    "$archive_path" "$document_root" "$tested_archive_sha256"
}

# Match every extracted member (including the checksum manifest itself) to the
# ZIP before and after the full browser suite. Playwright owns the only server;
# its global setup checks HTTP bodies and headers on that same extracted root.
verify_archive
E2E_ARTIFACT_ROOT="$document_root" aube run test:e2e
verify_archive

# This handoff is emitted only after the complete gate succeeds. Downstream
# jobs compare the ZIP to it independently of the downloaded SHA256SUMS file.
printf 'tested_archive_sha256=%s\n' "$tested_archive_sha256" >> "$GITHUB_OUTPUT"
