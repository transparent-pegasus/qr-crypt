// PQ Worker RPC クライアント(plan2.1 §F — WP-11)。
//
// 秘密境界(凍結):
//   - seed / 展開済み秘密鍵 / 共有秘密 / 導出鍵バイトは Worker 外へ返さない
//   - Worker 外へ出るのは 公開鍵・KEM 暗号文・署名・最終暗号結果 のみ
//   - 秘密バッファーは Transfer しない(U3)。Transfer は公開 artifact のみで、
//     exact-length owned ArrayBuffer に限る(subarray の余分な backing 禁止)
//   - RPC は correlation ID・入力長の送信前検査・timeout 時の worker terminate・
//     late response 無視・sanitized error を実装する
//   - ブラウザーで Worker が使えない/起動失敗/クラッシュ時は fail-closed:
//     AppError("WORKER_UNAVAILABLE")。main thread へのフォールバック禁止。
//     プロバイダー直接呼出しは Node テスト(vitest node project)専用。
import type {
  EncryptedSecret,
  MlDsaAlgorithm,
  MlKemMessageEnvelopeV2,
  PqProfileId,
  WireSuite,
} from "@/schemas/domain"

// 生成: シードは Worker 内で CSPRNG 生成し、Vault 鍵で暗号化してから返す。
// AAD は Worker 内で buildVaultAadV2 により構築する(publicKeySha256 含む)。
export interface GenerateIdentityKeysRequest {
  profile: PqProfileId
  vaultKey: CryptoKey
  identityId: string
  kemKeyId: string
  signingKeyId: string
}

export interface GeneratedIdentityKeys {
  kem: { publicKey: Uint8Array; encryptedSeed: EncryptedSecret }
  signing: { publicKey: Uint8Array; encryptedSeed: EncryptedSecret }
}

// 再展開照合(plan2.1 §C8): シード復号 → keygen → 公開鍵を返す。
// 呼出側は保存公開鍵との完全一致を確認してから利用する。
export interface PublicKeysFromSeedsRequest {
  vaultKey: CryptoKey
  identityId: string
  kem: {
    algorithm: "ML-KEM-768" | "ML-KEM-1024"
    keyId: string
    encryptedSeed: EncryptedSecret
    storedPublicKey: Uint8Array
  }
  signing: {
    algorithm: MlDsaAlgorithm
    keyId: string
    encryptedSeed: EncryptedSecret
    storedPublicKey: Uint8Array
  }
}

export interface PublicKeysFromSeedsResult {
  kemPublicKey: Uint8Array
  dsaPublicKey: Uint8Array
}

export interface SignWithSeedRequest {
  algorithm: MlDsaAlgorithm
  vaultKey: CryptoKey
  identityId: string
  keyId: string
  encryptedSeed: EncryptedSecret
  storedPublicKey: Uint8Array // 再生成公開鍵との一致検証(不一致は fail-closed)
  message: Uint8Array // signingTargetBytes(body)
}

export interface VerifyRequest {
  algorithm: MlDsaAlgorithm
  publicKey: Uint8Array
  message: Uint8Array
  signature: Uint8Array
}

// 暗号化(sign-then-encrypt 全体を Worker 内で実行。plan2.1 §C6 の順序):
// validate → (署名時)signBody → 内側 CBOR → Encaps → HKDF → AES-GCM(AAD)
// → ss/aes 素材 zeroize → envelope 返却
export interface EncryptPqMessageRequest {
  suite: WireSuite
  recipientKemKeyId: string
  recipientKemPublicKey: Uint8Array
  plaintext: Uint8Array
  messageId: Uint8Array // 16B CSPRNG(呼出側生成)
  createdAt: number
  sign?: {
    senderSigningKeyId: string
    algorithm: MlDsaAlgorithm
    vaultKey: CryptoKey
    identityId: string
    encryptedSeed: EncryptedSecret
    storedPublicKey: Uint8Array
  }
}

// 復号フェーズ 1(Decaps → HKDF → GCM 認証 → 内側 schema 検証):
//   unsigned suite → plaintext を返す
//   signed suite   → plaintext ではなく内側 SignedMessageV2 の正準バイトを返す
//     (orchestrator 私有。検証成功まで plaintext を構成しない — plan2.1 §C2)
export interface OpenPqEnvelopeRequest {
  envelope: MlKemMessageEnvelopeV2
  recipient: {
    identityId: string
    kemAlgorithm: "ML-KEM-768" | "ML-KEM-1024"
    kemKeyId: string
    encryptedKemSeed: EncryptedSecret
    storedKemPublicKey: Uint8Array
    vaultKey: CryptoKey
  }
}

export type OpenedPqEnvelope =
  | { kind: "unsigned"; plaintext: Uint8Array }
  | {
      kind: "signed"
      signedMessageBytes: Uint8Array
      senderSigningKeyId: string
      signatureAlgorithm: MlDsaAlgorithm
    }

// 復号フェーズ 2: 署名検証に成功した場合のみ plaintext を構成して返す。
// 失敗時は Worker 内で zeroize し、plaintext プロパティ自体を作らない。
export interface VerifySignedMessageRequest {
  signedMessageBytes: Uint8Array
  senderPublicKey: Uint8Array
  algorithm: MlDsaAlgorithm
}

export type VerifySignedMessageResult =
  | { valid: true; plaintext: Uint8Array }
  | { valid: false }

export interface PqCryptoClient {
  generateIdentityKeys(req: GenerateIdentityKeysRequest): Promise<GeneratedIdentityKeys>
  publicKeysFromSeeds(req: PublicKeysFromSeedsRequest): Promise<PublicKeysFromSeedsResult>
  signWithSeed(req: SignWithSeedRequest): Promise<Uint8Array>
  verify(req: VerifyRequest): Promise<boolean>
  encryptPqMessage(req: EncryptPqMessageRequest): Promise<MlKemMessageEnvelopeV2>
  openPqEnvelope(req: OpenPqEnvelopeRequest): Promise<OpenedPqEnvelope>
  verifySignedMessage(
    req: VerifySignedMessageRequest,
  ): Promise<VerifySignedMessageResult>
  // 進行中 RPC の破棄と Worker terminate(WipeCoordinator が使用。plan2.1 §B3)
  dispose(): void
}

export interface CreatePqCryptoClientOptions {
  // テスト用 seam。省略時は env.pqWorkerEnabled と実行環境から解決する
  timeoutMs?: number
}

export function createPqCryptoClient(
  options?: CreatePqCryptoClientOptions,
): PqCryptoClient {
  void options
  throw new Error("NOT_IMPLEMENTED: WP-11 createPqCryptoClient")
}
