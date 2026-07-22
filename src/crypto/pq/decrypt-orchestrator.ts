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

export function decryptPqMessage(args: DecryptPqMessageArgs): Promise<PqDecryptResult> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-11 decryptPqMessage")
}
