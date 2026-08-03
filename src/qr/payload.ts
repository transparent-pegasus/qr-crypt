// Decode canonical v2 payload strings and hash complete payload text.
import type {
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  QrFrameV2,
  SymMessageEnvelopeV2,
  SymmetricKeyEnvelopeV2,
} from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import {
  decodeMlKemEnvelopeV2,
  decodePublicIdentityBundleV2,
  decodeSymMessageEnvelopeV2,
  decodeSymmetricKeyEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import {
  validateMlKemEnvelopeV2,
  validatePublicIdentityBundleV2,
  validateQrFrameV2,
  validateSymMessageEnvelopeV2,
  validateSymmetricKeyEnvelopeV2,
} from "@/crypto/pq/validation"
import { sha256Hex, utf8ToBytes } from "@/lib/bytes"
import { classifyV2Payload, decodeFramePayload, splitV2Payload } from "@/qr/payload-v2"

export type DecodedPayload =
  | { kind: "pq-message"; envelope: MlKemMessageEnvelopeV2 }
  | { kind: "sym-message"; envelope: SymMessageEnvelopeV2 }
  | { kind: "symmetric-key"; envelope: SymmetricKeyEnvelopeV2 }
  | { kind: "pq-public-identity"; envelope: PublicIdentityBundleV2 }
  | { kind: "frame"; envelope: QrFrameV2; frame: QrFrameV2 }

function decodeV2Payload(text: string): DecodedPayload {
  const classified = classifyV2Payload(text)
  if (classified === null) throw new AppError("INVALID_QR_PREFIX")
  if (classified.kind === "frame") {
    const frame = validateQrFrameV2(decodeFramePayload(text))
    if (frame.artifactType === "encrypted-seed-backup") {
      throw new AppError("UNSUPPORTED_ALGORITHM")
    }
    return { kind: "frame", envelope: frame, frame }
  }

  const artifact = splitV2Payload(text)
  switch (artifact.kind) {
    case "pq-message":
      return {
        kind: artifact.kind,
        envelope: validateMlKemEnvelopeV2(decodeMlKemEnvelopeV2(artifact.bytes)),
      }
    case "sym-message":
      return {
        kind: artifact.kind,
        envelope: validateSymMessageEnvelopeV2(
          decodeSymMessageEnvelopeV2(artifact.bytes),
        ),
      }
    case "symmetric-key":
      return {
        kind: artifact.kind,
        envelope: validateSymmetricKeyEnvelopeV2(
          decodeSymmetricKeyEnvelopeV2(artifact.bytes),
        ),
      }
    case "pq-public-identity":
      return {
        kind: artifact.kind,
        envelope: validatePublicIdentityBundleV2(
          decodePublicIdentityBundleV2(artifact.bytes),
        ),
      }
    case "encrypted-seed-backup":
      throw new AppError("UNSUPPORTED_ALGORITHM")
  }
}

export const decodePayload = decodeV2Payload

export async function payloadSha256Hex(payload: string): Promise<string> {
  try {
    return await sha256Hex(utf8ToBytes(payload))
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}
