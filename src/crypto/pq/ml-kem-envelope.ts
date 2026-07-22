// PQ メッセージ暗号化の高レベル API(spec2 §5/§6/§7 — WP-13)。
// suite は選択済み鍵の実 algorithm から resolveSuite で導出する(plan2.1 §C1)。
// Worker RPC(encryptPqMessage)へ委譲し、main thread で秘密素材を扱わない。
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import type {
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
  PqPublicBundleRecord,
} from "@/schemas/domain"

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

export function encryptPq(args: EncryptPqArgs): Promise<MlKemMessageEnvelopeV2> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-13 encryptPq")
}
