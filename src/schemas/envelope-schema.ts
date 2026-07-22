// エンベロープの Zod strict 検証(docs/qr-protocol.md §3/§6)。
// 未知キー拒否・バイト長固定・prefix と type の整合まで担う。
// 実装は WP-2(qr/payload.ts の decodePayload から使用される)。
import { z } from "zod"
import { AppError } from "@/crypto/errors"
import type { AnyEnvelopeV1 } from "@/crypto/envelope"
import {
  AES_KEY_BYTES,
  IV_BYTES,
  KEY_ID_PATTERN,
  MAX_AAD_BYTES,
  MAX_CIPHERTEXT_BYTES,
} from "@/lib/limits"

const keyIdSchema = z.string().regex(KEY_ID_PATTERN)
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

// CBOR デコード済みの unknown 値を検証し、型付きエンベロープを返す。
// 検証順序: v → type(プレフィックス整合)→ algorithm → strict 形状/長さ。
// 失敗は AppError(UNSUPPORTED_PROTOCOL_VERSION / UNSUPPORTED_ALGORITHM /
// INVALID_QR_PAYLOAD)へ変換して throw。
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
