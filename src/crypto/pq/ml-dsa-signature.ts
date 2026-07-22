// ML-DSA 署名(spec2 §6、WP-11)。署名対象は SignedMessageBodyV2 の正準 CBOR
// (canonical-cbor.signingTargetBytes)。コンテキストは mlDsaContextV2() 固定。
// 本モジュールは同期プロバイダーを直接使うため Worker / Node テスト専用
// (plan2.1 §F — ブラウザー main thread から import してはならない)。
import type { MlDsaProvider } from "@/crypto/pq/provider"
import type { MlDsaAlgorithm, SignedMessageBodyV2 } from "@/schemas/domain"
import { signingTargetBytes } from "@/crypto/pq/canonical-cbor"
import { mlDsaContextV2 } from "@/crypto/pq/wire-bytes"
import { zeroize } from "@/crypto/pq/zeroize"

export interface SignBodyArgs {
  provider: MlDsaProvider
  body: SignedMessageBodyV2
  secretKey: Uint8Array // 呼出側がシードから再展開し、呼出後に zeroize する
}

export interface SignedBodyResult {
  algorithm: MlDsaAlgorithm
  value: Uint8Array
}

export function signBody(args: SignBodyArgs): SignedBodyResult {
  const target = signingTargetBytes(args.body)
  try {
    return {
      algorithm: args.provider.algorithm,
      value: args.provider.sign(target, args.secretKey, mlDsaContextV2()),
    }
  } finally {
    zeroize(target)
  }
}

export interface VerifySignedBodyArgs {
  provider: MlDsaProvider
  body: SignedMessageBodyV2
  signature: SignedBodyResult
  senderPublicKey: Uint8Array
}

// 検証結果のみを返す。false のとき呼出側は plaintext を表示してはならない
// (SIGNATURE_INVALID。spec2 §20)。
export function verifySignedBody(args: VerifySignedBodyArgs): boolean {
  if (args.signature.algorithm !== args.provider.algorithm) return false
  const target = signingTargetBytes(args.body)
  try {
    return args.provider.verify(
      args.signature.value,
      target,
      args.senderPublicKey,
      mlDsaContextV2(),
    )
  } catch {
    return false
  } finally {
    zeroize(target)
  }
}
