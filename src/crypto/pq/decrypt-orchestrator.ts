// 署名付き復号 orchestrator(plan2.1 §C2 — WP-11)。
//
// フロー(凍結):
//   openPqEnvelope(Worker: Decaps → HKDF → GCM 認証成功 → 内側 schema 検証)
//   → unsigned suite: {kind:"unsigned", plaintext}
//   → signed suite: 内側 senderSigningKeyId で resolveSigningKey(repo lookup)
//     → 未知鍵: {kind:"signed-key-unknown", senderSigningKeyId}
//       (plaintext は構成しない・Worker 内 zeroize・署名鍵取込導線へ)
//     → 既知鍵: verifySignedMessage → 成功時のみ {kind:"signed-valid", ...}
//       失敗時 AppError("SIGNATURE_INVALID")(plaintext 非表示 spec2 §20)
//
// 相互拘束(plan2.1 §C4): outer suite / recipient identity の algorithm・keyId /
// inner body.recipientKemKeyId / signature.algorithm / body.senderSigningKeyId /
// 解決済み公開鍵・鍵長 を全照合。不一致は DECRYPTION_FAILED。
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import type {
  MlDsaAlgorithm,
  PostQuantumIdentity,
  MlKemMessageEnvelopeV2,
  PqDecryptResult,
} from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import { suiteComponents } from "@/crypto/pq/suites"
import { zeroize } from "@/crypto/pq/zeroize"

export interface ResolvedSigningKey {
  algorithm: MlDsaAlgorithm
  publicKey: Uint8Array
  // 取込済みレコードの失効状態(revoked は検証にも使わない → 未知鍵扱い)
  revoked: boolean
}

export type ResolveSigningKey = (
  senderSigningKeyId: string,
) => Promise<ResolvedSigningKey | undefined>

export interface DecryptPqMessageArgs {
  client: PqCryptoClient
  envelope: MlKemMessageEnvelopeV2
  recipient: PostQuantumIdentity
  vaultKey: CryptoKey
  resolveSigningKey: ResolveSigningKey
}

export async function decryptPqMessage(
  args: DecryptPqMessageArgs,
): Promise<PqDecryptResult> {
  const components = suiteComponents(args.envelope.suite)
  if (
    args.recipient.kem.algorithm !== components.kem ||
    args.recipient.kem.keyId !== args.envelope.recipientKemKeyId ||
    args.recipient.kem.publicKey.byteLength !== KEM_SIZES[components.kem].publicKeyBytes
  ) {
    throw new AppError("DECRYPTION_FAILED")
  }

  const opened = await args.client.openPqEnvelope({
    envelope: args.envelope,
    recipient: {
      identityId: args.recipient.id,
      kemAlgorithm: args.recipient.kem.algorithm,
      kemKeyId: args.recipient.kem.keyId,
      encryptedKemSeed: args.recipient.kem.encryptedSeed,
      storedKemPublicKey: args.recipient.kem.publicKey,
      vaultKey: args.vaultKey,
    },
  })
  if (opened.kind === "unsigned") {
    if (components.signature !== undefined) {
      zeroize(opened.plaintext)
      throw new AppError("DECRYPTION_FAILED")
    }
    return { kind: "unsigned", plaintext: opened.plaintext }
  }

  try {
    if (
      components.signature === undefined ||
      opened.signatureAlgorithm !== components.signature
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }
    const resolved = await args.resolveSigningKey(opened.senderSigningKeyId)
    if (resolved === undefined || resolved.revoked) {
      return {
        kind: "signed-key-unknown",
        senderSigningKeyId: opened.senderSigningKeyId,
      }
    }
    if (
      resolved.algorithm !== components.signature ||
      resolved.publicKey.byteLength !== DSA_SIZES[components.signature].publicKeyBytes
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }
    const verified = await args.client.verifySignedMessage({
      signedMessageBytes: opened.signedMessageBytes,
      senderPublicKey: resolved.publicKey,
      algorithm: resolved.algorithm,
    })
    if (!verified.valid) throw new AppError("SIGNATURE_INVALID")
    return {
      kind: "signed-valid",
      plaintext: verified.plaintext,
      senderSigningKeyId: opened.senderSigningKeyId,
    }
  } finally {
    zeroize(opened.signedMessageBytes)
  }
}
