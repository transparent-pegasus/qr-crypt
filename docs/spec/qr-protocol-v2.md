# QR Crypt QR Protocol Specification v2 (Post-Quantum)

This document is the normative specification of the v2 (ML-KEM / ML-DSA)
wire format. The implementation (`src/crypto/pq/*`, `src/qr/payload-v2.ts`,
`src/qr/multipart/*`) and the golden fixtures in `tests/pq/*` follow this
document. The v1 format remains specified in `docs/spec/qr-protocol.md`
(reusing v1 prefixes for ML purposes is forbidden). This document is the
authoritative committed specification of this contract.

## 1. Prefix table

| Prefix | artifactType / kind | Contents |
|---|---|---|
| `OCM2:` | `pq-message` | ML-KEM message envelope |
| `OCP2:` | `pq-kem-public-key` | ML-KEM public key (single key) |
| `OCS2:` | `pq-dsa-public-key` | ML-DSA signature-verification public key (single key) |
| `OCI2:` | `pq-public-identity` | Public key set (KEM+DSA) |
| `OCB2:` | `encrypted-seed-backup` | Reserved (neither produced nor accepted) |
| `OCF2:` | frame | Multi-frame QR |

- `OCM2/OCP2/OCS2/OCI2` are "single-payload representations (paste / file
  import) and logical types". **QR display always goes through `OCF2`
  (frameCount≥1)**.
- Import supports both (a) `OCF2` assembly → inner artifact, and
  (b) a bare `OC?2` single paste.
- `OCB2` is rejected as `UNSUPPORTED_ALGORITHM` at classification time,
  because `VITE_ENABLE_ENCRYPTED_SEED_BACKUP=false` is fixed.
- Managed deviation: `pq-kem-public-key` / `pq-dsa-public-key` were added to
  the three artifactType values of the original draft specification
  (single keys are also always carried via framing; see
  [../develop/deviations.md](../develop/deviations.md)).

## 2. Canonical CBOR profile (shared by all v2 structures)

A subset of RFC 8949 §4.2.1 core deterministic encoding. Implemented in
`src/crypto/pq/canonical-cbor.ts` (an in-house codec; cbor-x is not used, so
the wire contract is decoupled from version-dependent behavior of external
libraries).

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
  retained heap: at most 9 entries in one map, 13 map entries across the
  decoded value, 19 UTF-8 bytes per map key, and 300 UTF-8 bytes per text
  value. Length/count headers are rejected before their loops or strings are
  materialized
- Decoded maps have null prototypes. Encoded attacker-supplied keys are not
  retained in a process-lifetime cache; canonical re-encoding computes them
  for the current operation only

## 3. Envelope (OCM2)

```typescript
MlKemMessageEnvelopeV2 = {
  version: 2
  type: "pq-message"
  suite: WireSuite            // the 4 literals of §4
  recipientKemKeyId: string   // base64url, 22 characters (16 raw bytes)
  kemCiphertext: bytes        // 768: 1088B / 1024: 1568B (length validated per suite)
  hkdfSalt: bytes(32)         // fresh CSPRNG per encryption
  iv: bytes(12)               // CSPRNG
  ciphertext: bytes(≥16)      // AES-256-GCM (128-bit tag at the end)
}
```

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

## 4. Suites and key derivation

`WireSuite`:

```
ML-KEM-768+HKDF-SHA256+A256GCM
ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM
ML-KEM-1024+HKDF-SHA256+A256GCM
ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM
```

Fixed sizes in `src/crypto/pq/profiles.ts` (all in bytes):

| profile | KEM | public key | expanded secret key | ciphertext | shared secret | seed |
|---|---|---:|---:|---:|---:|---:|
| balanced | ML-KEM-768 | 1184 | 2400 | 1088 | 32 | 64 |
| maximum | ML-KEM-1024 | 1568 | 3168 | 1568 | 32 | 64 |

| profile | DSA | public key | expanded secret key | signature | seed |
|---|---|---:|---:|---:|---:|
| balanced | ML-DSA-65 | 1952 | 4032 | 3309 | 32 |
| maximum | ML-DSA-87 | 2592 | 4896 | 4627 | 32 |

The expanded secret key is a value expanded from the seed at runtime; it is
never stored on the wire or in persistent storage (§7).

- The 4 suites above are **maintained as the wire/codec contract**.
  `WireSuite`, `resolveSuite`, and `suiteComponents` recognize both 768/65
  and 1024/87 and can round-trip valid same-profile pairs.
- The suite is **derived uniquely from the actual algorithm pair of the
  selected keys** (`resolveSuite`). Signed suites allow only the
  same-profile pairs (768,65) / (1024,87). Mixed pairs are
  `UNSUPPORTED_ALGORITHM`.
- The **active policy (2026-07-24)** operates only the 2 maximum (1024/87)
  suites (unsigned and signed). The balanced profile and the 2 768-family
  suites are "recognized but unsupported": they are not treated as
  structurally invalid, but are rejected as `UNSUPPORTED_ALGORITHM` before
  any cryptographic processing at operational boundaries — import, key
  generation, rotation, encryption, decryption, Worker RPC, QR re-export,
  and so on.

HKDF-SHA-256 (`hkdfInfoV2`, frozen as part of this contract):

```
info = UTF8("QR-CRYPT-MESSAGE-V2") || 0x00 || UTF8(wireSuite) || 0x00
       || kemKeyIdRaw(16 bytes) || 0x02
salt = fresh CSPRNG 32B per encryption / derived key = AES-256-GCM (non-extractable)
```

`kemKeyIdRaw` is the **raw 16 bytes underlying** the keyId (22 base64url
characters), i.e. before encoding.

Decryption success conditions (fixed order): KEM input length validation →
Decaps (merely returning a value is not success) → HKDF → **AES-GCM
authentication success** → inner schema validation → (for signed suites)
ML-DSA verification. Failure is `DECRYPTION_FAILED` (signature-only failure
is `SIGNATURE_INVALID` with the body withheld; an unregistered signing key
yields the `signed-key-unknown` state and the body is not constructed).

## 5. Inner message (Sign-then-Encrypt)

The wire shape is **governed by the outer suite** (the in-memory
discriminator `kind` is not carried):

- Unsigned suite → the bare `UnsignedMessageBodyV2` map
  (keys: `version, messageId(16B), createdAt, recipientKemKeyId, plaintext`.
  `senderSigningKeyId` is **omitted per key**)
- Signed suite → `{ body: SignedMessageBodyV2, signature: { algorithm, value } }`
  (`senderSigningKeyId` is required in the body; the length of
  signature.value is 65: 3309B / 87: 4627B)

Mismatches are rejected: signature/senderSigningKeyId on an unsigned suite →
`DECRYPTION_FAILED` (equivalent to `INVALID_QR_PAYLOAD` in structural
validation); a signed suite with the signature missing or failing
verification → `SIGNATURE_INVALID`.

- **The signing target = the canonical CBOR of the bare
  `SignedMessageBodyV2` map** (`signingTargetBytes`)
- ML-DSA context = fixed `UTF8("QR-CRYPT-MESSAGE-V2")` (≤255B)
- `messageId` = fixed-length CSPRNG 16B. **It is not a replay-prevention
  mechanism** of the wire format. The receiving implementation keeps a
  session-memory receipt keyed by the authenticated message ID
  (`src/features/receipt-cache.ts`); that check is session-scoped and does not
  change the wire format. `createdAt` is the device-reported time (not trusted
  time)
- The unsigned and signed post-quantum paths accept at most 120,000 UTF-8
  plaintext bytes. This is not a shared application limit: the v1 A256GCM
  path remains one OCM1 QR and derives its smaller pre-encryption ceiling from
  the v1 8,192-character payload ceiling and the selected QR error-correction
  capacity

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
  lengths differ by at most one byte
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
  read its screen. The removed automatic selector also had a shipped
  always-compatible bug: its usability check required reader-module state to
  have reached `usable`, which happened only after camera preparation
  resolved, so the display path never observed the usable state
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
  authenticity comes from the inner AEAD tag. Public-key artifacts
  (OCI2/OCP2/OCS2) have no AEAD, so their authenticity rests on the
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
KEM/DSA accept only the same-profile pairs of §4, and public key lengths
must match that table exactly.

```typescript
PublicIdentityBundleV2 = {
  version: 2
  type: "pq-public-identity"
  identityId: string
  name?: string
  kem: { algorithm: MlKemAlgorithm, keyId: string, publicKey: bytes }
  signing: { algorithm: MlDsaAlgorithm, keyId: string, publicKey: bytes }
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

Must match `tests/pq/canonical-cbor.golden.test.ts` /
`tests/pq/wire-bytes.golden.test.ts` and
`tests/pq/composition-golden.test.ts`. Shared fixture:
`KEY_ID = "AAECAwQFBgcICQoLDA0ODw"`
(raw bytes `000102030405060708090a0b0c0d0e0f`).
The 768-family fixtures below freeze the compatibility of the wire/codec
contract; they do not imply availability under the active policy.

- HKDF info (unsigned 768):
  `51522d43525950542d4d4553534147452d5632004d4c2d4b454d2d3736382b484b44462d5348413235362b4132353647434d00000102030405060708090a0b0c0d0e0f02`
- HKDF info (signed 768):
  `51522d43525950542d4d4553534147452d5632004d4c2d4b454d2d3736382b4d4c2d4453412d36352b484b44462d5348413235362b4132353647434d00000102030405060708090a0b0c0d0e0f02`
- ML-DSA context: `51522d43525950542d4d4553534147452d5632`
- `MlKemAadV2` (suite=unsigned768, sha256=0x22×32):
  `a564747970656a70712d6d657373616765657375697465781e4d4c2d4b454d2d3736382b484b44462d5348413235362b4132353647434d6776657273696f6e0271726563697069656e744b656d4b657949647641414543417751464267634943516f4c4441304f4477736b656d4369706865727465787453686132353658202222222222222222222222222222222222222222222222222222222222222222`
- Vault AAD (kem-seed/768, pkSha=0x11×32): starts with `a764726f6c65…`
  (full hex in the tests)
- Signing target (createdAt=1700000000000 → **uint64 `1b0000018bcfe56800`**;
  float64 `fb…` is invalid): full hex in the tests
- Envelope (kemCt=0x33×1088, salt=0x44×32, iv=0x55×12, ct=0x66×20):
  1301B, SHA-256 `53b5af7642d5394156ef4eacfac829181a682e067d9c1fbc8297206117cea924`
- Bundle (name = the 3-character Japanese string "テスト", UTF-8 bytes
  `e38386e382b9e38388`; keys filled with 0x0a/0x0b): 3377B, SHA-256
  `db7231d753096cc2847e87767040772ca7daef5f726104549d75f1359429925c`
- Individual KEM key fingerprint (ML-KEM-768, public key 0x0a×1184):
  `874c5f32a6464e06a88104f81736753065aeb63c2a5398ddf0d9e93e5d16a6e3`
- Identity fingerprint of the bundle above (`name` excluded):
  `e37a66b4fce2ff58563d283cadc68e4f63da47255093221a4e6944614416e999`
- maximum signed end-to-end composition (fixed seed/randomness):
  - KEM ciphertext SHA-256:
    `7e7cc499f2d0f3bb0bb7aa61a3705c83bfc5cf2446b6bc81a1aa4badd2ea25ae`
  - Canonical CBOR envelope SHA-256:
    `a921a13f77a1312a39730dafb51b26eb6c828da3cfa9c1cc79bf42c0c665ef7b`
  - ML-DSA-87 signature SHA-256:
    `73d9d5c706e2190bdccc2cdb2b1fd6c5139a02ce520552556ee5f043c4a27784`

## 9. Error mapping table (v2 additions)

| Situation | Code |
|---|---|
| Non-canonical / malformed v2 structure | `INVALID_QR_PAYLOAD` |
| Signature verification failure (body withheld) | `SIGNATURE_INVALID` |
| Sender signing key not imported (import flow offered) | `SIGNING_KEY_NOT_FOUND` |
| Frame from another transferId mixed in / frame inconsistency | `FRAME_MISMATCH` |
| Generation capacity exceeded (artifact >128,000B, frameCount>128, balanced chunk >1,000B, or OCF2 payload >1,663 characters) | `QR_TOO_LARGE` |
| OCB2 (reserved) / balanced/768-family operation / legacy RSA format (OCM1-RSA) | `UNSUPPORTED_ALGORITHM` (deprecation wording) |
| Worker unavailable (fallback to the main thread is forbidden) | `WORKER_UNAVAILABLE` |
| Partial failure of local reset | `RESET_FAILED` |

Note: an earlier draft used the provisional name `WIPE_FAILED`; in line with
the honest-naming policy (no "wipe" / "secure erase" wording), it was
finalized as `RESET_FAILED`.

## 10. Online optical relay transport (verbatim OCF2 text)

This section describes the **transport contract** for the clean-origin online
relay. The relay is an untrusted hop: it forwards frame strings; it does not
assemble artifacts or check inner CBOR type, AEAD, or signatures. Authoritative
completion remains §6 (offline assembler).

- Every displayed frame string is
  `OCF2:<unpadded-base64url(canonical CBOR frame)>`: after the 5-character
  `OCF2:` prefix the body is pure ASCII over `[A-Za-z0-9_-]` with no
  whitespace, CR, or LF. Therefore `frames.join("\n")` followed by
  `split("\n")` round-trips character-for-character.
- On paste, the receiver strips a single trailing `\r` per line (an
  intermediary may have converted LF to CRLF) and drops empty lines so a
  trailing newline cannot invent a bogus frame.
- The relay accepts only frames whose **untrusted outer header declares**
  `artifactType === "pq-message"`. It performs no assembly and cannot detect
  a public-key or identity artifact that an attacker re-chunked and
  relabeled; the offline assembler rejects inner-type mismatches
  (`src/qr/multipart/assemble.ts`). Face-to-face key exchange is the
  supported workflow, not an enforcement guarantee of this hop.
- Frames carry no artifact digest (§6). A relay can drop, reorder, replay, or
  substitute an entire well-formed frame set.
- Relay playback uses its own deliberately named 1,000ms interval. It has no
  compatibility switch because it re-displays frames generated by another
  sender and cannot re-split their density.
