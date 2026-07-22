// v2 バイト規約(plan2.1 §C5/§C8/§E5 — WP-A2 が実装・凍結)。
// HKDF info・ML-DSA コンテキスト・Vault AAD・PQ 指紋の各バイト列は
// docs/qr-protocol-v2.md の hex ゴールデンフィクスチャと一致すること。
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

// ドメイン分離ラベル(spec2 §5/§6)
export const PQ_MESSAGE_DOMAIN_V2 = "QRYPT-MESSAGE-V2"

// ML-DSA 署名コンテキスト(固定。FIPS 204 の context、最大 255B)
export function mlDsaContextV2(): Uint8Array {
  return utf8ToBytes(PQ_MESSAGE_DOMAIN_V2)
}

// keyId(base64url 22 文字)→ デコード前の生 16 バイト
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

// HKDF info(plan2.1 §C5 で凍結):
//   info = UTF8("QRYPT-MESSAGE-V2") || 0x00 || UTF8(wireSuite) || 0x00
//          || kemKeyIdRaw(16 bytes) || 0x02
// 末尾 0x02 はプロトコル版。salt は暗号化ごとの CSPRNG 32B(HKDF_SALT_BYTES)。
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
// Vault AAD(plan2.1 §C8): versioned 決定的 CBOR。
// シード復号後は keygen で公開鍵を再生成し、保存公開鍵と完全一致してから
// sign/decaps へ進む(レコード差替えの fail-closed)。
// ---------------------------------------------------------------------------

export interface VaultAadFieldsV2 {
  identityId: string
  role: VaultSecretRole
  algorithm: MlKemAlgorithm | MlDsaAlgorithm
  keyId: string
  publicKeySha256: Uint8Array // 平文公開鍵への SHA-256(32B)
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
    type: "qrypt-vault-aad",
    identityId: fields.identityId,
    role: fields.role,
    algorithm: fields.algorithm,
    keyId: fields.keyId,
    publicKeySha256: fields.publicKeySha256,
  }
  return encodeCanonicalCbor(value)
}

// ---------------------------------------------------------------------------
// PQ 指紋(plan2.1 §E5):
//   個別鍵   = SHA-256(UTF8(domain) || 0x00 || UTF8(algorithm) || 0x00 || publicKey)
//   identity = SHA-256(UTF8("QRYPT-FP-ID-V2") || 0x00
//              || canonicalCbor(bundle から name を除いたタプル))
// 表示形式は既存 formatFingerprint(features/presentation)を共用する。
// ---------------------------------------------------------------------------

export const PQ_FINGERPRINT_DOMAINS = {
  kem: "QRYPT-FP-KEM-V2",
  signing: "QRYPT-FP-DSA-V2",
  identity: "QRYPT-FP-ID-V2",
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

// name(可変・未認証)を除いた公開タプルへの指紋。
// createdAt / identityId を含む = 「この bundle 全体」の別経路比較用。
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
