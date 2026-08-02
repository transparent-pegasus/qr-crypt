# Install route A: signed ZIP

日本語版: [docs/languages/ja/develop/install-route-a/README.md](../../languages/ja/develop/install-route-a/README.md)

The complete procedure for high-assurance offline installation. The archive's
`INSTALL.txt` is the self-contained copy that reaches the offline device. For
independent verification, the copy of this document at the authenticated source
commit is the authority: compare the archive instructions against it and treat
any added, omitted, weakened, or otherwise changed requirement as a tampering
signal. The current release workflow generates `INSTALL.txt` from an inline
heredoc rather than versioned source, so that member cannot yet be reproduced
byte-for-byte; this open limitation is stated in §5 and in the security review.

## 1. Scope

Route A is the only route suitable for high-assurance use. It keeps the offline
device from ever contacting the live app origin: you verify a signed static ZIP on
a trusted computer, carry it to the offline device, and serve it from
`127.0.0.1` on a reserved port.

Route B gives the recipient no integrity check they can perform. An attacker who
controls the origin, TLS, or CDN can serve one targeted device an altered bundle
that the Service Worker persists. Going offline afterwards does not undo it: a
tampered build can weaken the RNG, swap a loaded public key, or embed plaintext
in data that looks like ciphertext and have the user carry it out as ordinary
`OCF2:` frames. That covert-egress scenario is **T21** in
[docs/security/threat-model.md](../../security/threat-model.md). **T19** covers only
the relay mechanics (OCF2 allowlist for `pq-message` \| `sym-message`,
assembled-artifact schema validation before playback, no AEAD on the online hop,
no frame- or artifact-derived app persistence) — not installation integrity.
**T21** states the residual that validation does not close: covert data inside
otherwise valid ciphertext, salt, IV, or other sender-controlled fields.

## 2. Independently authenticated inputs — mandatory

Treat the ZIP, its signature bundle, `SHA256SUMS`, the release page, the transport
medium, and this document as untrusted until verification succeeds. Independently
provision and authenticate all of the following through a channel independent of
the download:

- an authenticated Cosign version and binary
- the current Sigstore trusted root (`trusted_root.json`)
- the certificate identity (workflow identity)
- the OIDC issuer
- the repository
- the ref
- the workflow trigger
- the intended release tag
- the full source commit

Never copy expected policy values from the media being verified. Same-media
checksums and trust roots are not independent trust anchors. Keyless signing
publishes identity and digest to Sigstore transparency.

## 3. Verify the release — mandatory

On a computer you trust, obtain the three release assets: the
`qr-crypt-…-static-install.zip` archive, its `.sigstore.json` bundle, and
`SHA256SUMS`. From the directory that contains them, fill the shell variables
from your independently provisioned policy — not from literals in this document
or in the download — and verify:

```bash
cosign verify-blob "$QR_CRYPT_ARCHIVE" \
  --bundle "$QR_CRYPT_BUNDLE" \
  --trusted-root /independently/provisioned/trusted_root.json \
  --certificate-identity "$QR_CRYPT_TRUSTED_WORKFLOW_IDENTITY" \
  --certificate-oidc-issuer "$QR_CRYPT_TRUSTED_OIDC_ISSUER" \
  --certificate-github-workflow-repository "$QR_CRYPT_TRUSTED_REPOSITORY" \
  --certificate-github-workflow-ref "$QR_CRYPT_TRUSTED_REF" \
  --certificate-github-workflow-sha "$QR_CRYPT_EXPECTED_SOURCE_SHA" \
  --certificate-github-workflow-trigger "$QR_CRYPT_TRUSTED_TRIGGER"

sha256sum -c SHA256SUMS
```

Only after verification may you compare the archive's displayed source commit and
tag with the independently authenticated intended values. The signature
authenticates the ZIP. It does not make removable media, firmware, the operating
system, browser, or local server safe.

## 4. Validate the archive container before extraction — mandatory

A valid signature proves who published the bytes; it does not make a hostile ZIP
safe to parse or extract. The compromised-CI attacker this procedure is meant to
detect can publish a correctly signed malicious container.

Before extraction, inspect the central directory and local entry headers with an
archive reader obtained and authenticated independently of the release. Reject
the ZIP unless all of these checks pass:

- Every member is beneath exactly one expected root directory whose name is
  derived from the independently authenticated release tag. Reject absolute,
  drive-qualified, UNC, empty, `.`, or `..` path components and any backslash or
  other alternate separator.
- Member names are unique and unambiguous after separator normalization, Unicode
  normalization, and case folding. Reject duplicate local/central-header names,
  case-only aliases, trailing-dot/space aliases, and header disagreements.
- Every payload entry is a regular file or an expected directory. Reject symbolic
  links, hard links, devices, FIFOs, sockets, sparse/special files, and entries
  whose external attributes or mode disagree with their declared type.
- Entry count, each declared and expanded file size, and total expanded size are
  within conservative limits chosen before reading the archive from the
  independently authenticated expected build layout. Reject integer overflows,
  overlapping entries, encrypted entries, unsupported compression methods, and
  suspicious compression ratios.
- The root layout contains only the expected application tree plus
  `INSTALL.txt` and `SHA256SUMS.files`. No member may sit beside or outside that
  root.

Only after all checks pass, extract with a no-link, traversal-safe mechanism that
revalidates every destination beneath a new empty root and enforces the same
count and size limits while expanding. Do this in a disposable isolated
environment with no secrets, credentials, sensitive mounts, or network access.
The extraction root must be outside the source checkout. Never extract with a
mechanism that follows archive-created links.

## 5. Rebuild and compare independently — mandatory

The independent comparison must account for **every** archive member, including
`INSTALL.txt` and `SHA256SUMS.files`. Running `sha256sum -c
SHA256SUMS.files` alone proves only that an attacker-controlled manifest is
self-consistent with an attacker-controlled archive; it does not establish
source correspondence.

1. Prepare a clean checkout at the independently authenticated source commit.
   Use the validated, safely extracted root from §4. Never put the extracted
   archive or a copied/stale build tree under the checkout: Tailwind scans the
   project tree, and such leftovers can change generated CSS and cause a false
   mismatch.

```bash
set -euo pipefail
export QR_CRYPT_SOURCE_SHA=<independently-authenticated-full-source-commit>
export QR_CRYPT_CHECKOUT=/absolute/path/to/clean-checkout
export QR_CRYPT_ARCHIVE_ROOT=/absolute/path/outside-checkout/<extracted-root>
test "$(git -C "$QR_CRYPT_CHECKOUT" rev-parse HEAD)" = \
  "$QR_CRYPT_SOURCE_SHA"
test -z "$(git -C "$QR_CRYPT_CHECKOUT" status \
  --porcelain --untracked-files=all)"
```

2. Install and use the Node and aube versions pinned by `mise.toml`, then build
   with the authenticated commit as the build identity:

```bash
(
  cd "$QR_CRYPT_CHECKOUT"
  mise install
  mise exec -- aube ci
  VITE_BUILD_SHA="$QR_CRYPT_SOURCE_SHA" \
    mise exec -- aube run build:prod
)
```

3. Compare the complete application payload file set and every payload byte.
   Do not exclude `about/` or any other archive payload member:

```bash
export QR_CRYPT_COMPARE_TMP="$(mktemp -d)"
(
  cd "$QR_CRYPT_CHECKOUT/dist"
  find . -type f -printf '%P\n' |
    LC_ALL=C sort
) > "$QR_CRYPT_COMPARE_TMP/rebuilt.files"
(
  cd "$QR_CRYPT_ARCHIVE_ROOT"
  find . -type f \
    ! -path './INSTALL.txt' \
    ! -path './SHA256SUMS.files' \
    -printf '%P\n' |
    LC_ALL=C sort
) > "$QR_CRYPT_COMPARE_TMP/archive-payload.files"
diff -u "$QR_CRYPT_COMPARE_TMP/rebuilt.files" \
  "$QR_CRYPT_COMPARE_TMP/archive-payload.files"
(
  cd "$QR_CRYPT_CHECKOUT/dist"
  while IFS= read -r file; do
    sha256sum -- "$file"
  done < "$QR_CRYPT_COMPARE_TMP/rebuilt.files"
) > "$QR_CRYPT_COMPARE_TMP/rebuilt.sha256"
(
  cd "$QR_CRYPT_ARCHIVE_ROOT"
  while IFS= read -r file; do
    sha256sum -- "$file"
  done < "$QR_CRYPT_COMPARE_TMP/archive-payload.files"
) > "$QR_CRYPT_COMPARE_TMP/archive-payload.sha256"
diff -u "$QR_CRYPT_COMPARE_TMP/rebuilt.sha256" \
  "$QR_CRYPT_COMPARE_TMP/archive-payload.sha256"
```

4. Open the archive's `INSTALL.txt` and
   `$QR_CRYPT_CHECKOUT/docs/develop/install-route-a/README.md` from the authenticated
   checkout side by side. Check the archive's displayed version, tag, and full
   source commit against the independently authenticated values. Then compare
   every instruction, prohibition, prerequisite, security assumption, and server
   requirement against this document. The archive may condense rationale and may
   substitute the independently verified release metadata, but it must not add,
   omit, weaken, or change an operational requirement. In particular, it must
   require the §4 pre-extraction validation and the audited, already-preinstalled,
   independently obtained server in §7. Any divergence is a tampering signal:
   stop and reject the release; do not “repair” the archive copy locally.

5. Recreate `SHA256SUMS.files` locally instead of trusting or merely checking the
   archive's manifest. Assemble an expected root from the independently rebuilt
   payload and the exact `INSTALL.txt` bytes that passed step 4, generate a sorted
   manifest locally, compare the manifest bytes, and finally compare the complete
   roots. This accounts for the payload, `INSTALL.txt`, and
   `SHA256SUMS.files`:

```bash
export QR_CRYPT_REBUILT_ROOT="$QR_CRYPT_COMPARE_TMP/rebuilt-root"
mkdir -p "$QR_CRYPT_REBUILT_ROOT"
cp -a "$QR_CRYPT_CHECKOUT/dist/." "$QR_CRYPT_REBUILT_ROOT/"
cp -- "$QR_CRYPT_ARCHIVE_ROOT/INSTALL.txt" \
  "$QR_CRYPT_REBUILT_ROOT/INSTALL.txt"
(
  cd "$QR_CRYPT_REBUILT_ROOT"
  find . -type f ! -path './SHA256SUMS.files' -printf '%P\0' |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum
) > "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"
test -s "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"
if grep -Evq \
  '^[0-9a-f]{64}  [A-Za-z0-9._/-]+$' \
  "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"; then
  printf 'locally generated invalid SHA256SUMS.files entry\n' >&2
  exit 1
fi
diff -u "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files" \
  "$QR_CRYPT_ARCHIVE_ROOT/SHA256SUMS.files"
diff -qr "$QR_CRYPT_REBUILT_ROOT" "$QR_CRYPT_ARCHIVE_ROOT"
rm -rf -- "$QR_CRYPT_COMPARE_TMP"
```

The last `diff` must report no difference. It covers every permitted member; it
is not a substitute for the pre-extraction path, type, duplicate-name, and
expansion checks in §4.

What the CI gate does **not** prove: the in-CI double build shows same-environment
determinism only, not environment-independent reproducibility. The Cosign
signature attests that that workflow published that artifact (workflow and source
commit provenance). Neither establishes source-to-binary correspondence.
`INSTALL.txt` is currently generated inside the release workflow and is not
derived from versioned source, so it cannot be byte-reproduced independently
today; step 4 is an instruction-level comparison, and copying its reviewed bytes
into the expected root does not remove that residual. Moving a deterministic
generator or template into versioned source is an open release-pipeline item
outside this branch. Until that is fixed, any `INSTALL.txt` divergence from the
authenticated repository document is grounds to reject the release. The
remaining payload and locally regenerated manifest are byte-compared
independently.

## 6. Recommended practice, beyond INSTALL.txt

The following is **recommended**, not mandatory. `INSTALL.txt` does not require
it; treating it as required would disagree with the archive copy.

- Confirm the verification and rebuild-and-compare outcomes on a second,
  separately administered environment (different machine, different
  administrator, independently provisioned Cosign and trusted root).
- Keep an installation record of the verified ZIP hash, the authenticated source
  commit, and the toolchain versions used for the rebuild (`mise.toml` pins and
  the Cosign version).

## 7. Deploy to the offline device

1. Move the verified archive to the offline device. Whatever you carry it on — a
   USB stick, an SD card — has to be trusted too: anything that can alter the
   storage can alter the app.
2. Use only the container-validated, traversal-safe extraction produced by §4.
   The ZIP creates a single directory; that directory is the document root.
3. Serve it with an **audited static server that was already preinstalled on the
   offline device and obtained through an independent trusted process**, bound to
   `127.0.0.1` only. A server merely installed through a route called “trusted”
   is not equivalent. It must apply the bundled `_headers` and `_redirects`
   semantics: the security headers, correct MIME types, the SPA fallback to
   `/index.html`, and `no-store` for the reachability sentinel. Meta CSP fallback
   and `frame-ancestors` header-only rule:
   [threat-model.md](../../security/threat-model.md) §2. Choose one uncommon fixed high
   port (not a collision-prone default such as 8000 or 8080) and reserve that port
   for QR Crypt.

   Most static servers ignore `_headers` entirely, and nothing in the app detects
   that. If your server does not apply it, the six non-CSP security headers are
   simply absent — only the meta CSP and the `<meta name="referrer">` fallback
   survive; see [threat-model.md](../../security/threat-model.md) §2 for exactly
   what is lost. `scripts/serve-dist.mjs` in the source tree is this repository's
   reference implementation of the required behaviour and is the definition of
   "`_headers` semantics" your server must reproduce. Read it to derive your own
   server's configuration — do **not** carry it onto the offline device as another
   artifact to verify; it is Node tooling, not part of the signed release.
4. Open the exact `http://127.0.0.1:PORT` origin and wait until the app reports
   that offline use is ready.
5. Stop the server, remove the transport medium, physically disconnect
   networking, and confirm QR Crypt reports offline **before** entering or
   restoring any secret. The install server's own sentinel deliberately makes the
   app treat that origin as reachable, so never enter secrets while it is
   running.

Opening `index.html` with `file://` is unsupported. Plain HTTP on a LAN address
is unsupported.

## 8. Why the origin is a boundary

That exact host and port are a security and storage boundary. Browser origin is
determined only by scheme, host, and port; this local HTTP deployment has neither
TLS nor host authentication. `localhost` and `127.0.0.1` are different origins,
so always use `127.0.0.1`.

If another page is later served on the same host:port, it has same-origin access
to the stored keys and the Vault key; even a non-extractable key can still
decrypt through `crypto.subtle`. Changing the port after installation makes QR
Crypt a different origin that cannot reach its stored data. Never serve anything
else on the chosen host:port, and keep that port fixed.
