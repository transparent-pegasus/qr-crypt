// High-level API for PQ message encryption; see docs/spec/qr-protocol-v2.md §3–§5.
// Derive the suite from the selected keys' actual algorithms via resolveSuite
// rather than from a preference. Delegate to the encryptPqMessage Worker RPC so the main thread
// does not handle secret material.
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import type {
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
  PqPublicBundleRecord,
} from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import { MAX_PLAINTEXT_BYTES, MESSAGE_ID_BYTES } from "@/lib/limits"

export interface EncryptPqArgs {
  client: PqCryptoClient
  // Recipient: imported bundle that supplies the recipient KEM public key and keyId.
  recipient: PqPublicBundleRecord
  plaintext: Uint8Array
  // Signed mode only: the local identity (signing side) plus the Vault key.
  sign?: {
    identity: PostQuantumIdentity
    vaultKey: CryptoKey
  }
  now: number
}

export async function encryptPq(args: EncryptPqArgs): Promise<MlKemMessageEnvelopeV2> {
  try {
    if (
      !Number.isSafeInteger(args.now) ||
      args.now < 0 ||
      !(args.plaintext instanceof Uint8Array) ||
      args.plaintext.byteLength > MAX_PLAINTEXT_BYTES
    ) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    if (args.recipient.revokedAt !== undefined) {
      throw new AppError("KEY_NOT_FOUND")
    }
    if (args.recipient.trust !== "fingerprint-confirmed") {
      // Parity with the revocation check above: an imported bundle whose fingerprint
      // was never compared out of band must not reach KEM encapsulation. The UI
      // filters first, so this is the backstop for any other caller.
      throw new AppError("KEY_NOT_FOUND")
    }
    if (args.sign !== undefined && args.sign.identity.status !== "active") {
      throw new AppError("ENCRYPTION_FAILED")
    }

    const signingAlgorithm = args.sign?.identity.signing.algorithm
    const suite = resolveSuite(args.recipient.kem.algorithm, signingAlgorithm)
    assertActiveSuite(suite)
    const sign =
      args.sign === undefined
        ? undefined
        : {
            senderSigningKeyId: args.sign.identity.signing.keyId,
            algorithm: args.sign.identity.signing.algorithm,
            vaultKey: args.sign.vaultKey,
            identityId: args.sign.identity.id,
            encryptedSeed: args.sign.identity.signing.encryptedSeed,
            storedPublicKey: args.sign.identity.signing.publicKey,
          }

    return await args.client.encryptPqMessage({
      suite,
      recipientKemKeyId: args.recipient.kem.keyId,
      recipientKemPublicKey: args.recipient.kem.publicKey,
      plaintext: args.plaintext,
      messageId: randomBytes(MESSAGE_ID_BYTES),
      createdAt: args.now,
      ...(sign === undefined ? {} : { sign }),
    })
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}
