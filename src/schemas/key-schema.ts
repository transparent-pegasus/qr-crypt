// 鍵・QR アーティファクト関連の実行時検証。
// ドメイン型そのものは domain.ts が単一所有(ここは zod スキーマのみ)。
import { z } from "zod"
import { KEY_ID_PATTERN } from "@/lib/limits"
import type { StoredKeyRecord, StoredQrArtifact } from "@/schemas/domain"
import { sensitivityForKind } from "@/schemas/domain"

// 制御文字(C0 領域と DEL)を含むか。正規表現リテラルに制御文字を
// 埋め込まないため、コードポイント判定で実装する。
export function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

// QR 名(spec §14): trim 後 1〜80 文字、制御文字禁止。同名は許可(ID で区別)。
export const qrNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "名前を入力してください")
      .max(80, "名前は80文字以内にしてください")
      .refine((value) => !hasControlChars(value), {
        message: "使用できない文字が含まれています",
      }),
  )

// 鍵名も同一規則を適用する
export const keyNameSchema = qrNameSchema

export const keyIdSchema = z.string().regex(KEY_ID_PATTERN)

const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u)
const timestampSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

function isCryptoKey(value: unknown): value is CryptoKey {
  return (
    typeof CryptoKey !== "undefined" &&
    value instanceof CryptoKey &&
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "algorithm" in value &&
    "extractable" in value &&
    "usages" in value
  )
}

const storedKeyBaseSchema = z
  .object({
    id: keyIdSchema,
    name: keyNameSchema,
    kind: z.enum(["symmetric", "rsa-key-pair", "public-key"]),
    algorithm: z.string().min(1),
    fingerprint: fingerprintSchema,
    createdAt: timestampSchema,
    lastUsedAt: timestampSchema.optional(),
    useCount: z.number().int().nonnegative(),
    publicKey: z.custom<CryptoKey>(isCryptoKey).optional(),
    privateKey: z.custom<CryptoKey>(isCryptoKey).optional(),
    symmetricKey: z.custom<CryptoKey>(isCryptoKey).optional(),
  })
  .strict()

function hasExactUsages(key: CryptoKey, expected: readonly KeyUsage[]): boolean {
  return (
    key.usages.length === expected.length &&
    expected.every((usage) => key.usages.includes(usage))
  )
}

function isAesKey(key: CryptoKey): boolean {
  const algorithm = key.algorithm as AesKeyAlgorithm
  return (
    key.type === "secret" &&
    algorithm.name === "AES-GCM" &&
    algorithm.length === 256 &&
    key.extractable &&
    hasExactUsages(key, ["encrypt", "decrypt"])
  )
}

function isRsaKey(key: CryptoKey, type: "public" | "private"): boolean {
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm
  const exponent = algorithm.publicExponent
  const expectedUsages =
    type === "public"
      ? (["encrypt", "wrapKey"] as const)
      : (["decrypt", "unwrapKey"] as const)
  return (
    key.type === type &&
    algorithm.name === "RSA-OAEP" &&
    algorithm.modulusLength === 3072 &&
    exponent instanceof Uint8Array &&
    exponent.length === 3 &&
    exponent[0] === 1 &&
    exponent[1] === 0 &&
    exponent[2] === 1 &&
    algorithm.hash.name === "SHA-256" &&
    (type === "public" ? key.extractable : !key.extractable) &&
    hasExactUsages(key, expectedUsages)
  )
}

export function validateStoredKeyRecord(value: unknown): StoredKeyRecord {
  const record = storedKeyBaseSchema.parse(value)
  const valid = (() => {
    switch (record.kind) {
      case "symmetric":
        return (
          record.algorithm === "A256GCM" &&
          record.symmetricKey !== undefined &&
          isAesKey(record.symmetricKey) &&
          record.publicKey === undefined &&
          record.privateKey === undefined
        )
      case "rsa-key-pair":
        return (
          record.algorithm === "RSA-OAEP-3072" &&
          record.publicKey !== undefined &&
          isRsaKey(record.publicKey, "public") &&
          (record.privateKey === undefined || isRsaKey(record.privateKey, "private")) &&
          record.symmetricKey === undefined
        )
      case "public-key":
        return (
          record.algorithm === "RSA-OAEP-3072" &&
          record.publicKey !== undefined &&
          isRsaKey(record.publicKey, "public") &&
          record.privateKey === undefined &&
          record.symmetricKey === undefined
        )
    }
  })()
  if (!valid) throw new Error("invalid key record")
  return record as StoredKeyRecord
}

const storedQrArtifactSchema = z
  .object({
    id: keyIdSchema,
    name: qrNameSchema,
    kind: z.enum(["ciphertext", "symmetric-key", "public-key", "encrypted-private-key"]),
    sensitivity: z.enum(["public", "confidential", "secret"]),
    algorithm: z.string().min(1),
    payload: z.string().min(1),
    payloadSha256: fingerprintSchema,
    byteLength: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    keyId: keyIdSchema.optional(),
    lastViewedAt: timestampSchema.optional(),
  })
  .strict()

export function validateStoredQrArtifact(value: unknown): StoredQrArtifact {
  const artifact = storedQrArtifactSchema.parse(value)
  if (artifact.sensitivity !== sensitivityForKind(artifact.kind)) {
    throw new Error("invalid QR sensitivity")
  }
  return artifact as StoredQrArtifact
}
