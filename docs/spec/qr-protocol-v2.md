# QR Crypt QR Protocol Specification v2

This document is the normative specification of the v2 wire format (post-quantum
and symmetric). The implementation (`src/crypto/pq/*`, `src/crypto/aes-gcm.ts`,
`src/qr/payload-v2.ts`, `src/qr/multipart/*`) and the golden fixtures in
`tests/pq/*` follow this document. There is no v1 wire family: prefixes
`OCM1` / `OCK1` / `OCP1` / `OCB1` and the cbor-x envelope stack are rejected at
every boundary.

## 1. Prefix table

| Prefix | artifactType / kind | Contents |
|---|---|---|
| `OCM2:` | `pq-message` | ML-KEM message envelope |
| `OCA2:` | `sym-message` | Symmetric HKDF-AES message envelope |
| `OCK2:` | `symmetric-key` | Symmetric AES-256 key envelope |
| `OCP2:` | `pq-kem-public-key` | ML-KEM public key (single key) |
| `OCS2:` | `pq-dsa-public-key` | ML-DSA signature-verification public key (single key) |
| `OCI2:` | `pq-public-identity` | Public key set (KEM+DSA) |
| `OCB2:` | `encrypted-seed-backup` | Reserved (neither produced nor accepted) |
| `OCF2:` | frame | Multi-frame QR |

- `OCM2` / `OCA2` / `OCK2` / `OCP2` / `OCS2` / `OCI2` are single-payload
  representations (paste / file import) and logical types. **QR display always
  goes through `OCF2` (frameCount ≥ 1)**.
- Import supports both (a) `OCF2` assembly → inner artifact, and (b) a bare
  `OC?2` single paste.
- `OCB2` is a reserved prefix, rejected unconditionally as
  `UNSUPPORTED_ALGORITHM` at classification time. There is no feature flag: it
  is never generated and never accepted.
- Managed deviation: `pq-kem-public-key` / `pq-dsa-public-key` were added beyond
  the three artifactType values of the original draft specification (single
  keys are also always carried via framing; see
  [../develop/deviations.md](../develop/deviations.md)).

## 2. Canonical CBOR profile (shared by all v2 structures)

A subset of RFC 8949 §4.2.1 core deterministic encoding. Implemented in
`src/crypto/pq/canonical-cbor.ts` (an in-house codec; no external CBOR library
is used for v2, so the wire contract is decoupled from version-dependent
behavior of third-party codecs).

- Values are restricted to **map (text keys only) / text string /
  byte string / non-negative integer**
- All definite length. **Tags, floats, negative integers, arrays, null,
  bool, and simple values are forbidden**
- Integers and length headers use the minimal representation
  (preferred encoding)
- Map keys are ordered bytewise-lexicographically by the encoded bytes of
  the key alone; duplicates are forbidden
- The decoder structurally enforces minimal representation, ascending key
  order, and a single value, and additionally checks re-encoded byte
  equality (non-canonical input always yields `INVALID_QR_PAYLOAD`)
- Nesting depth limit: 8
- Decoder input is limited to 1–128,000 bytes. Structural allocation has
  separate limits because a byte limit alone does not bound entry count or
  retained heap: at most 8 entries in one map (the largest active shapes
  include `QrFrameV2`, `MlKemMessageEnvelopeV2`, and `SymMessageEnvelopeV2`),
  13 map entries across the decoded value, 18 UTF-8 bytes per map key
  (`senderSigningKeyId`, the longest decoded key), and 300 UTF-8 bytes per text
  value. Length/count headers are rejected before their loops or strings are
  materialized
- Decoded maps have null prototypes. Encoded attacker-supplied keys are not
  retained in a process-lifetime cache; canonical re-encoding computes them
  for the current operation only

## 3. Post-quantum envelope (OCM2)

```typescript
MlKemMessageEnvelopeV2 = {
  version: 2
  type: "pq-message"
  suite: WireSuite            // the single active suite of §4
  recipientKemKeyId: string   // base64url, 22 characters (16 raw bytes)
  kemCiphertext: bytes        // ML-KEM-1024: 1568B (length validated per suite)
  hkdfSalt: bytes(32)         // fresh CSPRNG per encryption
  iv: bytes(12)               // CSPRNG
  ciphertext: bytes(≥16)      // AES-256-GCM (128-bit tag at the end)
}
```

Canonical map key order (encoded-key byte order):
`iv`, `type`, `suite`, `version`, `hkdfSalt`, `ciphertext`,
`kemCiphertext`, `recipientKemKeyId`.

AAD (GCM `additionalData`; not carried on the wire, reconstructed on both
sides):

```typescript
MlKemAadV2 = {
  version: 2
  type: "pq-message"
  suite: WireSuite
  recipientKemKeyId: string
  kemCiphertextSha256: bytes(32)  // receiver recomputes from the received kemCiphertext and verifies equality
}
```

## 3.1 Symmetric message envelope (OCA2)

```typescript
SymMessageEnvelopeV2 = {
  version: 2
  type: "sym-message"
  suite: "HKDF-SHA256+A256GCM"   // SymSuite; not a WireSuite value
  keyId: string                  // base64url, 22 characters (16 raw bytes)
  createdAt: uint                // device-reported time (not trusted time)
  hkdfSalt: bytes(32)            // fresh CSPRNG per encryption
  iv: bytes(12)                  // CSPRNG
  ciphertext: bytes(16 .. MAX_SYM_PLAINTEXT_BYTES + 16)
}
```

Canonical map key order (encoded-key byte order):
`iv`, `type`, `keyId`, `suite`, `version`, `hkdfSalt`, `createdAt`,
`ciphertext`.

AAD (GCM `additionalData`; not carried on the wire; both sides recompute).
`hkdfSalt` is excluded from AAD — salt selects the derived key, and a forged
salt fails GCM authentication via key mismatch:

```typescript
SymAadV2 = {
  version: 2
  type: "sym-message"
  suite: "HKDF-SHA256+A256GCM"
  keyId: string
  createdAt: uint
}
```

Canonical AAD key order: `type`, `keyId`, `suite`, `version`, `createdAt`.

### Single-frame hard constraint

`sym-message` and `symmetric-key` artifacts always render as exactly one OCF2
frame. Generation picks the smallest `FRAME_BYTES_VALUES` entry ≥ artifact
length and asserts `frames.length === 1`; a violation is `QR_TOO_LARGE` (a
generation-side bug).

Measured overhead and plaintext ceiling (`src/lib/limits.ts`, pinned by
`tests/pq/sym-envelope.golden.test.ts`):

| Constant | Value | Meaning |
|---|---:|---|
| `FRAME_CHUNK_MAX_BYTES` | 1,000 | One OCF2 chunk / one frame of raw artifact |
| `SYM_MESSAGE_OVERHEAD_BYTES` | 174 | Canonical CBOR map overhead excluding ciphertext bytes (1B map header + 159B fixed fields + 11B `ciphertext` key + 3B byte-string header at the max boundary) |
| `AES_GCM_TAG_BYTES` | 16 | GCM authentication tag |
| `MAX_SYM_PLAINTEXT_BYTES` | 810 | `1,000 − 174 − 16` |

An envelope whose `ciphertext.byteLength === MAX_SYM_PLAINTEXT_BYTES + 16`
encodes to exactly 1,000 bytes; one more plaintext byte fails validation.

## 3.2 Symmetric key envelope (OCK2)

```typescript
SymmetricKeyEnvelopeV2 = {
  version: 2
  type: "symmetric-key"
  algorithm: "A256GCM"
  keyId: string               // base64url, 22 characters; becomes the StoredKeyRecord id on import
  createdAt: uint
  key: bytes(32)              // raw AES-256 key
}
```

Canonical map key order (encoded-key byte order):
`key`, `type`, `keyId`, `version`, `algorithm`, `createdAt`.

- No `name` on the wire (the importer names the record).
- Export / QR share is permitted for the active head generation only.
- OCK2 also obeys the single-frame hard constraint of §3.1.

## 4. Suites and key derivation

Active suites after the single-active vocabulary purge:

| Role | Suite string |
|---|---|
| Post-quantum (`WireSuite`) | `ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM` |
| Symmetric (`SymSuite`) | `HKDF-SHA256+A256GCM` |

Every other suite string — including retired unsigned ML-KEM suites,
`ML-KEM-768*`, `ML-DSA-65`, and the `balanced` profile — is rejected at every
boundary as `UNSUPPORTED_ALGORITHM` or `INVALID_QR_PAYLOAD`.

Fixed sizes in `src/crypto/pq/profiles.ts` (bytes; maximum profile only):

| profile | KEM | public key | expanded secret key | ciphertext | shared secret | seed |
|---|---|---:|---:|---:|---:|---:|
| maximum | ML-KEM-1024 | 1568 | 3168 | 1568 | 32 | 64 |

| profile | DSA | public key | expanded secret key | signature | seed |
|---|---|---:|---:|---:|---:|---:|
| maximum | ML-DSA-87 | 2592 | 4896 | 4627 | 32 |

The expanded secret key is expanded from the seed at runtime; it is never
stored on the wire or in persistent storage (§7).

- The suite is **derived uniquely from the actual algorithm pair of the
  selected keys** (`resolveSuite(kem, signature)` — signature required).
  Only the same-profile pair (1024, 87) is admitted.
- `SymSuite` is independent of `WireSuite` (the latter is PQ envelope
  cross-binding vocabulary only).

### PQ HKDF (`hkdfInfoV2`)

```
info = UTF8("QR-CRYPT-MESSAGE-V2") || 0x00 || UTF8(wireSuite) || 0x00
       || kemKeyIdRaw(16 bytes) || 0x02
salt = fresh CSPRNG 32B per encryption / derived key = AES-256-GCM (non-extractable)
```

`kemKeyIdRaw` is the **raw 16 bytes underlying** the keyId (22 base64url
characters), i.e. before encoding.

Decryption success conditions (fixed order): KEM input length validation →
Decaps → HKDF → **AES-GCM authentication success** → inner schema validation →
ML-DSA verification. Failure is `DECRYPTION_FAILED` (signature-only failure
is `SIGNATURE_INVALID` with the body withheld; an unregistered signing key
yields the `signed-key-unknown` state and the body is not constructed).

### Symmetric HKDF (`hkdfInfoSymV2`)

```
info = UTF8("QR-CRYPT-SYM-MESSAGE-V2") || 0x00 || UTF8("HKDF-SHA256+A256GCM") || 0x00
       || keyIdRaw(16 bytes) || 0x02
salt = fresh CSPRNG 32B per message / derived key = AES-256-GCM (non-extractable)
ikm  = exported raw AES key bytes (zeroized after derive)
```

Symmetric crypto runs on the main-thread WebCrypto path (no Worker). Every
`openSymMessage` failure collapses to a new `AppError("DECRYPTION_FAILED")`.

## 5. Inner message (Sign-then-Encrypt)

Every post-quantum message is signed. The wire shape is the signed map only:

```
{ body: SignedMessageBodyV2, signature: { algorithm, value } }
```

`SignedMessageBodyV2` keys: `version`, `messageId(16B)`, `createdAt`,
`recipientKemKeyId`, `senderSigningKeyId` (required), `plaintext`.
`signature.value` length for ML-DSA-87 is 4627B.

- **The signing target = the canonical CBOR of the bare
  `SignedMessageBodyV2` map** (`signingTargetBytes`)
- ML-DSA context = fixed `UTF8("QR-CRYPT-MESSAGE-V2")` (≤255B)
- `messageId` = fixed-length CSPRNG 16B. **It is not a replay-prevention
  mechanism** of the wire format. The receiving implementation keeps a
  session-memory receipt keyed by the authenticated message ID
  (`src/features/receipt-cache.ts`); that check is session-scoped and does not
  change the wire format. `createdAt` is the device-reported time (not trusted
  time)
- The post-quantum path accepts at most 120,000 UTF-8 plaintext bytes. The
  symmetric path is separately capped at `MAX_SYM_PLAINTEXT_BYTES` (810) by
  the single-frame hard constraint (§3.1)

## 6. Multi-frame QR (OCF2)

```typescript
QrFrameV2 = {
  version: 2
  type: "qr-frame"
  transferId: bytes(16)       // CSPRNG
  artifactType: V2ArtifactType
  frameIndex: uint            // 0-based (0..frameCount-1)
  frameCount: uint            // 1..128
  totalByteLength: uint       // total raw artifact bytes (1..128,000; absolute bound)
  chunk: bytes(1..1,000)      // slice of the raw artifact CBOR bytes
}
```

- **`chunk` splits the raw artifact CBOR bytes directly** (re-base64url of
  the inner `OC?2:` string is forbidden — this avoids frame-count inflation
  from double base64url)
- Frame string = `OCF2:<base64url(canonicalCBOR(frame))>`. EC level is
  **fixed at Q**. A single frame string, prefix included, is **≤1663
  characters** (QR v40-Q). After generation, check `payloadFits(…, "Q")`;
  if it does not fit, `QR_TOO_LARGE`. At the 1,000B chunk ceiling, the
  worst-case metadata across every artifact type produces a 1,529-character
  OCF2 payload, below the 1,663-character EC-Q version 40 capacity. A raw
  worst-metadata 1,100B frame would land exactly at that capacity, but the
  protocol chunk and generated-density ceilings remain 1,000B
- A sender selects exactly one split mode: fixed `frameBytes`, or an explicit
  balanced `frameCount`. Count mode rejects non-integers, counts above
  `VITE_QR_MAX_FRAMES` or the artifact byte length, and any result whose
  largest chunk exceeds 1,000B. Every chunk is non-empty and largest/smallest
  lengths differ by at most one byte. ("balanced" here means even chunking of
  the split, not the retired crypto profile name.)
- Receiver and bare-paste allocation are intentionally bounded by
  `MAX_ARTIFACT_BYTES_ABSOLUTE =
  PROTOCOL_MAX_FRAMES × FRAME_CHUNK_MAX_BYTES = 128 × 1,000 = 128,000`
  bytes. The receiver also enforces frame count ≤128, chunk length ≤1,000B,
  and `totalByteLength ≤ frameCount × 1,000`. A bare `OC?2` paste is capped
  at 170,672 characters (the five-character prefix plus the base64url
  ceiling), and its decoded bytes are checked again against 128,000
- Generated OCF2 display exposes one labelled compatibility switch. Off is the
  shipped default preference, `{ frameBytes: 1000, frameIntervalMs: 200 }`;
  on is the user-selected compatible preference,
  `{ frameBytes: 100, frameIntervalMs: 2000 }`. The switch writes both
  preference members together; a preference patch that supplies only one
  member or any other pair is rejected
- The application does not infer density or dwell from the displaying
  device's QR reader. That device cannot answer whether the peer camera can
  read its screen
- Before each split, the renderer computes
  `gridMin = 100 × ceil(ceil(totalByteLength / VITE_QR_MAX_FRAMES) / 100)`.
  The per-artifact effective density clamp is
  `max(preferredFrameBytes, gridMin)`. Intermediate densities are effective
  values only: the complete generated-density grid is every 100B value from
  100 through 1,000B, and a raised value is never persisted over the selected
  preference. An artifact above 128,000B is rejected before splitting; if
  `gridMin > 1,000`, generation fails as `QR_TOO_LARGE`. A switch change that
  changes effective density, or a changed artifact clamp, re-splits the
  artifact and mints a new `transferId`; mixing generations is terminal
  `FRAME_MISMATCH`. When `gridMin` is already 1,000B, switching still changes
  the dwell from 200ms to 2,000ms even though effective density remains
  1,000B
- The automatic cursor advances only after `QrDisplay` has committed the
  exact rendered payload, then starts a one-shot timeout for the selected
  preference's dwell. The configured 200ms or 2,000ms is therefore a
  **minimum visible dwell**, not a measured cadence. A real cycle is the sum
  of every frame's render latency and dwell and must be measured separately
- Export has one Download control. Exactly one complete frame produces one
  PNG; multiple complete frames produce one store-only ZIP containing PNGs.
  SVG export is not offered
- Assembly invariants: the first frame freezes the immutable metadata
  (transferId/artifactType/frameCount/totalByteLength).
  A repeated index is ignored only on an exact match; even a 1-byte
  difference or a frame from another transferId is `FRAME_MISMATCH`. On
  completion, verify index coverage, total length, and artifactType match
  before interpreting the inner payload. No
  cryptographic processing starts while assembly is incomplete
- Frames do not carry an artifact digest. A value the receiver can recompute
  from the frames alone is equally computable by anyone who photographs one,
  and a hostile sender can compute it over their own artifact. `pq-message`
  and `sym-message` authenticity come from the inner AEAD tag. Public-key
  artifacts (OCI2/OCP2/OCS2) have no AEAD, so their authenticity rests on the
  out-of-band fingerprint comparison at import. Accidental corruption that
  still decodes as canonical CBOR of the declared type is not detected during
  assembly
- Scan state is released on explicit discard, completion, error, or timeout.
  The timeout defaults to 10 minutes with a configurable floor of 5 minutes.
  A 127-frame maximum signed message has 254 seconds of configured dwell at
  the user-selected compatible preference; the derived floor conservatively
  budgets all 128 protocol frames at 2,000ms (256 seconds) before rounding up
  to whole minutes. Render latency makes the real cycle longer than those
  dwell-only figures and is measured separately

For boot compatibility, the append-only read ranges accept every safe integer
from 100 through 1,000B for density and from 150 through 3,000ms for interval.
This retains every historical density integer from 100 through 900 and every
historical interval integer from 150 through 2,000 together with 2,500 and
3,000. The internal density set is 100, 200, …, 1,000B; the internal interval
set is 200, 300, …, 1,000ms plus 2,000ms. On preference read, the exact
1,000B/200ms and 100B/2,000ms pairs are preserved; every other boot-readable
historical combination, including a missing member, is canonicalized to the
default 1,000B/200ms pair before strict validation. The append-only ranges and
the per-field historical normalization paths remain intact, so no previously
readable display preference can become a boot read failure and force
`wipeOnOnline`. Current preference patches must write one exact pair
atomically. Per-artifact effective clamps are never persisted, and invalid
patch/environment values are rejected without read-time normalization.
Wire/state `frameIndex` and `missingIndexes` remain zero-based; user-facing
frame positions are displayed one-based.

## 7. Vault (seed storage)

- Only **seeds** are stored (KEM 64B / DSA 32B). Expanded secret keys are
  never persisted
- Vault key = non-extractable AES-256-GCM `CryptoKey` (appMetadata
  `vault-key`. Creation uses a cross-tab lock + existence check → add;
  overwriting is forbidden)
- `EncryptedSecret = { iv(12B), ciphertext }`, AAD = canonical CBOR
  (`buildVaultAadV2`):

```typescript
{ version: 2, type: "qr-crypt-vault-aad", identityId, role("ml-kem-seed"|"ml-dsa-seed"),
  algorithm, keyId, publicKeySha256(32B) }
```

- After decrypting a seed, regenerate the public key via keygen and use it
  for sign/decaps **only after it matches the stored public key exactly**
  (fail-closed against record substitution)

### 7.1 Public key artifacts and fingerprints

The `OCI2` map takes the following shape; only `name` may be omitted.
KEM/DSA accept only the active same-profile pair of §4, and public key lengths
must match that table exactly.

```typescript
PublicIdentityBundleV2 = {
  version: 2
  type: "pq-public-identity"
  identityId: string
  name?: string
  kem: { algorithm: "ML-KEM-1024", keyId: string, publicKey: bytes }
  signing: { algorithm: "ML-DSA-87", keyId: string, publicKey: bytes }
  createdAt: uint
}
```

`OCP2` / `OCS2` are single-key maps whose `type` is `pq-kem-public-key` /
`pq-dsa-public-key` respectively, with the common keys
`version, type, identityId, name?, algorithm, keyId, publicKey, createdAt`.
`identityId` and each `keyId` are 22 base64url characters, `name` (when
present) is 1–100 UTF-16 units, and `createdAt` is a non-negative safe
integer.

Individual key fingerprints and the identity fingerprint are the SHA-256 of
the following byte strings:

```
kem      = UTF8("QR-CRYPT-FP-KEM-V2") || 0x00 || UTF8(algorithm) || 0x00 || publicKey
signing  = UTF8("QR-CRYPT-FP-DSA-V2") || 0x00 || UTF8(algorithm) || 0x00 || publicKey
identity = UTF8("QR-CRYPT-FP-ID-V2") || 0x00
           || canonicalCbor({ version, type, identityId, kem, signing, createdAt })
```

The identity fingerprint excludes the unauthenticated, mutable `name`,
while including `identityId` and `createdAt`.

## 8. Golden fixtures (frozen hex)

### 8.1 Symmetric (`tests/pq/sym-envelope.golden.test.ts`)

Shared fixture: `KEY_ID = "AAECAwQFBgcICQoLDA0ODw"`
(raw bytes `000102030405060708090a0b0c0d0e0f`),
`createdAt = 1700000000000` (uint64 `1b0000018bcfe56800`),
`hkdfSalt = 0x11×32`, `iv = 0x22×12`, `ciphertext = 0x33×20`.

- sym-message envelope (192B):
  `a86269764c22222222222222222222222264747970656b73796d2d6d657373616765656b657949647641414543417751464267634943516f4c4441304f447765737569746573484b44462d5348413235362b4132353647434d6776657273696f6e0268686b646653616c7458201111111111111111111111111111111111111111111111111111111111111111696372656174656441741b0000018bcfe568006a63697068657274657874543333333333333333333333333333333333333333`
- SymAadV2 (101B):
  `a564747970656b73796d2d6d657373616765656b657949647641414543417751464267634943516f4c4441304f447765737569746573484b44462d5348413235362b4132353647434d6776657273696f6e02696372656174656441741b0000018bcfe56800`
- HKDF info (`hkdfInfoSymV2`, 61B):
  `51522d43525950542d53594d2d4d4553534147452d563200484b44462d5348413235362b4132353647434d00000102030405060708090a0b0c0d0e0f02`
- Overhead pin: `SYM_MESSAGE_OVERHEAD_BYTES = 174`,
  `MAX_SYM_PLAINTEXT_BYTES = 810`

### 8.2 Post-quantum (`tests/pq/canonical-cbor.golden.test.ts`,
`tests/pq/wire-bytes.golden.test.ts`, `tests/pq/composition-golden.test.ts`)

Shared fixture key id as in §8.1. Active suite only.

- HKDF info (signed maximum):
  `51522d43525950542d4d4553534147452d5632004d4c2d4b454d2d313032342b4d4c2d4453412d38372b484b44462d5348413235362b4132353647434d00000102030405060708090a0b0c0d0e0f02`
- ML-DSA context: `51522d43525950542d4d4553534147452d5632`
- maximum signed end-to-end composition (fixed seed/randomness):
  - KEM ciphertext SHA-256:
    `7e7cc499f2d0f3bb0bb7aa61a3705c83bfc5cf2446b6bc81a1aa4badd2ea25ae`
  - Canonical CBOR envelope SHA-256:
    `a921a13f77a1312a39730dafb51b26eb6c828da3cfa9c1cc79bf42c0c665ef7b`
  - ML-DSA-87 signature SHA-256:
    `73d9d5c706e2190bdccc2cdb2b1fd6c5139a02ce520552556ee5f043c4a27784`
- Signing target (createdAt=1700000000000 → **uint64 `1b0000018bcfe56800`**;
  float64 `fb…` is invalid): full hex in the tests
- Vault AAD and fingerprint fixtures: full hex in the tests (active
  algorithms `ML-KEM-1024` / `ML-DSA-87` only)

## 9. Error mapping table (v2)

| Situation | Code |
|---|---|
| Non-canonical / malformed v2 structure | `INVALID_QR_PAYLOAD` |
| Signature verification failure (body withheld) | `SIGNATURE_INVALID` |
| Sender signing key not imported (import flow offered) | `SIGNING_KEY_NOT_FOUND` |
| Frame from another transferId mixed in / frame inconsistency | `FRAME_MISMATCH` |
| Generation capacity exceeded (artifact >128,000B, frameCount>128, even-chunk >1,000B, OCF2 payload >1,663 characters, or sym single-frame violation) | `QR_TOO_LARGE` |
| OCB2 (reserved) / removed vocabulary (v1 prefixes, unsigned suites, 768/65, `balanced`) | `UNSUPPORTED_ALGORITHM` or `INVALID_QR_PREFIX` / `INVALID_QR_PAYLOAD` |
| Worker unavailable (fallback to the main thread is forbidden) | `WORKER_UNAVAILABLE` |
| Partial failure of local reset | `RESET_FAILED` |

## 10. Online optical relay transport (validated OCF2 message frames)

This section describes the **transport contract** for the clean-origin online
relay. The accepted set is canonical `OCF2:` frames whose outer header declares
`artifactType ∈ {"pq-message", "sym-message"}`. One transfer carries one kind,
never both. Bare `OCA2:` / `OCM2:` / `OCK2:` / `OCP2:` / `OCS2:` / `OCI2:` lines
and every other OCF2 outer type (including `symmetric-key` and public-key
artifacts) are rejected. Retired v1 prefixes (`OCM1` / `OCK1` / `OCP1` / …)
are prefix-rejected.

The relay is an untrusted hop: it performs **no** AEAD, signature verification,
or decryption. After a capture or playback set completes (all frames present,
byte length matches), it **does** assemble the chunks in index order and run
strict assembled-artifact validation before enabling copy or playback:

- `pq-message` → `validateMlKemEnvelopeV2(decodeMlKemEnvelopeV2(bytes))`
- `sym-message` → `validateSymMessageEnvelopeV2(decodeSymMessageEnvelopeV2(bytes))`

A validation failure surfaces as `relay.error.invalidFrame` and does not enable
output. That check defeats key-material relabeling (an OCK2 / OCI2 / … body
stuffed into message-typed frames) and non-canonical stuffing. It does **not**
defeat a compromised sender who hides data inside otherwise valid ciphertext,
salt, IV, or padding fields of a schema-valid message — that residual is T21.

- Every displayed frame string is
  `OCF2:<unpadded-base64url(canonical CBOR frame)>`: after the 5-character
  `OCF2:` prefix the body is pure ASCII over `[A-Za-z0-9_-]` with no
  whitespace, CR, or LF. Therefore `frames.join("\n")` followed by
  `split("\n")` round-trips character-for-character.
- On paste, the receiver strips a single trailing `\r` per line (an
  intermediary may have converted LF to CRLF) and drops empty lines so a
  trailing newline cannot invent a bogus frame.
- Frames carry no artifact digest (§6). A relay can drop, reorder, replay, or
  substitute an entire well-formed frame set.
- OCF2 relay playback keeps its deliberately named 1,000ms interval and has
  no compatibility switch because it re-displays frames generated by another
  sender and cannot re-split their density. Allowlist and hop boundary:
  [threat-model.md](../security/threat-model.md) T19.
