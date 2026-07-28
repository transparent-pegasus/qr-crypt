# Install route A: signed ZIP

The complete procedure for high-assurance offline installation. The archive's
`INSTALL.txt` is the self-contained copy that reaches the offline device; this
document must not make anything mandatory that `INSTALL.txt` omits. Mandatory
steps below match that set. Recommended practice beyond `INSTALL.txt` is labelled
as such.

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
[docs/security/threat-model.md](../security/threat-model.md). **T19** covers only
the relay mechanics (outer-header filter, no assembly or AEAD on the online hop,
no frame-derived app persistence) — not installation integrity.

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

## 4. Rebuild and compare independently — mandatory

The signed ZIP contains `SHA256SUMS.files`. The ZIP signature authenticates that
manifest, and the manifest authenticates every other archive file, including
`INSTALL.txt`. Compare those authenticated bytes with a local rebuild:

1. Prepare a clean checkout at the independently authenticated source commit.
   Extract the authenticated ZIP into a new empty directory outside that
   checkout. Never put the extracted archive or a copied/stale build tree under
   the checkout: Tailwind scans the project tree, and such leftovers can change
   generated CSS and cause a false mismatch.

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

3. From inside the extracted archive root, verify the manifest format, the
   complete member set (the manifest excludes only itself), and every listed
   hash:

```bash
export QR_CRYPT_COMPARE_TMP="$(mktemp -d)"
(
  cd "$QR_CRYPT_ARCHIVE_ROOT"
  test -s SHA256SUMS.files
  if grep -Evq \
    '^[0-9a-f]{64}  [A-Za-z0-9._/-]+$' SHA256SUMS.files; then
    printf 'invalid SHA256SUMS.files entry\n' >&2
    exit 1
  fi
  test -z "$(find . -mindepth 1 ! -type d ! -type f \
    -print -quit)"
  cut -c67- SHA256SUMS.files |
    LC_ALL=C sort > "$QR_CRYPT_COMPARE_TMP/archive.listed"
  find . -type f ! -path './SHA256SUMS.files' -printf '%P\n' |
    LC_ALL=C sort > "$QR_CRYPT_COMPARE_TMP/archive.actual"
  grep -Fxq INSTALL.txt "$QR_CRYPT_COMPARE_TMP/archive.listed"
  diff -u "$QR_CRYPT_COMPARE_TMP/archive.listed" \
    "$QR_CRYPT_COMPARE_TMP/archive.actual"
  sha256sum -c SHA256SUMS.files
)
```

4. Compare both the sorted payload file set and each per-file hash. The
   production build's online-only `about/` tree is excluded on the rebuild side;
   packaging-only `INSTALL.txt` and `SHA256SUMS.files` are excluded on the
   archive side:

```bash
(
  cd "$QR_CRYPT_CHECKOUT/dist"
  find . -type f ! -path './about/*' -printf '%P\n' |
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
rm -rf -- "$QR_CRYPT_COMPARE_TMP"
```

What the CI gate does **not** prove: the in-CI double build shows same-environment
determinism only, not environment-independent reproducibility. The Cosign
signature attests that that workflow published that artifact (workflow and source
commit provenance). Neither establishes source-to-binary correspondence; only an
independent rebuild does. An attacker who controls the CI environment can still
publish a correctly signed backdoor; only an independent rebuild comparison can
detect that case.

## 5. Recommended practice, beyond INSTALL.txt

The following is **recommended**, not mandatory. `INSTALL.txt` does not require
it; treating it as required would disagree with the archive copy.

- Confirm the verification and rebuild-and-compare outcomes on a second,
  separately administered environment (different machine, different
  administrator, independently provisioned Cosign and trusted root).
- Keep an installation record of the verified ZIP hash, the authenticated source
  commit, and the toolchain versions used for the rebuild (`mise.toml` pins and
  the Cosign version).

## 6. Deploy to the offline device

1. Move the verified archive to the offline device. Whatever you carry it on — a
   USB stick, an SD card — has to be trusted too: anything that can alter the
   storage can alter the app.
2. Extract it. The ZIP creates a single directory; that directory is the
   document root.
3. Serve it with a static server that was already installed on the offline device
   through a trusted route, bound to `127.0.0.1` only. It must apply the bundled
   `_headers` and `_redirects` semantics: the security headers, correct MIME
   types, the SPA fallback to `/index.html`, and `no-store` for the reachability
   sentinel. The production build also carries the supported part of the same CSP
   in a meta tag as a fallback, but `frame-ancestors` cannot be enforced there and
   remains available only through the `_headers` response header. Choose one
   uncommon fixed high port (not a collision-prone default such as 8000 or 8080)
   and reserve that port for QR Crypt.
4. Open the exact `http://127.0.0.1:PORT` origin and wait until the app reports
   that offline use is ready.
5. Stop the server, remove the transport medium, physically disconnect
   networking, and confirm QR Crypt reports offline **before** entering or
   restoring any secret. The install server's own sentinel deliberately makes the
   app treat that origin as reachable, so never enter secrets while it is
   running.

Opening `index.html` with `file://` is unsupported. Plain HTTP on a LAN address
is unsupported.

## 7. Why the origin is a boundary

That exact host and port are a security and storage boundary. Browser origin is
determined only by scheme, host, and port; this local HTTP deployment has neither
TLS nor host authentication. `localhost` and `127.0.0.1` are different origins,
so always use `127.0.0.1`.

If another page is later served on the same host:port, it has same-origin access
to the stored keys and the Vault key; even a non-extractable key can still
decrypt through `crypto.subtle`. Changing the port after installation makes QR
Crypt a different origin that cannot reach its stored data. Never serve anything
else on the chosen host:port, and keep that port fixed.
