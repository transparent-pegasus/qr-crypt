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
  static install ZIP offered as install route B, signs it with Cosign, and generates
  the `INSTALL.txt` verification and local-server instructions carried inside the ZIP.
  Before upload, it extracts the exact archive, starts the shared server with
  `SERVE_DIST_ROOT` set to that extracted tree, checks the sentinel body and
  `no-store` response, required CSP response directives, manifest MIME type, and
  SPA fallback, then runs the e2e suite against those archived bytes

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

A self-hosted install (route B) still needs a separately trusted static server
that reproduces the bundled response-header and routing behavior: the security
headers, correct MIME types, SPA fallback, and `no-store` on the reachability
sentinel. In particular, a server that relies only on the injected meta tag does
not enforce `frame-ancestors`.
