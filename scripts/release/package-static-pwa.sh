#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'release packaging error: %s\n' "$*" >&2
  exit 1
}

[[ "$GITHUB_REPOSITORY" == "$EXPECTED_REPOSITORY" ]] ||
  fail "unexpected repository: $GITHUB_REPOSITORY"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  fail "source SHA is not a full lowercase Git object ID"
[[ "$(git rev-parse HEAD)" == "$SOURCE_SHA" ]] ||
  fail "checkout does not match the triggering commit"

version="$(
  aube node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    process.stdout.write(String(pkg.version));
  '
)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] ||
  fail "package.json version is not a supported SemVer value"

release_tag="v${version}-main.g${SOURCE_SHA}"
root_name="qr-crypt-${release_tag}-static-install"
archive_name="${root_name}.zip"
bundle_name="${archive_name}.sigstore.json"
output_dir="$RUNNER_TEMP/qr-crypt-release"
stage_parent="$RUNNER_TEMP/qr-crypt-release-stage"
stage_dir="$stage_parent/$root_name"
extract_parent="$RUNNER_TEMP/qr-crypt-release-extracted"
extract_dir="$extract_parent/$root_name"

for path in "$output_dir" "$stage_parent" "$extract_parent"; do
  [[ "$path" == "$RUNNER_TEMP/"* ]] ||
    fail "refusing to clean a path outside RUNNER_TEMP"
done
rm -rf -- "$output_dir" "$stage_parent" "$extract_parent"
mkdir -p -- "$output_dir" "$stage_dir" "$extract_parent"

[[ -d dist ]] || fail "dist directory is missing"

# The /about landing page is an online-only surface (vite.config.ts keeps it out
# of precache and out of the SPA fallback). It has no place on an air-gapped
# device: external links, ~260 KB of card images. Remove it here; the allowlist
# below then proves nothing else slipped into dist.
rm -rf -- dist/about

required_files=(
  dist/index.html
  dist/manifest.webmanifest
  dist/sw.js
  dist/favicon.svg
  dist/reachability-sentinel.txt
  dist/_headers
  dist/_redirects
  dist/icons/apple-touch-icon-180.png
  dist/icons/icon-192.png
  dist/icons/icon-512.png
  dist/icons/maskable-512.png
)
for file in "${required_files[@]}"; do
  [[ -s "$file" ]] || fail "required static file is missing or empty: $file"
done

shopt -s nullglob
workbox_files=(dist/workbox-*.js)
asset_files=(dist/assets/*)
shopt -u nullglob
[[ "${#workbox_files[@]}" -eq 1 ]] ||
  fail "expected exactly one generated Workbox runtime"
[[ "${#asset_files[@]}" -gt 0 ]] ||
  fail "dist/assets has no files"

fixed_paths=(
  _headers
  _redirects
  favicon.svg
  icons/apple-touch-icon-180.png
  icons/icon-192.png
  icons/icon-512.png
  icons/maskable-512.png
  index.html
  manifest.webmanifest
  reachability-sentinel.txt
  sw.js
)
for asset in "${asset_files[@]}"; do
  [[ -f "$asset" && ! -L "$asset" ]] ||
    fail "dist/assets must contain only flat regular files: $asset"
  asset_name="${asset#dist/assets/}"
  [[ "$asset_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8}\.(js|css|wasm)$ ]] ||
    fail "unexpected generated asset name: $asset_name"
  references="$(
    grep -RFl --binary-files=text "$asset_name" \
      dist/index.html dist/sw.js dist/assets |
      grep -Fvx "$asset" || true
  )"
  [[ -n "$references" ]] ||
    fail "generated asset is not referenced by the static closure: $asset_name"
done

expected_files="$RUNNER_TEMP/expected-dist-files"
actual_files="$RUNNER_TEMP/actual-dist-files"
{
  printf '%s\n' "${fixed_paths[@]}"
  printf '%s\n' "${workbox_files[@]#dist/}"
  printf '%s\n' "${asset_files[@]#dist/}"
} | LC_ALL=C sort > "$expected_files"
find dist -type f -printf '%P\n' |
  LC_ALL=C sort > "$actual_files"
diff -u "$expected_files" "$actual_files" ||
  fail "dist contains a file outside the explicit release allowlist"

expected_dirs="$RUNNER_TEMP/expected-dist-dirs"
actual_dirs="$RUNNER_TEMP/actual-dist-dirs"
printf '%s\n' assets icons | LC_ALL=C sort > "$expected_dirs"
find dist -mindepth 1 -type d -printf '%P\n' |
  LC_ALL=C sort > "$actual_dirs"
diff -u "$expected_dirs" "$actual_dirs" ||
  fail "dist contains a directory outside the explicit release allowlist"

file_count="$(find dist -type f | wc -l)"
[[ "$file_count" -le 256 ]] ||
  fail "dist contains too many files"
oversized_file="$(find dist -type f -size +16777216c -print -quit)"
[[ -z "$oversized_file" ]] ||
  fail "dist file exceeds the 16 MiB limit: $oversized_file"
total_size="$(
  find dist -type f -printf '%s\n' |
    awk '{ total += $1 } END { print total + 0 }'
)"
[[ "$total_size" -le 33554432 ]] ||
  fail "dist exceeds the 32 MiB uncompressed limit"

cmp -s dist/reachability-sentinel.txt <(printf '%s' "QR-CRYPT-REACHABLE") ||
  fail "reachability sentinel body is incorrect"
grep -Fq "reachability-sentinel" dist/sw.js ||
  fail "service worker does not contain the sentinel route"
grep -Fq "NetworkOnly" dist/sw.js ||
  fail "service worker sentinel route is not NetworkOnly"
grep -Fq "Content-Security-Policy:" dist/_headers ||
  fail "_headers is missing Content-Security-Policy"
awk '
  $0 == "/reachability-sentinel.txt" { in_sentinel = 1; next }
  in_sentinel && /^[^[:space:]]/ { in_sentinel = 0 }
  in_sentinel && tolower($0) ~ /cache-control:[[:space:]]*no-store/ {
    found = 1
  }
  END { exit found ? 0 : 1 }
' dist/_headers ||
  fail "_headers does not make the reachability sentinel no-store"
grep -Eq '^[[:space:]]*/\*[[:space:]]+/index\.html[[:space:]]+200([[:space:]]|$)' \
  dist/_redirects ||
  fail "_redirects does not provide the SPA fallback"

unexpected="$(
  find dist -mindepth 1 ! -type d ! -type f -print -quit
)"
[[ -z "$unexpected" ]] ||
  fail "symlink or special file is forbidden: $unexpected"
unexpected="$(
  find dist -type f \
    \( -iname '*.map' -o -iname '*.map.gz' -o -iname '*.map.br' \
    -o -iname '.env' -o -iname '.env.*' -o -iname '*.env' \
    -o -iname '*.env.*' \) -print -quit
)"
[[ -z "$unexpected" ]] ||
  fail "development or environment file is forbidden: $unexpected"
unexpected="$(
  grep -Rl --binary-files=text 'sourceMappingURL=' dist |
    head -n 1 || true
)"
[[ -z "$unexpected" ]] ||
  fail "source-map reference is forbidden: $unexpected"
build_sha_files="$(
  grep -RFl --binary-files=text "$SOURCE_SHA" dist/assets || true
)"
[[ -n "$build_sha_files" ]] ||
  fail "built assets do not contain the full source SHA"

while IFS= read -r -d '' path; do
  relative="${path#dist/}"
  [[ "$relative" =~ ^[A-Za-z0-9._/-]+$ ]] ||
    fail "non-portable archive path: $relative"
  [[ "$relative" != /* && "$relative" != *"/../"* &&
    "$relative" != "../"* && "$relative" != *"/.." ]] ||
    fail "unsafe archive path: $relative"
done < <(find dist -mindepth 1 -print0)

aube node scripts/release/validate-static-closure.cjs

cp -a dist/. "$stage_dir/"

# INSTALL.txt is rendered from a versioned template so an independent
# verifier can reproduce it byte for byte like every payload file.
# docs/develop/install-route-a/INSTALL.template.txt is the only copy of
# this text; never inline a second one here.
QR_CRYPT_SOURCE_SHA="$SOURCE_SHA" \
  aube node scripts/generate-install-txt.mjs > "$stage_dir/INSTALL.txt"
[[ -s "$stage_dir/INSTALL.txt" ]] ||
  fail "generated INSTALL.txt is empty"

# The generator derives the release identity from package.json and this
# workflow rather than from arguments. Disagreement with the values this
# job computed means one of the two derivations drifted.
for expected_line in \
  "Version: $version" \
  "Source commit: $SOURCE_SHA" \
  "Release tag: $release_tag"; do
  grep -Fxq "$expected_line" "$stage_dir/INSTALL.txt" ||
    fail "generated INSTALL.txt does not state: $expected_line"
done
grep -Fq "$archive_name" "$stage_dir/INSTALL.txt" ||
  fail "generated INSTALL.txt does not name the release archive"
grep -Fq "$COSIGN_VERSION" "$stage_dir/INSTALL.txt" ||
  fail "generated INSTALL.txt does not name the pinned Cosign version"

(
  cd "$stage_dir"
  find . -type f ! -path './SHA256SUMS.files' -printf '%P\0' |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum > SHA256SUMS.files
)
[[ -s "$stage_dir/SHA256SUMS.files" ]] ||
  fail "per-file checksum manifest is empty"
grep -Eq '^[0-9a-f]{64}  INSTALL\.txt$' \
  "$stage_dir/SHA256SUMS.files" ||
  fail "per-file checksum manifest does not cover INSTALL.txt"
if ! diff -u \
  --label 'staged regular files' \
  --label 'SHA256SUMS.files paths' \
  <(
    cd "$stage_dir"
    find . -type f ! -path './SHA256SUMS.files' -printf '%P\n' |
      LC_ALL=C sort
  ) \
  <(
    cut -c67- "$stage_dir/SHA256SUMS.files" |
      LC_ALL=C sort
  ); then
  fail "per-file checksum manifest does not exactly cover staged regular files"
fi

commit_epoch="$(git show -s --format=%ct "$SOURCE_SHA")"
[[ "$commit_epoch" =~ ^[0-9]+$ && "$commit_epoch" -ge 315532800 ]] ||
  fail "invalid source commit timestamp"
find "$stage_dir" -type d -exec chmod 0755 {} +
find "$stage_dir" -type f -exec chmod 0644 {} +
find "$stage_dir" -exec touch -h -d "@$commit_epoch" {} +

ZIP_STAGING_PARENT="$stage_parent" \
  ZIP_ROOT="$root_name" \
  ZIP_OUTPUT="$output_dir/$archive_name" \
  COMMIT_EPOCH="$commit_epoch" \
  python3 scripts/release/write-static-zip.py

(
  cd "$output_dir"
  sha256sum "$archive_name" > SHA256SUMS
  sha256sum -c SHA256SUMS
)
unzip -tqq "$output_dir/$archive_name"

entry_count=0
while IFS= read -r entry; do
  entry_count=$((entry_count + 1))
  [[ "$entry" =~ ^[A-Za-z0-9._/-]+$ ]] ||
    fail "ZIP contains a non-portable path: $entry"
  [[ "$entry" == "$root_name/"* ]] ||
    fail "ZIP entry is not rooted under $root_name: $entry"
  [[ "$entry" != /* && "$entry" != *"/../"* &&
    "$entry" != "../"* && "$entry" != *"/.." ]] ||
    fail "ZIP contains an unsafe path: $entry"
done < <(unzip -Z1 "$output_dir/$archive_name")
[[ "$entry_count" -gt 0 && "$entry_count" -le 5000 ]] ||
  fail "ZIP entry count is outside the allowed range"

unzip -qq "$output_dir/$archive_name" -d "$extract_parent"
diff -qr "$stage_dir" "$extract_dir"

(
  cd "$stage_dir"
  find . -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum --zero
) > "$RUNNER_TEMP/staged-hashes"
(
  cd "$extract_dir"
  find . -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum --zero
) > "$RUNNER_TEMP/extracted-hashes"
cmp "$RUNNER_TEMP/staged-hashes" "$RUNNER_TEMP/extracted-hashes" ||
  fail "extracted file hashes do not match the staging tree"

{
  printf 'archive_name=%s\n' "$archive_name"
  printf 'bundle_name=%s\n' "$bundle_name"
  printf 'release_tag=%s\n' "$release_tag"
  printf 'version=%s\n' "$version"
} >> "$GITHUB_OUTPUT"
