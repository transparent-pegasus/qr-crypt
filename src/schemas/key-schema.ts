// 鍵・QR アーティファクト関連の実行時検証。
// ドメイン型そのものは domain.ts が単一所有(ここは zod スキーマのみ)。
import { z } from "zod"
import { DSA_SEED_BYTES, IV_BYTES, KEM_SEED_BYTES, KEY_ID_PATTERN } from "@/lib/limits"
import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
  QrArtifactKind,
  Sensitivity,
  StoredKeyRecord,
  StoredQrArtifact,
} from "@/schemas/domain"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import { decodePayload } from "@/qr/payload"

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
const pqTimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

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

// v1 read/migration boundary. This deliberately retains ciphertext so the v2
// versionchange transaction can classify and purge old rows before active reads.
export type LegacyStoredKeyRecordV1 = StoredKeyRecord
export interface LegacyStoredQrArtifactV1 {
  id: string
  name: string
  kind: QrArtifactKind | "ciphertext"
  sensitivity: Sensitivity
  algorithm: string
  payload: string
  payloadSha256: string
  byteLength: number
  createdAt: number
  keyId?: string
  lastViewedAt?: number
}

export const legacyStoredQrArtifactV1Schema = z
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

export function validateLegacyStoredKeyRecordV1(value: unknown): LegacyStoredKeyRecordV1 {
  return validateStoredKeyRecord(value)
}

export function validateLegacyStoredQrArtifactV1(
  value: unknown,
): LegacyStoredQrArtifactV1 {
  const artifact = legacyStoredQrArtifactV1Schema.parse(value)
  const expectedSensitivity =
    artifact.kind === "public-key"
      ? "public"
      : artifact.kind === "ciphertext"
        ? "confidential"
        : "secret"
  if (artifact.sensitivity !== expectedSensitivity) {
    throw new Error("invalid QR sensitivity")
  }
  return artifact as LegacyStoredQrArtifactV1
}

export type ActiveStoredQrArtifactKind = QrArtifactKind
export type ActiveStoredQrArtifact = StoredQrArtifact

const activeQrArtifactCommon = {
  id: keyIdSchema,
  name: qrNameSchema,
  algorithm: z.string().min(1),
  payload: z.string().min(1),
  payloadSha256: fingerprintSchema,
  byteLength: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  keyId: keyIdSchema.optional(),
  lastViewedAt: timestampSchema.optional(),
}

export const activeStoredQrArtifactSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...activeQrArtifactCommon,
      kind: z.literal("symmetric-key"),
      sensitivity: z.literal("secret"),
    })
    .strict(),
  z
    .object({
      ...activeQrArtifactCommon,
      kind: z.literal("public-key"),
      sensitivity: z.literal("public"),
    })
    .strict(),
  z
    .object({
      ...activeQrArtifactCommon,
      kind: z.literal("encrypted-private-key"),
      sensitivity: z.literal("secret"),
    })
    .strict(),
])

export function validateStoredQrArtifact(value: unknown): ActiveStoredQrArtifact {
  const artifact = activeStoredQrArtifactSchema.parse(value)
  const decoded = decodePayload(artifact.payload)
  const expectedKind =
    artifact.kind === "symmetric-key"
      ? "symmetric-key"
      : artifact.kind === "public-key"
        ? "public-key"
        : undefined
  if (
    expectedKind === undefined ||
    decoded.kind !== expectedKind ||
    decoded.envelope.algorithm !== artifact.algorithm ||
    (artifact.keyId !== undefined && decoded.envelope.keyId !== artifact.keyId)
  ) {
    throw new Error("QR kind and payload do not match")
  }
  return artifact as ActiveStoredQrArtifact
}

const bytes = (length: number) =>
  z.instanceof(Uint8Array).refine((value) => value.byteLength === length)

const kemEncryptedSeedSchema = z
  .object({
    iv: bytes(IV_BYTES),
    ciphertext: bytes(KEM_SEED_BYTES + 16),
  })
  .strict()

const signingEncryptedSeedSchema = z
  .object({
    iv: bytes(IV_BYTES),
    ciphertext: bytes(DSA_SEED_BYTES + 16),
  })
  .strict()

const kemMaterialSchema = z.discriminatedUnion("algorithm", [
  z
    .object({
      algorithm: z.literal("ML-KEM-768"),
      keyId: keyIdSchema,
      publicKey: bytes(KEM_SIZES["ML-KEM-768"].publicKeyBytes),
      encryptedSeed: kemEncryptedSeedSchema,
      fingerprint: fingerprintSchema,
    })
    .strict(),
  z
    .object({
      algorithm: z.literal("ML-KEM-1024"),
      keyId: keyIdSchema,
      publicKey: bytes(KEM_SIZES["ML-KEM-1024"].publicKeyBytes),
      encryptedSeed: kemEncryptedSeedSchema,
      fingerprint: fingerprintSchema,
    })
    .strict(),
])

const signingMaterialSchema = z.discriminatedUnion("algorithm", [
  z
    .object({
      algorithm: z.literal("ML-DSA-65"),
      keyId: keyIdSchema,
      publicKey: bytes(DSA_SIZES["ML-DSA-65"].publicKeyBytes),
      encryptedSeed: signingEncryptedSeedSchema,
      fingerprint: fingerprintSchema,
    })
    .strict(),
  z
    .object({
      algorithm: z.literal("ML-DSA-87"),
      keyId: keyIdSchema,
      publicKey: bytes(DSA_SIZES["ML-DSA-87"].publicKeyBytes),
      encryptedSeed: signingEncryptedSeedSchema,
      fingerprint: fingerprintSchema,
    })
    .strict(),
])

const postQuantumIdentitySchema = z
  .object({
    id: keyIdSchema,
    name: keyNameSchema,
    profile: z.enum(["balanced", "maximum"]),
    kem: kemMaterialSchema,
    signing: signingMaterialSchema,
    identityFingerprint: fingerprintSchema,
    status: z.enum(["active", "rotated", "revoked"]),
    rotatedFromId: keyIdSchema.optional(),
    rotatedAt: pqTimestampSchema.optional(),
    revokedAt: pqTimestampSchema.optional(),
    createdAt: pqTimestampSchema,
    lastUsedAt: pqTimestampSchema.optional(),
  })
  .strict()
  .superRefine((identity, context) => {
    const profileMatches =
      (identity.profile === "balanced" &&
        identity.kem.algorithm === "ML-KEM-768" &&
        identity.signing.algorithm === "ML-DSA-65") ||
      (identity.profile === "maximum" &&
        identity.kem.algorithm === "ML-KEM-1024" &&
        identity.signing.algorithm === "ML-DSA-87")
    if (!profileMatches) {
      context.addIssue({ code: "custom", path: ["profile"], message: "profile mismatch" })
    }
    if (new Set([identity.id, identity.kem.keyId, identity.signing.keyId]).size !== 3) {
      context.addIssue({ code: "custom", path: ["id"], message: "key IDs must differ" })
    }
    if (identity.rotatedFromId === identity.id) {
      context.addIssue({
        code: "custom",
        path: ["rotatedFromId"],
        message: "identity cannot rotate from itself",
      })
    }
    if (
      (identity.status === "active" &&
        (identity.rotatedAt !== undefined || identity.revokedAt !== undefined)) ||
      (identity.status === "rotated" &&
        (identity.rotatedAt === undefined || identity.revokedAt !== undefined)) ||
      (identity.status === "revoked" && identity.revokedAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "invalid status dates",
      })
    }
    for (const [path, date] of [
      ["rotatedAt", identity.rotatedAt],
      ["revokedAt", identity.revokedAt],
      ["lastUsedAt", identity.lastUsedAt],
    ] as const) {
      if (date !== undefined && date < identity.createdAt) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "date predates identity",
        })
      }
    }
  })

export function validatePostQuantumIdentity(value: unknown): PostQuantumIdentity {
  return postQuantumIdentitySchema.parse(value) as PostQuantumIdentity
}

const bundleKemSchema = z.discriminatedUnion("algorithm", [
  z
    .object({
      algorithm: z.literal("ML-KEM-768"),
      keyId: keyIdSchema,
      publicKey: bytes(KEM_SIZES["ML-KEM-768"].publicKeyBytes),
      fingerprint: fingerprintSchema,
    })
    .strict(),
  z
    .object({
      algorithm: z.literal("ML-KEM-1024"),
      keyId: keyIdSchema,
      publicKey: bytes(KEM_SIZES["ML-KEM-1024"].publicKeyBytes),
      fingerprint: fingerprintSchema,
    })
    .strict(),
])

const bundleSigningSchema = z.discriminatedUnion("algorithm", [
  z
    .object({
      algorithm: z.literal("ML-DSA-65"),
      keyId: keyIdSchema,
      publicKey: bytes(DSA_SIZES["ML-DSA-65"].publicKeyBytes),
      fingerprint: fingerprintSchema,
    })
    .strict(),
  z
    .object({
      algorithm: z.literal("ML-DSA-87"),
      keyId: keyIdSchema,
      publicKey: bytes(DSA_SIZES["ML-DSA-87"].publicKeyBytes),
      fingerprint: fingerprintSchema,
    })
    .strict(),
])

const pqPublicBundleRecordSchema = z
  .object({
    recordId: keyIdSchema,
    identityId: keyIdSchema,
    name: keyNameSchema.optional(),
    kem: bundleKemSchema,
    signing: bundleSigningSchema,
    identityFingerprint: fingerprintSchema,
    trust: z.enum(["unverified", "fingerprint-confirmed"]),
    trustConfirmedAt: pqTimestampSchema.optional(),
    revokedAt: pqTimestampSchema.optional(),
    bundleCreatedAt: pqTimestampSchema,
    importedAt: pqTimestampSchema,
    lastUsedAt: pqTimestampSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const algorithmsMatch =
      (record.kem.algorithm === "ML-KEM-768" &&
        record.signing.algorithm === "ML-DSA-65") ||
      (record.kem.algorithm === "ML-KEM-1024" && record.signing.algorithm === "ML-DSA-87")
    if (!algorithmsMatch) {
      context.addIssue({
        code: "custom",
        path: ["signing", "algorithm"],
        message: "profile mismatch",
      })
    }
    if (
      (record.trust === "unverified" && record.trustConfirmedAt !== undefined) ||
      (record.trust === "fingerprint-confirmed" && record.trustConfirmedAt === undefined)
    ) {
      context.addIssue({ code: "custom", path: ["trust"], message: "invalid trust date" })
    }
    for (const [path, date] of [
      ["trustConfirmedAt", record.trustConfirmedAt],
      ["revokedAt", record.revokedAt],
      ["lastUsedAt", record.lastUsedAt],
    ] as const) {
      if (date !== undefined && date < record.importedAt) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "date predates import",
        })
      }
    }
  })

export function validatePqPublicBundleRecord(value: unknown): PqPublicBundleRecord {
  return pqPublicBundleRecordSchema.parse(value) as PqPublicBundleRecord
}
