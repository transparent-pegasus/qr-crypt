// Strict Zod validation for QrFrameV2. In addition to the protocol-constant
// checks in canonical-cbor.guardQrFrameV2, provide a schema-level revalidation surface.
// This duplicate validation is intentional because QR-derived input is assumed hostile.
import type { QrFrameV2 } from "@/schemas/domain"
import { z } from "zod"
import { AppError } from "@/crypto/errors"
import {
  FRAME_CHUNK_MAX_BYTES,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import { V2_ARTIFACT_TYPES } from "@/schemas/domain"

const byteArray = (length?: number) =>
  z
    .instanceof(Uint8Array)
    .refine((value) => length === undefined || value.byteLength === length)

const safeIntegerInRange = (minimum: number, maximum: number) =>
  z
    .number()
    .min(minimum)
    .max(maximum)
    .refine((value) => Number.isSafeInteger(value))

const qrFrameV2Schema = z
  .object({
    version: z.literal(2),
    type: z.literal("qr-frame"),
    transferId: byteArray(16),
    artifactType: z.enum(V2_ARTIFACT_TYPES),
    frameIndex: safeIntegerInRange(0, PROTOCOL_MAX_FRAMES - 1),
    frameCount: safeIntegerInRange(1, PROTOCOL_MAX_FRAMES),
    totalByteLength: safeIntegerInRange(1, MAX_ARTIFACT_BYTES_ABSOLUTE),
    chunk: byteArray().refine(
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
    if (frame.chunk.byteLength > frame.totalByteLength) {
      context.addIssue({
        code: "custom",
        path: ["chunk"],
        message: "chunk must not exceed totalByteLength",
      })
    }
  })

function isPlainRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null || value instanceof Uint8Array) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

export function validateQrFrameV2Strict(value: unknown): QrFrameV2 {
  try {
    if (!isPlainRecord(value)) throw new AppError("INVALID_QR_PAYLOAD")
    const parsed = qrFrameV2Schema.safeParse(value)
    if (!parsed.success) throw new AppError("INVALID_QR_PAYLOAD")
    return parsed.data
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError("INVALID_QR_PAYLOAD")
  }
}
