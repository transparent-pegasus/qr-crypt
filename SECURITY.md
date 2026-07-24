# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub's **private vulnerability
reporting** (the "Report a vulnerability" button under this repository's
**Security** tab, which opens a draft Security Advisory). Do not open a public
issue for security problems.

Include, where possible: affected component or file, reproduction steps, and
the impact you believe it has (e.g. key material exposure, plaintext
persistence, bypass of the offline acknowledgement or OnlineGate flow).

## Scope

In scope:

- This repository: an offline-first encryption PWA (QR-based key and message
  exchange), including its cryptographic code paths, storage handling
  (IndexedDB / localStorage), service worker, and build tooling.

Out of scope:

- There is **no server component**. The app performs no network transfer of
  key material or plaintext; issues in third-party hosting of the static
  files are out of scope here (report them to the host).
- Vulnerabilities requiring a fully compromised device or browser.

## Response

This project is maintained by a **single maintainer**. Reports are handled on
a **best-effort** basis: expect an initial acknowledgement typically within a
couple of weeks, with no guaranteed fix timeline.

## Project status — not release-approved

Public availability of this repository does **not** mean it has passed a
release gate. The codebase is **not independently audited**. See
[docs/security-review.md](docs/security-review.md) for current release
blockers and review status, and
[docs/threat-model.md](docs/threat-model.md) for accepted risks and known
limitations (including that wipe-on-online is best-effort logical deletion —
physical erasure is not guaranteed).

## No bug bounty

There is no bug bounty program; no monetary reward is offered for reports.
