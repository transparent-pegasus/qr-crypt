// Signed-decryption orchestrator.
//
// Flow (frozen):
//   openPqEnvelope (Worker: Decaps → HKDF → successful GCM authentication
//   → inner-schema validation)
//   → unsigned suite: {kind:"unsigned", plaintext}
//   → signed suite: resolveSigningKey by the inner senderSigningKeyId (repository lookup)
//     → unknown key: {kind:"signed-key-unknown", senderSigningKeyId}
//       (do not construct plaintext; zeroize in the Worker; continue to the signing-key
//       import path)
//     → known key: verifySignedMessage → {kind:"signed-valid", ...} only on success
//       failure: AppError("SIGNATURE_INVALID") (do not display plaintext)
//
// Cross-binding: compare the outer suite, the recipient identity's
// algorithm and keyId,
// inner body.recipientKemKeyId / signature.algorithm / body.senderSigningKeyId /
// the resolved public key, and key lengths. Any mismatch is DECRYPTION_FAILED.
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import type {
  MlDsaAlgorithm,
  PostQuantumIdentity,
  MlKemMessageEnvelopeV2,
  PqDecryptResult,
} from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import { assertActiveSuite, suiteComponents } from "@/crypto/pq/suites"
import { zeroize } from "@/crypto/pq/zeroize"

export interface ResolvedSigningKey {
  algorithm: MlDsaAlgorithm
  publicKey: Uint8Array
  // Revocation state of the imported record. Do not use revoked keys even for
  // verification; treat them as unknown.
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
  assertActiveSuite(args.envelope.suite)
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
