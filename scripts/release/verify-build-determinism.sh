#!/usr/bin/env bash
set -euo pipefail

first_build="$RUNNER_TEMP/qr-crypt-dist-first"
second_build="$RUNNER_TEMP/qr-crypt-dist-second"
first_files="$RUNNER_TEMP/qr-crypt-dist-first.files"
second_files="$RUNNER_TEMP/qr-crypt-dist-second.files"
first_hashes="$RUNNER_TEMP/qr-crypt-dist-first.sha256"
second_hashes="$RUNNER_TEMP/qr-crypt-dist-second.sha256"

for path in \
  "$first_build" "$second_build" \
  "$first_files" "$second_files" \
  "$first_hashes" "$second_hashes"; do
  [[ "$path" == "$RUNNER_TEMP/"* ]] ||
    {
      printf 'production build determinism error: unsafe temporary path\n' >&2
      exit 1
    }
  [[ ! -e "$path" ]] ||
    {
      printf 'production build determinism error: temporary path exists: %s\n' \
        "$path" >&2
      exit 1
    }
done
[[ -d dist ]] ||
  {
    printf 'production build determinism error: first dist is missing\n' >&2
    exit 1
  }

mv dist "$first_build"

restore_first_build() {
  if [[ -e "$first_build" ]]; then
    if [[ -e dist ]]; then
      mv dist "$second_build"
    fi
    mv "$first_build" dist
  fi
}
trap restore_first_build EXIT

# The first build is outside the checkout while Tailwind scans the
# project tree for the second build.
aube run build:prod
[[ -d dist ]] ||
  {
    printf 'production build determinism error: second dist is missing\n' >&2
    exit 1
  }

find "$first_build" -type f -printf '%P\n' |
  LC_ALL=C sort > "$first_files"
find dist -type f -printf '%P\n' |
  LC_ALL=C sort > "$second_files"
(
  cd "$first_build"
  find . -type f -printf '%P\0' |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum
) > "$first_hashes"
(
  cd dist
  find . -type f -printf '%P\0' |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum
) > "$second_hashes"

comparison_failed=0
if ! diff -u "$first_files" "$second_files"; then
  printf 'production build determinism error: file sets differ\n' >&2
  comparison_failed=1
fi
if ! diff -u "$first_hashes" "$second_hashes"; then
  printf 'production build determinism error: file hashes differ\n' >&2
  comparison_failed=1
fi

restore_first_build
trap - EXIT
if [[ "$comparison_failed" -ne 0 ]]; then
  exit 1
fi
