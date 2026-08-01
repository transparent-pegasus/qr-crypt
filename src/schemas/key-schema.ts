// Runtime validation for keys and post-quantum records.
// domain.ts has sole ownership of the domain types themselves; this file contains
// only Zod schemas.
import { z } from "zod"
import { DSA_SEED_BYTES, IV_BYTES, KEM_SEED_BYTES, KEY_ID_PATTERN } from "@/lib/limits"
import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
  StoredKeyRecord,
} from "@/schemas/domain"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"

// Detect control characters in the C0 range or DEL. Use code-point checks to avoid
// embedding control characters in a regular-expression literal.
export function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

// Display/output names: 1–80 characters after trimming; control characters prohibited.
export const qrNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "validation.name.required")
      .max(80, "validation.name.maxLength")
      .refine((value) => !hasControlChars(value), {
        message: "validation.name.invalidChars",
      }),
  )

// Apply the same rules to key names.
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
    status: z.enum(["active", "rotated"]),
    rotatedFromId: keyIdSchema.optional(),
    rotatedAt: timestampSchema.optional(),
    publicKey: z.custom<CryptoKey>(isCryptoKey).optional(),
    privateKey: z.custom<CryptoKey>(isCryptoKey).optional(),
    symmetricKey: z.custom<CryptoKey>(isCryptoKey).optional(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.rotatedFromId === record.id) {
      context.addIssue({
        code: "custom",
        path: ["rotatedFromId"],
        message: "key cannot rotate from itself",
      })
    }
    if (
      (record.status === "active" && record.rotatedAt !== undefined) ||
      (record.status === "rotated" && record.rotatedAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "invalid status date",
      })
    }
    if (record.rotatedAt !== undefined && record.rotatedAt < record.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["rotatedAt"],
        message: "rotation predates key",
      })
    }
  })

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

const kemMaterialSchema = z
  .object({
    algorithm: z.literal("ML-KEM-1024"),
    keyId: keyIdSchema,
    publicKey: bytes(KEM_SIZES["ML-KEM-1024"].publicKeyBytes),
    encryptedSeed: kemEncryptedSeedSchema,
    fingerprint: fingerprintSchema,
  })
  .strict()

const signingMaterialSchema = z
  .object({
    algorithm: z.literal("ML-DSA-87"),
    keyId: keyIdSchema,
    publicKey: bytes(DSA_SIZES["ML-DSA-87"].publicKeyBytes),
    encryptedSeed: signingEncryptedSeedSchema,
    fingerprint: fingerprintSchema,
  })
  .strict()

const postQuantumIdentitySchema = z
  .object({
    id: keyIdSchema,
    name: keyNameSchema,
    profile: z.literal("maximum"),
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

const bundleKemSchema = z
  .object({
    algorithm: z.literal("ML-KEM-1024"),
    keyId: keyIdSchema,
    publicKey: bytes(KEM_SIZES["ML-KEM-1024"].publicKeyBytes),
    fingerprint: fingerprintSchema,
  })
  .strict()

const bundleSigningSchema = z
  .object({
    algorithm: z.literal("ML-DSA-87"),
    keyId: keyIdSchema,
    publicKey: bytes(DSA_SIZES["ML-DSA-87"].publicKeyBytes),
    fingerprint: fingerprintSchema,
  })
  .strict()

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
