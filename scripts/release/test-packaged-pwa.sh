#!/usr/bin/env bash
set -euo pipefail

archive_root="${ARCHIVE_NAME%.zip}"
document_root="$RUNNER_TEMP/qr-crypt-release-extracted/$archive_root"
[[ -d "$document_root" ]]
server_log="$RUNNER_TEMP/qr-crypt-release-server.log"

SERVE_DIST_ROOT="$document_root" SERVE_DIST_PORT=4173 \
  aube run serve:dist > "$server_log" 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=false
for _ in {1..60}; do
  if curl --fail --silent http://127.0.0.1:4173/ > /dev/null; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  cat "$server_log" >&2
  exit 1
fi

sentinel_headers="$RUNNER_TEMP/sentinel-headers"
sentinel_body="$RUNNER_TEMP/sentinel-body"
curl --fail --silent --show-error \
  --dump-header "$sentinel_headers" \
  --output "$sentinel_body" \
  http://127.0.0.1:4173/reachability-sentinel.txt
cmp "$sentinel_body" <(printf '%s' "QR-CRYPT-REACHABLE")
grep -Eqi '^cache-control:.*no-store' "$sentinel_headers"

root_headers="$RUNNER_TEMP/root-headers"
curl --fail --silent --show-error \
  --dump-header "$root_headers" \
  --output /dev/null \
  http://127.0.0.1:4173/
grep -Eqi "^content-security-policy:.*connect-src 'self'" "$root_headers"
grep -Eqi "^content-security-policy:.*object-src 'none'" "$root_headers"
grep -Eqi "^content-security-policy:.*'wasm-unsafe-eval'" "$root_headers"
if grep -Eqi "^content-security-policy:.*[^-]'unsafe-eval'" "$root_headers"; then
  exit 1
fi

manifest_headers="$RUNNER_TEMP/manifest-headers"
curl --fail --silent --show-error \
  --dump-header "$manifest_headers" \
  --output /dev/null \
  http://127.0.0.1:4173/manifest.webmanifest
grep -Eqi '^content-type: application/manifest\+json' "$manifest_headers"

fallback_body="$RUNNER_TEMP/fallback-body"
curl --fail --silent --show-error \
  --output "$fallback_body" \
  http://127.0.0.1:4173/nonexistent/spa/route
cmp "$fallback_body" "$document_root/index.html"

# Playwright boots its own build-and-serve on a cwd-derived port (see
# playwright.config.ts); the :4173 server above backs the header checks
# against the archived bytes only. Keep CI set — it is what gives this
# job the retry budget and the in-band global timeout.
aube run test:e2e
