// Strict Zod validation for v2 structures. Layer environment-dependent limits
// (such as MAX_PLAINTEXT_BYTES) and cross-field constraints over canonical-cbor's
// protocol-constant structural guards. Reference the size tables in profiles.ts and
// limits.ts; do not redefine them.
import type {
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  QrFrameV2,
} from "@/schemas/domain"
import {
  ML_DSA_ALGORITHMS,
  ML_KEM_ALGORITHMS,
  V2_ARTIFACT_TYPES,
  WIRE_SUITES,
} from "@/schemas/domain"
import { z } from "zod"
import { AppError } from "@/crypto/errors"
import {
  guardMlKemEnvelopeV2,
  guardPublicIdentityBundleV2,
  guardQrFrameV2,
} from "@/crypto/pq/canonical-cbor"
import {
  DSA_SIZES,
  KEM_SIZES,
  maxEnvelopeCiphertextBytes,
} from "@/crypto/pq/profiles"
import { suiteComponents } from "@/crypto/pq/suites"
import {
  FRAME_CHUNK_MAX_BYTES,
  HKDF_SALT_BYTES,
  IV_BYTES,
  KEY_ID_PATTERN,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"

const bytes = (length?: number) =>
  z
    .instanceof(Uint8Array)
    .refine((value) => length === undefined || value.byteLength === length)

const keyId = z.string().regex(KEY_ID_PATTERN)
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const mlKemEnvelopeV2Schema = z
  .object({
    version: z.literal(2),
    type: z.literal("pq-message"),
    suite: z.enum(WIRE_SUITES),
    recipientKemKeyId: keyId,
    kemCiphertext: bytes(),
    hkdfSalt: bytes(HKDF_SALT_BYTES),
    iv: bytes(IV_BYTES),
    ciphertext: bytes().refine((value) => value.byteLength >= 16),
  })
  .strict()
  .superRefine((envelope, context) => {
    const components = suiteComponents(envelope.suite)
    if (envelope.kemCiphertext.byteLength !== KEM_SIZES[components.kem].ciphertextBytes) {
      context.addIssue({
        code: "custom",
        path: ["kemCiphertext"],
        message: "invalid KEM ciphertext length",
      })
    }
    if (
      envelope.ciphertext.byteLength > maxEnvelopeCiphertextBytes(envelope.suite)
    ) {
      context.addIssue({
        code: "custom",
        path: ["ciphertext"],
        message: "ciphertext exceeds the configured plaintext bound",
      })
    }
  })

const publicIdentityBundleV2Schema = z
  .object({
    version: z.literal(2),
    type: z.literal("pq-public-identity"),
    identityId: keyId,
    name: z.string().min(1).max(100).optional(),
    kem: z
      .object({
        algorithm: z.enum(ML_KEM_ALGORITHMS),
        keyId,
        publicKey: bytes(),
      })
      .strict(),
    signing: z
      .object({
        algorithm: z.enum(ML_DSA_ALGORITHMS),
        keyId,
        publicKey: bytes(),
      })
      .strict(),
    createdAt: timestamp,
  })
  .strict()
  .superRefine((bundle, context) => {
    const algorithmsMatch =
      (bundle.kem.algorithm === "ML-KEM-768" &&
        bundle.signing.algorithm === "ML-DSA-65") ||
      (bundle.kem.algorithm === "ML-KEM-1024" && bundle.signing.algorithm === "ML-DSA-87")
    if (!algorithmsMatch) {
      context.addIssue({
        code: "custom",
        path: ["signing", "algorithm"],
        message: "KEM and signature profiles do not match",
      })
    }
    if (
      bundle.kem.publicKey.byteLength !== KEM_SIZES[bundle.kem.algorithm].publicKeyBytes
    ) {
      context.addIssue({
        code: "custom",
        path: ["kem", "publicKey"],
        message: "invalid KEM public key length",
      })
    }
    if (
      bundle.signing.publicKey.byteLength !==
      DSA_SIZES[bundle.signing.algorithm].publicKeyBytes
    ) {
      context.addIssue({
        code: "custom",
        path: ["signing", "publicKey"],
        message: "invalid signing public key length",
      })
    }
  })

const qrFrameV2Schema = z
  .object({
    version: z.literal(2),
    type: z.literal("qr-frame"),
    transferId: bytes(16),
    artifactType: z.enum(V2_ARTIFACT_TYPES),
    frameIndex: z.number().int().nonnegative(),
    frameCount: z.number().int().min(1).max(PROTOCOL_MAX_FRAMES),
    totalByteLength: z.number().int().min(1).max(MAX_ARTIFACT_BYTES_ABSOLUTE),
    chunk: bytes().refine(
      (value) => value.byteLength >= 1 && value.byteLength <= FRAME_CHUNK_MAX_BYTES,
    ),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.frameIndex >= frame.frameCount) {
      context.addIssue({
        code: "custom",
        path: ["frameIndex"],
        message: "frameIndex must be less than frameCount",
      })
    }
    if (
      frame.chunk.byteLength > frame.totalByteLength ||
      frame.totalByteLength > frame.frameCount * FRAME_CHUNK_MAX_BYTES ||
      (frame.frameCount === 1 && frame.chunk.byteLength !== frame.totalByteLength)
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalByteLength"],
        message: "frame lengths are inconsistent",
      })
    }
  })

function parseOrInvalid<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError("INVALID_QR_PAYLOAD")
  return result.data as T
}

export function validateMlKemEnvelopeV2(value: unknown): MlKemMessageEnvelopeV2 {
  try {
    return parseOrInvalid<MlKemMessageEnvelopeV2>(
      mlKemEnvelopeV2Schema,
      guardMlKemEnvelopeV2(value),
    )
  } catch {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
}

export function validatePublicIdentityBundleV2(value: unknown): PublicIdentityBundleV2 {
  try {
    return parseOrInvalid<PublicIdentityBundleV2>(
      publicIdentityBundleV2Schema,
      guardPublicIdentityBundleV2(value),
    )
  } catch {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
}

export function validateQrFrameV2(value: unknown): QrFrameV2 {
  try {
    return parseOrInvalid<QrFrameV2>(qrFrameV2Schema, guardQrFrameV2(value))
  } catch {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
}
