import type {
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  SymMessageEnvelopeV2,
} from "@/schemas/domain"
import { KEM_KEY_ID } from "./pq-fixtures"

let lastSymMessageEnvelope: SymMessageEnvelopeV2 | null = null
let lastPqEnvelope = initialPqEnvelope(128)
let lastPublicBundle: PublicIdentityBundleV2 | null = null

function initialPqEnvelope(ciphertextBytes: number): MlKemMessageEnvelopeV2 {
  return {
    version: 2,
    type: "pq-message",
    suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
    recipientKemKeyId: KEM_KEY_ID,
    kemCiphertext: new Uint8Array(1568),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(ciphertextBytes),
  }
}

export function getLastSymMessageEnvelope(): SymMessageEnvelopeV2 | null {
  return lastSymMessageEnvelope
}

export function setLastSymMessageEnvelope(
  envelope: SymMessageEnvelopeV2,
): void {
  lastSymMessageEnvelope = envelope
}

export function getLastPqEnvelope(): MlKemMessageEnvelopeV2 {
  return lastPqEnvelope
}

export function setLastPqEnvelope(envelope: MlKemMessageEnvelopeV2): void {
  lastPqEnvelope = envelope
}

export function getLastPublicBundle(): PublicIdentityBundleV2 | null {
  return lastPublicBundle
}

export function setLastPublicBundle(bundle: PublicIdentityBundleV2): void {
  lastPublicBundle = bundle
}

export function resetWireState(): void {
  lastSymMessageEnvelope = null
  lastPqEnvelope = initialPqEnvelope(32)
  lastPublicBundle = null
}
