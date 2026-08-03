import { openSymMessage } from "@/crypto/aes-gcm"
import { AppError } from "@/crypto/errors"
import {
  encodeMlKemEnvelopeV2,
  encodeSymMessageEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import { zeroize } from "@/crypto/pq/zeroize"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { isUsableBundle, isUsableIdentity } from "@/components/key-detail/identity-policy"
import { recordReceipt, type ReceiptVerdict } from "@/features/receipt-cache"
import { bytesToHex, bytesToUtf8 } from "@/lib/bytes"
import { buildV2Payload } from "@/qr/payload-v2"
import { payloadSha256Hex } from "@/qr/payload"
import type {
  MlKemMessageEnvelopeV2,
  PqPublicBundleRecord,
  StoredKeyRecord,
  SymMessageEnvelopeV2,
} from "@/schemas/domain"
import { markKeyUsed } from "@/storage/key-repository"
import { findBundleBySigningKeyId } from "@/storage/pq-bundle-repository"
import {
  findIdentityByKemKeyId,
  markIdentityUsed,
} from "@/storage/pq-identity-repository"

export type DecryptMessageRequest =
  | {
      kind: "sym-message"
      envelope: SymMessageEnvelopeV2
      record: StoredKeyRecord
    }
  | {
      kind: "pq-message"
      envelope: MlKemMessageEnvelopeV2
      client: PqCryptoClient
    }

export type DecryptedMessage =
  | {
      kind: "signed-valid"
      text: string
      replay: ReceiptVerdict
      senderCreatedAt: number
      senderSigningKeyId: string
      sender: PqPublicBundleRecord
    }
  | { kind: "signed-key-unknown"; senderSigningKeyId: string }
  | { kind: "aes"; text: string; replay: ReceiptVerdict }

/**
 * Opens one message and returns only what may be shown, as a single operation: decrypt,
 * verify, replay-check, record the usage, and release the plaintext bytes.
 *
 * Everything that decides whether a plaintext is allowed on screen lives inside this
 * boundary, so no surface can display a result without it:
 *
 * - The recipient identity is re-resolved from storage at action time. A caller's cached
 *   list only gates its button; a generation discarded elsewhere must not decrypt from a
 *   stale in-memory object. A delete landing between this lookup and the worker call is a
 *   residual race, recorded in docs/security/threat-model.md T14.
 * - A replayed message id rejects rather than returns. Refused plaintext is necessarily
 *   constructed — the message id is inside the ciphertext — but never returned.
 * - Plaintext bytes are zeroized in `finally`, so they do not outlive the call on any
 *   path. Only the decoded string leaves.
 */
export async function decryptMessage(
  request: DecryptMessageRequest,
): Promise<DecryptedMessage> {
  if (request.kind === "sym-message") {
    const decryptedBytes = await openSymMessage({
      record: request.record,
      envelope: request.envelope,
    })
    try {
      const envelopeHash = await payloadSha256Hex(
        buildV2Payload(
          "sym-message",
          encodeSymMessageEnvelopeV2(request.envelope),
        ),
      )
      const verdict = recordReceipt(
        {
          kind: "sym",
          recipientKeyId: request.record.id,
          envelopeHash,
        },
        Date.now(),
      )
      // Unreachable for symmetric messages — their receipt identity includes the
      // ciphertext hash — but the refusal is shared with the PQ path.
      if (verdict.kind === "message-id-reused") {
        throw new AppError("MESSAGE_ID_REUSED")
      }
      await markKeyUsed(request.record.id, Date.now()).catch(() => undefined)
      return {
        kind: "aes",
        text: bytesToUtf8(decryptedBytes),
        replay: verdict,
      }
    } finally {
      zeroize(decryptedBytes)
    }
  }

  const recipient = await findIdentityByKemKeyId(
    request.envelope.recipientKemKeyId,
  )
  if (recipient === undefined || !isUsableIdentity(recipient)) {
    throw new AppError("KEY_NOT_FOUND")
  }
  // Key ids are attacker-assertable, so the record that verifies the signature is
  // also the record reported as the sender: one exact lookup, no list ordering.
  let resolvedSender: PqPublicBundleRecord | undefined
  const pqResult = await decryptPqMessage({
    client: request.client,
    envelope: request.envelope,
    recipient,
    vaultKey: await getOrCreateVaultKey(),
    resolveSigningKey: async (keyId) => {
      const record = await findBundleBySigningKeyId(keyId)
      if (record === undefined || !isUsableBundle(record)) return undefined
      resolvedSender = record
      return {
        algorithm: record.signing.algorithm,
        publicKey: record.signing.publicKey,
        revoked: record.revokedAt !== undefined,
      }
    },
  })
  if (pqResult.kind === "signed-key-unknown") {
    await markIdentityUsed(recipient.id, Date.now()).catch(() => undefined)
    return pqResult
  }

  const decryptedBytes = pqResult.plaintext
  try {
    const envelopeHash = await payloadSha256Hex(
      buildV2Payload("pq-message", encodeMlKemEnvelopeV2(request.envelope)),
    )
    const messageIdHex = bytesToHex(pqResult.messageId)
    if (resolvedSender === undefined) {
      throw new AppError("DECRYPTION_FAILED")
    }
    const verdict = recordReceipt(
      {
        kind: "pq-signed",
        senderFingerprint: resolvedSender.signing.fingerprint,
        recipientKemKeyId: request.envelope.recipientKemKeyId,
        messageIdHex,
        envelopeHash,
      },
      Date.now(),
    )
    if (verdict.kind === "message-id-reused") {
      throw new AppError("MESSAGE_ID_REUSED")
    }
    const outcome: DecryptedMessage = {
      kind: "signed-valid",
      text: bytesToUtf8(decryptedBytes),
      replay: verdict,
      senderCreatedAt: pqResult.createdAt,
      senderSigningKeyId: pqResult.senderSigningKeyId,
      sender: resolvedSender,
    }
    await markIdentityUsed(recipient.id, Date.now()).catch(() => undefined)
    return outcome
  } finally {
    zeroize(decryptedBytes)
  }
}
