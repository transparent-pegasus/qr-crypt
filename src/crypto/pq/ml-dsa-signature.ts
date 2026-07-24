// ML-DSA signatures. The signing target is canonical CBOR for
// SignedMessageBodyV2 (canonical-cbor.signingTargetBytes), with context fixed to
// mlDsaContextV2(). This module calls the synchronous provider directly and is therefore
// limited to the Worker and Node tests; never import it on the browser main thread.
import type { MlDsaProvider } from "@/crypto/pq/provider"
import type { MlDsaAlgorithm, SignedMessageBodyV2 } from "@/schemas/domain"
import { signingTargetBytes } from "@/crypto/pq/canonical-cbor"
import { mlDsaContextV2 } from "@/crypto/pq/wire-bytes"
import { zeroize } from "@/crypto/pq/zeroize"

export interface SignBodyArgs {
  provider: MlDsaProvider
  body: SignedMessageBodyV2
  secretKey: Uint8Array // Caller re-expands it from the seed and zeroizes it after the call.
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

// Return only the verification result. When false, the caller must not display plaintext.
// A false result maps to SIGNATURE_INVALID.
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
