// v2 byte conventions; see docs/spec/qr-protocol-v2.md §4, §7, and §8.
// The byte strings for HKDF info, the ML-DSA context, Vault AAD, and PQ fingerprints
// must match the hexadecimal golden fixtures in docs/spec/qr-protocol-v2.md.
import type {
  MlDsaAlgorithm,
  MlKemAlgorithm,
  PublicIdentityBundleV2,
  VaultSecretRole,
  WireSuite,
} from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import {
  encodeCanonicalCbor,
  type CanonicalCborValue,
} from "@/crypto/pq/canonical-cbor"
import { fromBase64Url } from "@/lib/base64url"
import { concatBytes, sha256Hex, utf8ToBytes } from "@/lib/bytes"
import { KEY_ID_PATTERN, KEY_ID_RAW_BYTES } from "@/lib/limits"

// Domain-separation labels are part of the wire protocol.
export const PQ_MESSAGE_DOMAIN_V2 = "QR-CRYPT-MESSAGE-V2"

// ML-DSA signing context (fixed; FIPS 204 context, at most 255B).
export function mlDsaContextV2(): Uint8Array {
  return utf8ToBytes(PQ_MESSAGE_DOMAIN_V2)
}

// keyId (22 base64url characters) → raw 16 bytes before decoding.
export function keyIdRawBytes(keyId: string): Uint8Array {
  if (!KEY_ID_PATTERN.test(keyId)) throw new AppError("INVALID_QR_PAYLOAD")
  let raw: Uint8Array
  try {
    raw = fromBase64Url(keyId)
  } catch {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (raw.byteLength !== KEY_ID_RAW_BYTES) throw new AppError("INVALID_QR_PAYLOAD")
  return raw
}

// HKDF info (frozen wire contract):
//   info = UTF8("QR-CRYPT-MESSAGE-V2") || 0x00 || UTF8(wireSuite) || 0x00
//          || kemKeyIdRaw(16 bytes) || 0x02
// The trailing 0x02 is the protocol version. Salt is 32 CSPRNG bytes per encryption
// (HKDF_SALT_BYTES).
export function hkdfInfoV2(suite: WireSuite, recipientKemKeyId: string): Uint8Array {
  return concatBytes(
    utf8ToBytes(PQ_MESSAGE_DOMAIN_V2),
    Uint8Array.of(0x00),
    utf8ToBytes(suite),
    Uint8Array.of(0x00),
    keyIdRawBytes(recipientKemKeyId),
    Uint8Array.of(0x02),
  )
}

// ---------------------------------------------------------------------------
// Vault AAD: versioned deterministic CBOR.
// After decrypting a seed, regenerate the public key with keygen, require an exact match
// with the stored public key, and only then proceed to sign/decaps (fail closed on record
// substitution).
// ---------------------------------------------------------------------------

export interface VaultAadFieldsV2 {
  identityId: string
  role: VaultSecretRole
  algorithm: MlKemAlgorithm | MlDsaAlgorithm
  keyId: string
  publicKeySha256: Uint8Array // SHA-256 of the plaintext public key (32B)
}

export function buildVaultAadV2(fields: VaultAadFieldsV2): Uint8Array {
  if (!KEY_ID_PATTERN.test(fields.identityId) || !KEY_ID_PATTERN.test(fields.keyId)) {
    throw new AppError("ENCRYPTION_FAILED")
  }
  if (fields.publicKeySha256.byteLength !== 32) {
    throw new AppError("ENCRYPTION_FAILED")
  }
  const roleMatchesAlgorithm =
    (fields.role === "ml-kem-seed" &&
      (fields.algorithm === "ML-KEM-768" || fields.algorithm === "ML-KEM-1024")) ||
    (fields.role === "ml-dsa-seed" &&
      (fields.algorithm === "ML-DSA-65" || fields.algorithm === "ML-DSA-87"))
  if (!roleMatchesAlgorithm) throw new AppError("ENCRYPTION_FAILED")
  const value: CanonicalCborValue = {
    version: 2,
    type: "qr-crypt-vault-aad",
    identityId: fields.identityId,
    role: fields.role,
    algorithm: fields.algorithm,
    keyId: fields.keyId,
    publicKeySha256: fields.publicKeySha256,
  }
  return encodeCanonicalCbor(value)
}

// ---------------------------------------------------------------------------
// PQ fingerprints:
//   individual key = SHA-256(UTF8(domain) || 0x00 || UTF8(algorithm) || 0x00 || publicKey)
//   identity = SHA-256(UTF8("QR-CRYPT-FP-ID-V2") || 0x00
//              || canonicalCbor(tuple from bundle excluding name))
// The display format reuses the existing formatFingerprint in features/presentation.
// ---------------------------------------------------------------------------

export const PQ_FINGERPRINT_DOMAINS = {
  kem: "QR-CRYPT-FP-KEM-V2",
  signing: "QR-CRYPT-FP-DSA-V2",
  identity: "QR-CRYPT-FP-ID-V2",
} as const

export async function pqKeyFingerprint(
  kind: "kem" | "signing",
  algorithm: MlKemAlgorithm | MlDsaAlgorithm,
  publicKey: Uint8Array,
): Promise<string> {
  return sha256Hex(
    concatBytes(
      utf8ToBytes(PQ_FINGERPRINT_DOMAINS[kind]),
      Uint8Array.of(0x00),
      utf8ToBytes(algorithm),
      Uint8Array.of(0x00),
      publicKey,
    ),
  )
}

// Fingerprint over the public tuple excluding name, which is variable and unauthenticated.
// Includes createdAt and identityId so another channel can compare this entire bundle.
export async function pqIdentityFingerprint(
  bundle: PublicIdentityBundleV2,
): Promise<string> {
  const tuple: CanonicalCborValue = {
    version: 2,
    type: bundle.type,
    identityId: bundle.identityId,
    kem: {
      algorithm: bundle.kem.algorithm,
      keyId: bundle.kem.keyId,
      publicKey: bundle.kem.publicKey,
    },
    signing: {
      algorithm: bundle.signing.algorithm,
      keyId: bundle.signing.keyId,
      publicKey: bundle.signing.publicKey,
    },
    createdAt: bundle.createdAt,
  }
  return sha256Hex(
    concatBytes(
      utf8ToBytes(PQ_FINGERPRINT_DOMAINS.identity),
      Uint8Array.of(0x00),
      encodeCanonicalCbor(tuple),
    ),
  )
}
