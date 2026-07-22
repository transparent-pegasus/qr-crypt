import type { MlDsaAlgorithm, MlKemAlgorithm } from "@/schemas/domain"
import {
  encodeMlKemEnvelopeV2,
  encodeSignedMessageV2,
  encodeUnsignedMessageBodyV2,
} from "@/crypto/pq/canonical-cbor"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import { resolveSuite } from "@/crypto/pq/suites"
import { splitIntoFrames } from "@/qr/multipart/split"

export interface PqSizeBreakdown {
  plaintextBytes: number
  kemCiphertextBytes: number
  signatureBytes: number
  envelopeBytes: number
  frameCount: number
}

export async function measurePqEnvelopeSize(args: {
  plaintext: Uint8Array
  kemAlgorithm: MlKemAlgorithm
  recipientKemKeyId: string
  signingAlgorithm?: MlDsaAlgorithm
  senderSigningKeyId?: string
  frameBytes: number
  createdAt?: number
}): Promise<PqSizeBreakdown> {
  const createdAt = args.createdAt ?? 1_700_000_000_000
  const common = {
    version: 2 as const,
    messageId: new Uint8Array(16),
    createdAt,
    recipientKemKeyId: args.recipientKemKeyId,
    plaintext: args.plaintext,
  }
  const signatureBytes =
    args.signingAlgorithm === undefined
      ? 0
      : DSA_SIZES[args.signingAlgorithm].signatureBytes
  const innerBytes =
    args.signingAlgorithm === undefined
      ? encodeUnsignedMessageBodyV2(common)
      : encodeSignedMessageV2({
          body: {
            ...common,
            senderSigningKeyId: args.senderSigningKeyId ?? "A".repeat(22),
          },
          signature: {
            algorithm: args.signingAlgorithm,
            value: new Uint8Array(signatureBytes),
          },
        })
  const kemCiphertextBytes = KEM_SIZES[args.kemAlgorithm].ciphertextBytes
  const envelopeBytes = encodeMlKemEnvelopeV2({
    version: 2,
    type: "pq-message",
    suite: resolveSuite(args.kemAlgorithm, args.signingAlgorithm),
    recipientKemKeyId: args.recipientKemKeyId,
    kemCiphertext: new Uint8Array(kemCiphertextBytes),
    hkdfSalt: new Uint8Array(32),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(innerBytes.byteLength + 16),
  })
  const frames = await splitIntoFrames({
    artifactType: "pq-message",
    artifactBytes: envelopeBytes,
    frameBytes: args.frameBytes,
  })
  return {
    plaintextBytes: args.plaintext.byteLength,
    kemCiphertextBytes,
    signatureBytes,
    envelopeBytes: envelopeBytes.byteLength,
    frameCount: frames.length,
  }
}
