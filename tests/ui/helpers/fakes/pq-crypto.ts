import { vi } from "vitest"
import type { DecryptPqMessageArgs } from "@/crypto/pq/decrypt-orchestrator"
import type {
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
  PqDecryptResult,
  PqPublicBundleRecord,
  PublicIdentityBundleV2,
} from "@/schemas/domain"
import { nextKeyCounter, resetFakeCounters } from "./counters"
import { defaultIdentity } from "./pq-fixtures"
import { registerFakeReset } from "./reset"
import { setLastPqEnvelope } from "./wire-state"

const encoder = new TextEncoder()
const disposePqClient = vi.fn()

export const createPqCryptoClient = vi.fn(() => ({
  dispose: disposePqClient,
}))

export const buildPublicBundle = vi.fn(
  (identity: PostQuantumIdentity): PublicIdentityBundleV2 => ({
    version: 2,
    type: "pq-public-identity",
    identityId: identity.id,
    name: identity.name,
    kem: {
      algorithm: identity.kem.algorithm,
      keyId: identity.kem.keyId,
      publicKey: identity.kem.publicKey,
    },
    signing: {
      algorithm: identity.signing.algorithm,
      keyId: identity.signing.keyId,
      publicKey: identity.signing.publicKey,
    },
    createdAt: identity.createdAt,
  }),
)

export const createIdentity = vi.fn(
  async ({ name, now }: { name: string; now: number }) => {
    const counter = nextKeyCounter()
    const identity = defaultIdentity()
    return {
      ...identity,
      id: `N${String(counter).padStart(21, "0")}`,
      name,
      kem: {
        ...identity.kem,
        keyId: `K${String(counter).padStart(21, "0")}`,
      },
      signing: {
        ...identity.signing,
        keyId: `S${String(counter).padStart(21, "0")}`,
      },
      createdAt: now,
    }
  },
)

export const rotateIdentity = vi.fn(
  async ({
    current,
    now,
  }: {
    current: PostQuantumIdentity
    now: number
  }) => ({
    previous: { ...current, status: "rotated" as const, rotatedAt: now },
    next: {
      ...(await createIdentity({ name: current.name, now })),
      rotatedFromId: current.id,
    },
  }),
)

export const pqKeyFingerprint = vi.fn(async (role: "kem" | "signing") =>
  (role === "kem" ? "7" : "8").repeat(64),
)
export const pqIdentityFingerprint = vi.fn(async () => "9".repeat(64))

export const encryptPq = vi.fn(
  async ({
    recipient,
    plaintext,
    sign,
    now,
  }: {
    recipient: PqPublicBundleRecord
    plaintext: Uint8Array
    sign: { identity: PostQuantumIdentity }
    now: number
  }) => {
    void now
    void sign
    const envelope: MlKemMessageEnvelopeV2 = {
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: recipient.kem.keyId,
      kemCiphertext: new Uint8Array(1568),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(plaintext.byteLength + 3_500),
    }
    setLastPqEnvelope(envelope)
    return envelope
  },
)

export const fakePqDecrypt = {
  kind: "signed-valid" as "signed-valid" | "signed-key-unknown",
}
export const fakePqMessageId = Uint8Array.from(
  { length: 16 },
  (_, index) => index,
)
export const fakePqCreatedAt = 1_723_000_000_000

async function defaultDecryptPqMessage(
  args: DecryptPqMessageArgs,
): Promise<PqDecryptResult> {
  const senderSigningKeyId = "T".repeat(22)
  const resolvedSigningKey = await args.resolveSigningKey(senderSigningKeyId)
  if (
    fakePqDecrypt.kind === "signed-key-unknown" ||
    resolvedSigningKey === undefined ||
    resolvedSigningKey.revoked
  ) {
    return { kind: "signed-key-unknown" as const, senderSigningKeyId }
  }
  return {
    kind: "signed-valid",
    plaintext: encoder.encode("署名済みPQ復号結果"),
    messageId: fakePqMessageId.slice(),
    createdAt: fakePqCreatedAt,
    senderSigningKeyId,
  }
}

export const decryptPqMessage = vi.fn(defaultDecryptPqMessage)

registerFakeReset(() => {
  fakePqDecrypt.kind = "signed-valid"
  decryptPqMessage.mockImplementation(defaultDecryptPqMessage)
  resetFakeCounters()
})
