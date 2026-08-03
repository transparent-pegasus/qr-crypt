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
  SymMessageEnvelopeV2,
} from "@/schemas/domain"
import { getActiveKeyRecord, markKeyUsed } from "@/storage/key-repository"
import { markBundleUsed } from "@/storage/pq-bundle-repository"
import { markIdentityUsed } from "@/storage/pq-identity-repository"

export type EncryptMessageRequest =
  | { kind: "sym"; keyId: string; plaintext: Uint8Array; now: number }
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
 * The symmetric key is re-resolved from storage at action time, and it must be the
 * active head: a caller's cached list only gates its button, and a key rotated or
 * deleted in another tab must not still encrypt from a stale in-memory object. A rotated
 * id is not followed to its successor — that would silently encrypt to a key the
 * operator did not choose — so it fails and the operator re-selects. A lifecycle write
 * landing between this lookup and the cipher call is the residual race recorded in
 * docs/security/threat-model.md T14.
 *
 * Rejects with an AppError; nothing partial is returned. `QR_TOO_LARGE` means the
 * artifact cannot be carried by any admissible frame size, which is a property of the
 * ciphertext, not of the display.
 */
export async function encryptMessage(
  request: EncryptMessageRequest,
): Promise<EncryptedMessage> {
  if (request.kind === "sym") {
    const record = await getActiveKeyRecord(request.keyId)
    if (record === undefined) throw new AppError("KEY_NOT_FOUND")
    const envelope = await sealSymMessage({
      record,
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
    await markKeyUsed(record.id, request.now).catch(() => undefined)
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
