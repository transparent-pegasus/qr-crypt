// Strict Zod validation for envelopes (docs/spec/qr-protocol.md §3/§6).
// Reject unknown keys, enforce fixed byte lengths, and ensure prefix/type agreement.
// decodePayload in qr/payload.ts uses this validation boundary.
import { z } from "zod"
import { AppError } from "@/crypto/errors"
import type { AnyEnvelopeV1 } from "@/crypto/envelope"
import { keyIdSchema } from "@/schemas/key-schema"
import {
  AES_KEY_BYTES,
  IV_BYTES,
  MAX_AAD_BYTES,
  MAX_CIPHERTEXT_BYTES,
} from "@/lib/limits"

const createdAtSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const byteString = z.custom<Uint8Array>((value) => value instanceof Uint8Array)
const exactBytes = (length: number) =>
  byteString.refine((value) => value.byteLength === length)
const ciphertextSchema = byteString.refine(
  (value) => value.byteLength >= 16 && value.byteLength <= MAX_CIPHERTEXT_BYTES,
)
const aadSchema = byteString.refine(
  (value) => value.byteLength > 0 && value.byteLength <= MAX_AAD_BYTES,
)

const aesMessageSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("message"),
    algorithm: z.literal("A256GCM"),
    keyId: keyIdSchema,
    createdAt: createdAtSchema,
    iv: exactBytes(IV_BYTES),
    ciphertext: ciphertextSchema,
    aad: aadSchema,
  })
  .strict()

const symmetricKeySchema = z
  .object({
    v: z.literal(1),
    type: z.literal("symmetric-key"),
    algorithm: z.literal("A256GCM"),
    keyId: keyIdSchema,
    createdAt: createdAtSchema,
    key: exactBytes(AES_KEY_BYTES),
  })
  .strict()

const publicKeySchema = z
  .object({
    v: z.literal(1),
    type: z.literal("public-key"),
    algorithm: z.literal("RSA-OAEP-3072"),
    keyId: keyIdSchema,
    createdAt: createdAtSchema,
    spki: byteString.refine(
      (value) => value.byteLength >= 350 && value.byteLength <= 1200,
    ),
  })
  .strict()

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

// Validate a CBOR-decoded unknown value and return a typed envelope.
// Validation order: v → type (prefix agreement) → algorithm → strict shape/length.
// Convert failures to AppError(UNSUPPORTED_PROTOCOL_VERSION / UNSUPPORTED_ALGORITHM /
// INVALID_QR_PAYLOAD) and throw.
export function validateDecodedEnvelope(
  value: unknown,
  expectedPrefixKind: string,
): AnyEnvelopeV1 {
  if (!isPlainRecord(value)) throw new AppError("INVALID_QR_PAYLOAD")
  if (!("v" in value)) throw new AppError("INVALID_QR_PAYLOAD")
  if (value.v !== 1) throw new AppError("UNSUPPORTED_PROTOCOL_VERSION")

  const expectedType =
    expectedPrefixKind === "message"
      ? "message"
      : expectedPrefixKind === "symmetric-key"
        ? "symmetric-key"
        : expectedPrefixKind === "public-key"
          ? "public-key"
          : undefined
  if (expectedType === undefined || value.type !== expectedType) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (!("algorithm" in value) || typeof value.algorithm !== "string") {
    throw new AppError("INVALID_QR_PAYLOAD")
  }

  let schema: z.ZodType<AnyEnvelopeV1>
  if (expectedType === "message") {
    if (value.algorithm !== "A256GCM") {
      throw new AppError("UNSUPPORTED_ALGORITHM")
    }
    schema = aesMessageSchema
  } else if (expectedType === "symmetric-key") {
    if (value.algorithm !== "A256GCM") {
      throw new AppError("UNSUPPORTED_ALGORITHM")
    }
    schema = symmetricKeySchema
  } else {
    if (value.algorithm !== "RSA-OAEP-3072") {
      throw new AppError("UNSUPPORTED_ALGORITHM")
    }
    schema = publicKeySchema
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new AppError("INVALID_QR_PAYLOAD")
  return parsed.data
}
