# QR Crypt QR Protocol Specification v1

This document is the authoritative specification of the v1 payloads exchanged via QR codes. The implementation (`src/qr/payload.ts`, `src/crypto/*`) and the unit tests follow this document.

> **Status (v2):** the AES-256-GCM message payload (`OCM1` with `alg: "A256GCM"`) remains produced and accepted. Schema validation rejects non-`A256GCM` `OCM1` messages. See [qr-protocol-v2.md](qr-protocol-v2.md).

## 1. Payload String

```
<PREFIX><base64url(CBOR(envelope))>
```

- Character set: a 5-character ASCII prefix + base64url (`A-Z a-z 0-9 - _`, **no padding**). Because the payload is ASCII-only, the QR code is encoded in byte mode and the character count equals the byte count.
- Maximum length: 8192 characters (input limit before parsing; actual QR capacity is smaller and is validated separately at generation time).

| Prefix | Kind | Envelope type |
|---|---|---|
| `OCM1:` | Ciphertext message | `AesMessageEnvelopeV1` |
| `OCK1:` | Symmetric key | `SymmetricKeyEnvelopeV1` |
| `OCP1:` | Public key | `PublicKeyEnvelopeV1` |
| `OCB1:` | Encrypted private-key backup | **Reserved only in v1; neither generated nor accepted** (on receipt it is rejected with `INVALID_QR_PAYLOAD` as an unsupported type, not with `UNSUPPORTED_ALGORITHM`) |

## 2. CBOR Encoding

- Library: cbor-x. `new Encoder({ useRecords: false, tagUint8Array: false })` / the matching Decoder.
- Envelopes are CBOR maps with text-string keys. Binary values are CBOR byte strings (untagged) → decoded as Uint8Array.
- Determinism: this protocol assigns no meaning to field order (the AAD does not depend on the CBOR representation of the envelope; see §4).

## 3. Envelope Definitions

### 3.1 `AesMessageEnvelopeV1` (OCM1)

| Key | Type | Constraint |
|---|---|---|
| `v` | int | fixed to `1` |
| `type` | text | fixed to `"message"` |
| `algorithm` | text | `"A256GCM"` |
| `keyId` | text | `^[A-Za-z0-9_-]{22}$` (base64url of 16 random bytes) |
| `createdAt` | int | Unix ms; `0 < x < 2^53` |
| `iv` | bytes | **fixed 12 bytes** |
| `ciphertext` | bytes | plaintext + a 16-byte GCM tag. The plaintext ceiling is derived per selected EC level by `maximumSymmetricPlaintextBytesForPayloadCapacity` in `src/lib/limits.ts` — 2010 (L), 1543 (M), 1042 (Q), 750 (H) — not `VITE_MAX_PLAINTEXT_BYTES`, which bounds the post-quantum multipart path. |
| `aad` | bytes | ≤128 bytes; must byte-for-byte match the value recomputed per §4 |

### 3.2 `SymmetricKeyEnvelopeV1` (OCK1)

`v:1, type:"symmetric-key", algorithm:"A256GCM", keyId, createdAt, key: bytes` — `key` is **fixed 32 bytes** (raw AES-256).

### 3.3 `PublicKeyEnvelopeV1` (OCP1) — retired, acceptance-only

RSA key creation and RSA decryption are removed from the application; this
envelope is retained solely as readable v1 wire vocabulary. See the status note
in [docs/security/threat-model.md](../security/threat-model.md) §4.

`v:1, type:"public-key", algorithm:"RSA-OAEP-3072", keyId, createdAt, spki: bytes` — `spki` is a SubjectPublicKeyInfo (DER). Validated by a 350–1200 byte range check, with a successful `importKey` as the final confirmation.

## 4. AAD (Additional Authenticated Data)

```
AAD = UTF-8( "OCAAD1|" + v + "|" + type + "|" + algorithm + "|" + keyId + "|" + createdAt )
```

- On encryption: this value is stored in `envelope.aad` and used as the AES-GCM `additionalData`.
- On decryption: the AAD is **recomputed** from the envelope's plaintext fields; if it does not byte-match `envelope.aad`, decryption is not attempted and the operation fails (DECRYPTION_FAILED). Only on a match is it passed as `additionalData` for decryption. As a result, tampering with the version, type, algorithm, key ID, or creation time is also detected by GCM tag verification.

## 5. Cryptographic Operations

- **AES-256-GCM**: 256-bit key, extractable (required to generate symmetric-key QR codes). A fresh IV per encryption via `crypto.getRandomValues(new Uint8Array(12))`. IV reuse under the same key is forbidden (the implementation is covered by tests verifying IV uniqueness across repeated encryptions). Tag length 128 bits (the WebCrypto default).
- Recipient key pair (retired): the v1 design generated an RSA-OAEP-3072 pair — public key `['encrypt','wrapKey']`, extractable; private key `['decrypt','unwrapKey']`, non-extractable. No code path creates or uses such a pair now; only the stored-record and `OCP1` shapes above still validate.

## 6. Validation Order and Error Mapping

| # | Check | Error on failure |
|---|---|---|
| 1 | Prefix is one of the four defined values | `INVALID_QR_PREFIX` |
| 2 | OCB1 | `INVALID_QR_PAYLOAD` (unsupported type) |
| 3 | base64url character set; length ≤8192 | `INVALID_QR_PAYLOAD` |
| 4 | CBOR decodes successfully and is a map | `INVALID_QR_PAYLOAD` |
| 5 | `v === 1` | `UNSUPPORTED_PROTOCOL_VERSION` |
| 6 | `type` is consistent with the prefix | `INVALID_QR_PAYLOAD` |
| 7 | `algorithm` is a known value for that type | `UNSUPPORTED_ALGORITHM` |
| 8 | Zod strict validation (unknown keys rejected; types, byte lengths, ranges) | `INVALID_QR_PAYLOAD` |

All decryption-time failures (AAD mismatch, tag mismatch, wrong key) are normalized into the single message "Decryption failed. The key, cryptographic algorithm, or ciphertext does not match." (Japanese locale: 「復号できませんでした。鍵、暗号方式、または暗号文が一致していません。」); partial plaintext and internal exception details are never shown.

## 7. QR Generation Parameters

| Kind | EC | quiet zone | Size |
|---|---|---|---|
| Ciphertext (OCM1) | Q (default; configurable in settings) | 4 | 512px |
| Relay playback (OCM1) | **Q, else M, else L** (never H; the relay cannot read the sender's preference) | 4 | 512px |
| Symmetric key (OCK1) | **H, fixed** | 4 | 512px |
| Frames (OCF2: ciphertext, public key, identity) | **Q, fixed** | 4 | 512px |

Capacity (QR v40, byte mode): L=2953 / M=2331 / Q=1663 / H=1273 bytes. Oversize payloads fail with `QR_TOO_LARGE` (caught both by a pre-generation check and by trapping the generation exception). The expected size is shown to the user in advance via `estimatePayloadChars(plaintextBytes, alg)` (tests guarantee it stays within ±10% of measured values).

## 8. Key IDs, Fingerprints, and File Names

- Key ID / artifact ID: 16 random bytes → 22 base64url characters. The short display form is the first 8 characters.
- Fingerprint: SHA-256 of the key's canonical binary form (AES = raw 32 B, public key = SPKI DER). Internal identification uses the full 64-character hex digest. The display form takes the first 8 bytes, 2 bytes at a time as big-endian uint16 % 10000 → four zero-padded 4-digit groups (e.g. `7392 1840 5521 9074`).
- Output file names: `<sanitized-name>-<shortId>.<png|svg|txt>`. Sanitization removes control characters and `/\:*?"<>|`, then trims; if the result is empty, `qr` is used. File names never contain secrets, plaintext, or key material.

## 9. Compatibility Policy

- Unknown `v` values are rejected as future versions (`UNSUPPORTED_PROTOCOL_VERSION`, surfaced to the user as "This QR code was created by a newer version of the app. Update the app." — Japanese locale: 「新しいバージョンのアプリで作成されたQRコードです。アプリを更新してください。」).
- The v1 implementation does not accept unknown keys (strict). Adding a field requires bumping `v`.
- Format stability is guaranteed by golden fixture tests (exact match of known payload strings generated from fixed keys and fixed IVs, plus a decryption round trip).
