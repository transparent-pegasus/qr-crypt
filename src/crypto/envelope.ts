// Envelope type definitions (docs/spec/qr-protocol.md §3) and AAD construction (§4).
// Adding or removing fields implies protocol v2 and is not permitted in v1.
import { utf8ToBytes } from "@/lib/bytes"

export interface AesMessageEnvelopeV1 {
  v: 1
  type: "message"
  algorithm: "A256GCM"
  keyId: string
  createdAt: number
  iv: Uint8Array
  ciphertext: Uint8Array
  aad: Uint8Array
}

export interface SymmetricKeyEnvelopeV1 {
  v: 1
  type: "symmetric-key"
  algorithm: "A256GCM"
  keyId: string
  createdAt: number
  key: Uint8Array
}

export interface PublicKeyEnvelopeV1 {
  v: 1
  type: "public-key"
  algorithm: "RSA-OAEP-3072"
  keyId: string
  createdAt: number
  spki: Uint8Array
}

export type MessageEnvelope = AesMessageEnvelopeV1

export type AnyEnvelopeV1 = MessageEnvelope | SymmetricKeyEnvelopeV1 | PublicKeyEnvelopeV1

export interface AadFields {
  v: number
  type: string
  algorithm: string
  keyId: string
  createdAt: number
}

// AAD = UTF-8("OCAAD1|" + v + "|" + type + "|" + algorithm + "|" + keyId + "|" + createdAt)
export function buildAad(fields: AadFields): Uint8Array {
  return utf8ToBytes(
    `OCAAD1|${fields.v}|${fields.type}|${fields.algorithm}|${fields.keyId}|${fields.createdAt}`,
  )
}
