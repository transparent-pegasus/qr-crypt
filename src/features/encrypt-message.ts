import { sealSymMessage } from "@/crypto/aes-gcm"
import { AppError } from "@/crypto/errors"
import {
  encodeMlKemEnvelopeV2,
  encodeSymMessageEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import { encryptPq } from "@/crypto/pq/ml-kem-envelope"
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { sha256Hex } from "@/lib/bytes"
import {
  FRAME_BYTES_MAX,
  minimumFrameBytesForArtifact,
  singleFrameBytesFor,
} from "@/lib/limits"
import { buildV2Payload } from "@/qr/payload-v2"
import type {
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
  PqPublicBundleRecord,
  StoredKeyRecord,
  SymMessageEnvelopeV2,
} from "@/schemas/domain"
import { markKeyUsed } from "@/storage/key-repository"
import { markBundleUsed } from "@/storage/pq-bundle-repository"
import { markIdentityUsed } from "@/storage/pq-identity-repository"

export type EncryptMessageRequest =
  | { kind: "sym"; record: StoredKeyRecord; plaintext: Uint8Array; now: number }
  | {
      kind: "pq"
      client: PqCryptoClient
      recipient: PqPublicBundleRecord
      sender: PostQuantumIdentity
      plaintext: Uint8Array
      now: number
    }

export type EncryptedMessage =
  | {
      kind: "sym"
      payload: string
      envelope: SymMessageEnvelopeV2
      artifactType: "sym-message"
      artifactBytes: Uint8Array
      frameBytes: number
      createdAt: number
      totalBytes: number
      sha256: string
    }
  | {
      kind: "pq"
      payload: string
      envelope: MlKemMessageEnvelopeV2
      artifactType: "pq-message"
      artifactBytes: Uint8Array
      recipient: PqPublicBundleRecord
      sender: PostQuantumIdentity
      createdAt: number
      totalBytes: number
      sha256: string
    }

/**
 * Encrypts one message and returns everything the display needs, as a single operation:
 * seal, canonical artifact, size admissibility, digest, and the key-usage timestamps.
 *
 * Usage recording lives here rather than at the call site so a surface that shows a
 * result cannot skip it. Both branches share one boundary for the same reason — the
 * cipher differs, the policy around it must not drift apart.
 *
 * Rejects with an AppError; nothing partial is returned. `QR_TOO_LARGE` means the
 * artifact cannot be carried by any admissible frame size, which is a property of the
 * ciphertext, not of the display.
 */
export async function encryptMessage(
  request: EncryptMessageRequest,
): Promise<EncryptedMessage> {
  if (request.kind === "sym") {
    const envelope = await sealSymMessage({
      record: request.record,
      plaintext: request.plaintext,
      now: request.now,
    })
    const artifactBytes = encodeSymMessageEnvelopeV2(envelope)
    let frameBytes: number
    try {
      frameBytes = singleFrameBytesFor(artifactBytes.byteLength)
    } catch {
      throw new AppError("QR_TOO_LARGE")
    }
    const sha256 = await sha256Hex(artifactBytes)
    await markKeyUsed(request.record.id, request.now).catch(() => undefined)
    return {
      kind: "sym",
      payload: buildV2Payload("sym-message", artifactBytes),
      envelope,
      artifactType: "sym-message",
      artifactBytes,
      frameBytes,
      createdAt: request.now,
      totalBytes: artifactBytes.byteLength,
      sha256,
    }
  }

  const envelope = await encryptPq({
    client: request.client,
    recipient: request.recipient,
    plaintext: request.plaintext,
    sign: { identity: request.sender, vaultKey: await getOrCreateVaultKey() },
    now: request.now,
  })
  const artifactBytes = encodeMlKemEnvelopeV2(envelope)
  if (minimumFrameBytesForArtifact(artifactBytes.byteLength) > FRAME_BYTES_MAX) {
    throw new AppError("QR_TOO_LARGE")
  }
  const sha256 = await sha256Hex(artifactBytes)
  await markBundleUsed(request.recipient.recordId, request.now).catch(
    () => undefined,
  )
  await markIdentityUsed(request.sender.id, request.now).catch(() => undefined)
  return {
    kind: "pq",
    payload: buildV2Payload("pq-message", artifactBytes),
    envelope,
    artifactType: "pq-message",
    artifactBytes,
    recipient: request.recipient,
    sender: request.sender,
    createdAt: request.now,
    totalBytes: artifactBytes.byteLength,
    sha256,
  }
}
