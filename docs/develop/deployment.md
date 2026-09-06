# Deployment (Cloudflare Pages, Direct Upload)

This is not run in parallel with GitHub's Cloudflare Git Integration. GitHub Actions
uploads `dist` via Wrangler (Direct Upload).

## Prerequisites

1. Create the Pages project on the Cloudflare side:

   ```bash
   wrangler pages project create <name>
   ```

2. Register the GitHub Repository Secrets (an API token with the minimum permissions required for Pages deploys):
   * `CLOUDFLARE_ACCOUNT_ID`
   * `CLOUDFLARE_API_TOKEN`
3. Register the GitHub Repository Variables:
   * `CLOUDFLARE_PAGES_PROJECT` — the production project deployed from `main`
   * `CLOUDFLARE_PAGES_PROJECT_DEV` — the development project deployed from `dev`
4. In Settings > Actions > General, enable **Allow GitHub Actions to create and approve pull requests**. This repo-wide setting is required by the promotion workflow and also grants review-approval capability to every workflow with `pull-requests: write`. The approval half is unused here because the ruleset requires 0 approvals.

## CI flow

`.github/workflows/cloudflare-pages.yml` runs on every branch and on every pull
request targeting `main` or `dev`:

* The `validate` job installs the frozen dependency graph (`aube ci`), audits
  it (`aube audit`), then runs type checking, lint, unit tests, post-quantum
  known-answer and integration tests, multipart QR tests, and the production
  build. The audit step has no `continue-on-error`: an open known npm advisory
  fails the job on the next triggered run. Scheduled/manual external
  maintenance is also required by the approved 2026-09-07 contract below;
  neither gate replaces the freshness review of the written advisory record.
  The `e2e` job also always runs. Playwright builds with
  `aube run build:prod` and serves `dist/` with `aube run serve:dist`, so the
  browser receives the `_headers` response policy rather than running against
  Vite preview without those headers
* The `deploy` job requires **both** to pass, and only runs on a `push`:
  `main` deploys to `CLOUDFLARE_PAGES_PROJECT`, `dev` deploys to
  `CLOUDFLARE_PAGES_PROJECT_DEV`. It publishes the artifact `validate` built
  rather than rebuilding, so the deployed bytes are the validated ones
* Every other branch and every pull request runs the checks only
* A `push` to `main` additionally publishes a signed prerelease via
  `.github/workflows/github-release.yml`. Its build job independently installs
  the frozen dependency graph and runs `aube audit` unconditionally before type
  checking, building, or packaging. The sign job requires that build job, and
  publication requires both, so a failed release audit cannot reach signing or
  publication. The workflow calls `scripts/release/package-static-pwa.sh` to
  package `dist` into the static install ZIP offered as the default install
  route A, signs it with Cosign, and renders the `INSTALL.txt` verification and
  local-server instructions carried inside the ZIP
  from the versioned template
  `docs/develop/install-route-a/INSTALL.template.txt` through
  `scripts/generate-install-txt.mjs`, so a verifier can regenerate that member
  byte-for-byte. The approved archive-browser contract below requires
  `scripts/release/test-packaged-pwa.sh` to run the full browser suite against
  those extracted archive bytes and bind signing/publication to the checked
  archive digest. Integration verification remains pending.

`.github/workflows/dev-to-main-pr.yml` checks out full history on a `dev` push,
or on an intentional `workflow_dispatch`, and builds a manifest from merge
commits since the `main`/`dev` merge base. It fetches each pull request's title
and author, separates product changes from CI/docs/chore entries, and updates
the body of a matching open promotion PR. If none exists, `dev` has commits
ahead of `main`, and `main` does not already have `dev`'s commit tree, it opens
the pull request titled `release: promote dev to production`. It never merges
or pushes. The title says release rather than merge because merging it is what
deploys production and publishes the signed release.

* Closing this PR without merging is a pause, not a permanent veto: the next push to `dev` opens a new one because a new dev commit is new information; `workflow_dispatch` also opens one as a deliberate human action, so it cannot conflict with a human veto
* This is a real production gate only while `main`'s ruleset requires `validate` and `e2e` with strict up-to-date status checks. If those required checks are removed, even a red dev push becomes an openly mergeable production promotion
* If `dev` is behind or diverged from `main`, strict required status checks block the merge until `dev` contains `main`; resolve that human sync problem before merging
* A PR opened by Actions may show **"Approve workflows to run"** for its pull-request checks; approve it when shown. The push-event `validate` and `e2e` checks on the same head SHA have already run
* Force-pushing `dev` is blocked by the ruleset's `non_fast_forward` rule and empty `bypass_actors`, so the workflow needs no separate force-push guard

## Release browser and archive verification (2026-09-07)

Implemented in release-track commit
`1295d5c02674493f3a14b332f311ef26f460f2d3`. The implementation report records
local archive/browser checks below. Independent new regressions and final
combined-tree/CI verification remain pending; the release implementation is
not present on this documentation-only branch.

- `E2E_ARTIFACT_ROOT` selects an absolute, existing directory for browser tests.
  In that mode Playwright starts the header-aware server from the selected
  root without a build. The full release browser suite must execute the
  extracted ZIP's JavaScript, assets, and service worker. The ordinary
  checkout test mode still builds before serving.
- Check the existing archive SHA-256 and complete member identity before and
  after browser execution. Export that same archive digest to signing and
  publication and compare it in both jobs. A changed archive must fail;
  testing one archive and signing another does not meet this contract.
- A separate corrupted archive copy must make browser boot fail when packaged
  JavaScript is broken while checkout `dist/` remains good. This demonstrates
  browser execution of packaged bytes. It is distinct from the digest gate,
  which must independently reject archive mutation.

`scripts/release/check-packaged-responses.mjs` runs in Playwright's artifact
setup on that same server: sentinel body/cache, root CSP, manifest MIME, SPA
fallback bytes, and every packaged JS/CSS/WASM response and MIME type are
checked. `scripts/release/verify-tested-archive.py` compares every extracted
member directly with the verified ZIP, including `INSTALL.txt` and
`SHA256SUMS.files`; the manifest is not trusted as an inventory. Unsafe,
duplicate, non-regular, missing, extra, or differing members fail.

The gate is `bash scripts/release/test-packaged-pwa.sh`, with the packager's
`RUNNER_TEMP` layout, `ARCHIVE_NAME`, and `GITHUB_OUTPUT`. Only success writes
`tested_archive_sha256`; build exports `tested-archive-sha256`, checked before
Cosign signing, before publication, and against the published/downloaded ZIP.
Existing checksum, immutable artifact-ID, source-identity, signature, and job
privilege checks remain. No repackage or rebuild follows the gate.

The release report's local package used source identity
`1ae9cf5c675068b30d8b5e3a8f7fa092106824a5` and the old Noble `0.7.0` pin.
Its ZIP SHA-256 was
`ef2912cdbdbdf8b422b427712078ceec5dfd888d456fc71939633aae7b221e53`;
all 19 members matched before/after, and the full then-existing browser suite
reported `33 passed (37.9s)`. The emitted tested digest matched. A separate
broken entry-point copy produced the browser error
`ARCHIVE_ONLY_BOOT_FAILURE` and a failed existing `app-boot.spec.ts`; the
unchanged checkout build passed the same scenario. This negative bypassed the
integrity gate intentionally; the byte-comparison helper independently rejected
the corrupted member. Remote sign/publish jobs were inspected and linted, not
executed. These are attributed local release-track results, not verification
of the new independent regressions or the integrated Noble 0.7.1 archive.

The independent regression report and complete integrated verification are
required before the `ci-actions` and `security-review` units can be stamped.
Reference-server archive tests do not certify benign source,
the build toolchain, hardware, the actual Route A server, or reproducibility
across environments. Route A's independently obtained policy, signature
verification, authenticated source rebuild, complete member comparison,
trusted server, reserved origin, and physical custody remain mandatory.

## External security maintenance (2026-09-07)

The owner superseded the earlier D5 deferral. Release-track commit
`b983bb7fcfcac3c82b3bb21c563e75696d392724` adds
`.github/workflows/security-maintenance.yml`, daily at **06:23 UTC** and on
manual dispatch. Workflow permissions default to empty; its job has only
`contents: read`. Actions use full SHA pins and checkout credentials are not
persisted. After frozen installation it runs `aube audit`; the release check
still runs after an earlier install/audit failure unless cancelled.

`bash scripts/check-crypto-release.sh` reads the exact stable pin from cwd
`package.json` and queries the official GitHub latest-release endpoint.
Equal versions with or without a leading `v` pass. A differing version,
non-exact local pin, draft/prerelease, malformed or empty response, or fetch
error fails visibly; trailing whitespace is rejected. The release report's
live check correctly failed against its unchanged `0.7.0` pin and upstream
`0.7.1`. Actionlint/shellcheck passed in that track; independent signal tests,
the check with the integrated new pin, and final CI remain pending.

This is maintainer-side monitoring only. It installs no offline updater,
changes no device key or policy, and does not silently select a new crypto
version. A detected release still requires the complete `crypto-noble` review.

## Release rebuild evidence

After its first production build, the release workflow calls
`scripts/release/verify-build-determinism.sh` to build again with the same source
SHA and toolchain in one runner. The script moves the first `dist` under
`RUNNER_TEMP` before the second build, compares the sorted file sets and every
file hash, and restores the first build for packaging. Keeping build A outside
the repository is required:
Tailwind scans the project tree, so a copied build or extracted archive left there
can change the second build's CSS and create a false mismatch.

`scripts/release/package-static-pwa.sh` checks the static closure through
`scripts/release/validate-static-closure.cjs` and writes the archive through
`scripts/release/write-static-zip.py`. Packaging adds `SHA256SUMS.files` as a
member inside the signed ZIP after `INSTALL.txt` and before mode/timestamp
normalization. It hashes every other
archive member, including `INSTALL.txt`, and excludes only itself. The published
release assets remain exactly three: the ZIP, the external ZIP-only
`SHA256SUMS`, and the `.sigstore.json` bundle. `SHA256SUMS.files` is not a fourth
asset. The archive's `INSTALL.txt` contains the clean-checkout, pinned-toolchain,
member-set, and per-file rebuild comparison commands; both the archive extraction
and any copied build tree must remain outside that checkout.

[install-route-a/README.md](install-route-a/README.md) §5.

## `public/_headers` / `public/_redirects`

* `_redirects`: SPA routing (`/* /index.html 200`)
* `_headers`: security headers such as CSP, plus `Cache-Control: no-cache` for the SW / manifest (see [deviations.md](deviations.md))

`aube run build:prod` copies both files into `dist/`. It derives the CSP for the
`/*` rule in `public/_headers` and injects supported directives into
`dist/index.html` before the application scripts when the server does not
interpret `_headers`. Meta CSP fallback and `frame-ancestors` header-only rule:
[threat-model.md](../security/threat-model.md) §2. Other security headers and
the cache rules are not represented by that tag.

`aube run serve:dist` is the repository's reference server for tests and release
validation. It reads the selected document root's `_headers`, applies matching
rules, serves the MIME types used by the PWA, and implements the current
`_redirects` SPA fallback to `/index.html`. The Playwright configuration uses it
for the normal e2e suite; the release contract also uses it for the extracted
ZIP. These checks do not validate a different operator-supplied server.

A self-hosted install (route A) still needs a separately trusted static server
that reproduces the bundled response-header and routing behavior. Authoritative
server and CSP/`frame-ancestors` requirements:
[install-route-a/README.md](install-route-a/README.md) §7, steps 3–4. The full Route A
procedure — Cosign inputs, checksum, independent rebuild-and-compare, deploy,
and host:port origin boundary — is
[install-route-a/README.md](install-route-a/README.md). Its mandatory set matches
the archive's `INSTALL.txt`; do not treat this page as a second incomplete copy
of that procedure.

Host:port origin boundary and Route A vs B assurance:
[install-route-a/README.md](install-route-a/README.md) §8. High-assurance use
must use Route A only.
