// PQ メッセージ暗号化の高レベル API(spec2 §5/§6/§7 — WP-13)。
// suite は選択済み鍵の実 algorithm から resolveSuite で導出する(plan2.1 §C1)。
// Worker RPC(encryptPqMessage)へ委譲し、main thread で秘密素材を扱わない。
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
  // 受信者: 取込済み bundle(recipient の KEM 公開鍵と keyId を提供)
  recipient: PqPublicBundleRecord
  plaintext: Uint8Array
  // 署名付きの場合のみ: 自分の identity(signing 側を使用)+ Vault 鍵
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
