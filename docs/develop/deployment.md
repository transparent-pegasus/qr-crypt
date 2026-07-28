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

* The `validate` job (type check, lint, unit, post-quantum, multipart QR,
  production build) and the `e2e` job always run. Playwright builds with
  `aube run build:prod` and serves `dist/` with `aube run serve:dist`, so the
  browser receives the `_headers` response policy rather than running against
  Vite preview without those headers
* The `deploy` job requires **both** to pass, and only runs on a `push`:
  `main` deploys to `CLOUDFLARE_PAGES_PROJECT`, `dev` deploys to
  `CLOUDFLARE_PAGES_PROJECT_DEV`. It publishes the artifact `validate` built
  rather than rebuilding, so the deployed bytes are the validated ones
* Every other branch and every pull request runs the checks only
* A `push` to `main` additionally publishes a signed prerelease via
  `.github/workflows/github-release.yml`. That workflow packages `dist` into the
  static install ZIP offered as the default install route A, signs it with Cosign,
  and generates the `INSTALL.txt` verification and local-server instructions
  carried inside the ZIP. Before upload, it extracts the exact archive, starts
  the shared server with `SERVE_DIST_ROOT` set to that extracted tree, checks the
  sentinel body and `no-store` response, required CSP response directives,
  manifest MIME type, and SPA fallback, then runs the e2e suite against those
  archived bytes

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

## Release rebuild evidence

The release workflow builds the production PWA twice with the same source SHA and
toolchain in one runner. It moves the first `dist` under `RUNNER_TEMP` before the
second build, compares the sorted file sets and every file hash, and restores the
first build for packaging. Keeping build A outside the repository is required:
Tailwind scans the project tree, so a copied build or extracted archive left there
can change the second build's CSS and create a false mismatch.

Packaging adds `SHA256SUMS.files` as a member inside the signed ZIP after
`INSTALL.txt` and before mode/timestamp normalization. It hashes every other
archive member, including `INSTALL.txt`, and excludes only itself. The published
release assets remain exactly three: the ZIP, the external ZIP-only
`SHA256SUMS`, and the `.sigstore.json` bundle. `SHA256SUMS.files` is not a fourth
asset. The archive's `INSTALL.txt` contains the clean-checkout, pinned-toolchain,
member-set, and per-file rebuild comparison commands; both the archive extraction
and any copied build tree must remain outside that checkout.

This gate establishes same-environment determinism, not environment-independent
reproducibility. Cosign attests provenance—which workflow built from which
commit—not source-to-binary correspondence. An attacker who controls the CI
environment can therefore publish a correctly signed backdoor; only an
independent rebuild comparison can detect that case.

## `public/_headers` / `public/_redirects`

* `_redirects`: SPA routing (`/* /index.html 200`)
* `_headers`: security headers such as CSP, plus `Cache-Control: no-cache` for the SW / manifest (see [deviations.md](deviations.md))

`aube run build:prod` copies both files into `dist/`. It also derives the CSP for
the `/*` rule in `public/_headers` and injects its supported directives into
`dist/index.html` as a `<meta http-equiv="Content-Security-Policy">` tag before
the application scripts. This gives a self-hosted copy a CSP fallback when its
server does not interpret `_headers`. It is not a substitute for response
headers: `frame-ancestors` is ignored in a meta CSP and therefore remains
header-only, while the other security headers and the cache rules are not
represented by that tag.

`aube run serve:dist` is the repository's reference server for tests and release
validation. It reads the selected document root's `_headers`, applies matching
rules, serves the MIME types used by the PWA, and implements the current
`_redirects` SPA fallback to `/index.html`. The Playwright configuration uses it
for the normal e2e suite; the release workflow reuses it for the extracted ZIP.

A self-hosted install (route A) still needs a separately trusted static server
that reproduces the bundled response-header and routing behavior: the security
headers, correct MIME types, SPA fallback, and `no-store` on the reachability
sentinel. In particular, a server that relies only on the injected meta tag does
not enforce `frame-ancestors`. The authoritative full Route A procedure —
independently authenticated Cosign inputs, `cosign verify-blob`, checksum
verification, mandatory independent rebuild-and-compare, deploy to the offline
device, and the host:port origin boundary — is
[install-route-a.md](install-route-a.md). Its mandatory set matches the
archive's `INSTALL.txt`; do not treat this page as a second incomplete copy of
that procedure.

The exact `http://HOST:PORT` is a security and storage boundary: serving another
page from the same host and port later gives it same-origin access to the stored
keys and Vault key, while changing the port after installation creates a
different origin that cannot reach that data. Route A must therefore use one
dedicated, uncommon fixed high port that is never reused.

Install route B fetches the PWA directly from its live origin and provides no
integrity check that the recipient can perform. Control of the origin, TLS, or
CDN lets an attacker target one device with an altered bundle that the recipient
cannot detect and the Service Worker will persist. The installed device also
retains that live origin: on reconnection its same-origin reachability probe is a
beacon, and wipe cannot fire until after the sentinel response confirms
reachability. Route A instead points at `127.0.0.1`; after its dedicated server
is stopped and its reserved port is not reused, the probe has no peer.
High-assurance use must use Route A only.
