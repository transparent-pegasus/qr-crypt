// Encode and decode QR payload strings (docs/spec/qr-protocol.md §1/§2/§6).
// The table in qr-protocol.md §6 is authoritative for validation order and error mapping.
import type {
  AnyEnvelopeV1,
  MessageEnvelope,
  PublicKeyEnvelopeV1,
  SymmetricKeyEnvelopeV1,
} from "@/crypto/envelope"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  QrFrameV2,
  SymMessageEnvelopeV2,
  SymmetricKeyEnvelopeV2,
} from "@/schemas/domain"
import { Decoder, Encoder, Tag } from "cbor-x"
import { AppError, toAppError } from "@/crypto/errors"
import {
  decodeDsaPublicKeyEnvelopeV2,
  decodeKemPublicKeyEnvelopeV2,
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
import { fromBase64Url, toBase64Url } from "@/lib/base64url"
import { sha256Hex, utf8ToBytes } from "@/lib/bytes"
import { MAX_PAYLOAD_CHARS } from "@/lib/limits"
import { classifyV2Payload, decodeFramePayload, splitV2Payload } from "@/qr/payload-v2"
import { validateDecodedEnvelope } from "@/schemas/envelope-schema"

export const QR_PREFIX = {
  message: "OCM1:",
  "symmetric-key": "OCK1:",
  "public-key": "OCP1:",
  // Reserved in v1; neither generate nor accept it.
  "encrypted-private-key": "OCB1:",
} as const

export type PayloadKind = "message" | "symmetric-key" | "public-key"

export type DecodedPayload =
  | { kind: "message"; envelope: MessageEnvelope }
  | { kind: "symmetric-key"; envelope: SymmetricKeyEnvelopeV1 }
  | { kind: "public-key"; envelope: PublicKeyEnvelopeV1 }
  | { kind: "pq-message"; envelope: MlKemMessageEnvelopeV2 }
  | { kind: "sym-message"; envelope: SymMessageEnvelopeV2 }
  | { kind: "symmetric-key"; envelope: SymmetricKeyEnvelopeV2 }
  | { kind: "pq-kem-public-key"; envelope: KemPublicKeyEnvelopeV2 }
  | { kind: "pq-dsa-public-key"; envelope: DsaPublicKeyEnvelopeV2 }
  | { kind: "pq-public-identity"; envelope: PublicIdentityBundleV2 }
  | { kind: "frame"; envelope: QrFrameV2; frame: QrFrameV2 }

const encoder = new Encoder({ useRecords: false, tagUint8Array: false })
const decoder = new Decoder({
  useRecords: false,
  tagUint8Array: false,
  mapsAsObjects: true,
})

function orderedEnvelope(envelope: AnyEnvelopeV1): Record<string, unknown> {
  if (envelope.type === "message" && envelope.algorithm === "A256GCM") {
    return {
      v: envelope.v,
      type: envelope.type,
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      createdAt: envelope.createdAt,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
      aad: envelope.aad,
    }
  }
  if (envelope.type === "symmetric-key") {
    return {
      v: envelope.v,
      type: envelope.type,
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      createdAt: envelope.createdAt,
      key: envelope.key,
    }
  }
  return {
    v: envelope.v,
    type: envelope.type,
    algorithm: envelope.algorithm,
    keyId: envelope.keyId,
    createdAt: envelope.createdAt,
    spki: envelope.spki,
  }
}

function prefixKindForEnvelope(envelope: AnyEnvelopeV1): PayloadKind {
  if (envelope.type === "message") return "message"
  return envelope.type
}

function containsUnsupportedCbor(value: unknown): boolean {
  if (value instanceof Tag || value instanceof Map) return true
  if (value instanceof Uint8Array || value === null) return false
  if (Array.isArray(value)) return value.some(containsUnsupportedCbor)
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown
    if (prototype !== Object.prototype && prototype !== null) return true
    return Object.values(value as Record<string, unknown>).some(containsUnsupportedCbor)
  }
  return false
}

// Encode CBOR only through the shared Encoder({ useRecords: false, tagUint8Array: false })
// and per-type builders with fixed key order.
export function encodeEnvelopeToPayload(envelope: AnyEnvelopeV1): string {
  try {
    const kind = prefixKindForEnvelope(envelope)
    const validated = validateDecodedEnvelope(envelope, kind)
    const bytes = encoder.encode(orderedEnvelope(validated))
    const payload = `${QR_PREFIX[kind]}${toBase64Url(bytes)}`
    if (payload.length > MAX_PAYLOAD_CHARS) {
      throw new AppError("INVALID_QR_PAYLOAD")
    }
    return payload
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}

function decodeV1Payload(text: string): DecodedPayload {
  const prefixEntry = Object.entries(QR_PREFIX).find(([, prefix]) =>
    text.startsWith(prefix),
  ) as [keyof typeof QR_PREFIX, string] | undefined
  if (prefixEntry === undefined) throw new AppError("INVALID_QR_PREFIX")
  const [prefixKind, prefix] = prefixEntry
  if (prefixKind === "encrypted-private-key") {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (text.length > MAX_PAYLOAD_CHARS) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }

  let decoded: unknown
  try {
    const body = text.slice(prefix.length)
    if (body.length === 0) throw new Error("empty payload")
    const values = decoder.decodeMultiple(fromBase64Url(body)) as unknown[]
    if (values.length !== 1) throw new Error("trailing CBOR value")
    decoded = values[0]
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded) ||
      decoded instanceof Map ||
      containsUnsupportedCbor(decoded)
    ) {
      throw new Error("invalid CBOR map")
    }
  } catch {
    throw new AppError("INVALID_QR_PAYLOAD")
  }

  const envelope = validateDecodedEnvelope(decoded, prefixKind)
  if (prefixKind === "message") {
    return { kind: "message", envelope: envelope as MessageEnvelope }
  }
  if (prefixKind === "symmetric-key") {
    return {
      kind: "symmetric-key",
      envelope: envelope as SymmetricKeyEnvelopeV1,
    }
  }
  return { kind: "public-key", envelope: envelope as PublicKeyEnvelopeV1 }
}

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
    case "pq-kem-public-key":
      return {
        kind: artifact.kind,
        envelope: decodeKemPublicKeyEnvelopeV2(artifact.bytes),
      }
    case "pq-dsa-public-key":
      return {
        kind: artifact.kind,
        envelope: decodeDsaPublicKeyEnvelopeV2(artifact.bytes),
      }
    case "encrypted-seed-backup":
      throw new AppError("UNSUPPORTED_ALGORITHM")
  }
}

// Prefix classification is the single convergence point for v1 and v2 input. v1
// validation order remains unchanged once dispatch has selected that branch.
export function decodePayload(text: string): DecodedPayload {
  return classifyV2Payload(text) === null ? decodeV1Payload(text) : decodeV2Payload(text)
}

export async function payloadSha256Hex(payload: string): Promise<string> {
  try {
    return await sha256Hex(utf8ToBytes(payload))
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}
