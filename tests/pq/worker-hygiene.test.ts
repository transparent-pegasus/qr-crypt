import { describe, expect, it } from "vitest"
import { encodeSignedMessageV2 } from "@/crypto/pq/canonical-cbor"
import { signBody } from "@/crypto/pq/ml-dsa-signature"
import { createNobleDsa87, createNobleKem1024 } from "@/crypto/pq/provider-noble"
import type {
  EncryptPqMessageRequest,
  VerifySignedMessageRequest,
} from "@/crypto/pq/worker-client"
import { zeroize } from "@/crypto/pq/zeroize"
import { buildVaultAadV2 } from "@/crypto/pq/wire-bytes"
import { toBase64Url } from "@/lib/base64url"
import { sha256, toOwnedArrayBuffer } from "@/lib/bytes"
import type { EncryptedSecret, SignedMessageBodyV2 } from "@/schemas/domain"
import {
  handlePqWorkerRequest,
  wipeNonTransferred,
} from "@/workers/pq-crypto.worker"

const IDENTITY_ID = toBase64Url(new Uint8Array(16).fill(0x11))
const KEM_KEY_ID = toBase64Url(new Uint8Array(16).fill(0x22))
const SIGNING_KEY_ID = toBase64Url(new Uint8Array(16).fill(0x33))
const KEM_SEED = new Uint8Array(64).map((_, index) => index)
const DSA_SEED = new Uint8Array(32).map((_, index) => 0x80 + index)
const MESSAGE_ID = new Uint8Array(16).fill(0x55)
const CREATED_AT = 1_700_000_000_123

async function fixedVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(0x99),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  )
}

async function encryptFixedSeed(args: {
  key: CryptoKey
  seed: Uint8Array
  ivByte: number
  aad: Parameters<typeof buildVaultAadV2>[0]
}): Promise<EncryptedSecret> {
  const iv = new Uint8Array(12).fill(args.ivByte)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toOwnedArrayBuffer(iv),
        additionalData: toOwnedArrayBuffer(buildVaultAadV2(args.aad)),
        tagLength: 128,
      },
      args.key,
      toOwnedArrayBuffer(args.seed),
    ),
  )
  return { iv, ciphertext }
}

async function buildEncryptRequest(): Promise<EncryptPqMessageRequest> {
  const kemKeys = createNobleKem1024().keygen(KEM_SEED)
  const signingKeys = createNobleDsa87().keygen(DSA_SEED)
  try {
    const vaultKey = await fixedVaultKey()
    const encryptedSeed = await encryptFixedSeed({
      key: vaultKey,
      seed: DSA_SEED,
      ivByte: 0x62,
      aad: {
        identityId: IDENTITY_ID,
        role: "ml-dsa-seed",
        algorithm: "ML-DSA-87",
        keyId: SIGNING_KEY_ID,
        publicKeySha256: await sha256(signingKeys.publicKey),
      },
    })
    return {
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: KEM_KEY_ID,
      recipientKemPublicKey: Uint8Array.from(kemKeys.publicKey),
      plaintext: new TextEncoder().encode("fixed composition plaintext"),
      messageId: Uint8Array.from(MESSAGE_ID),
      createdAt: CREATED_AT,
      sign: {
        senderSigningKeyId: SIGNING_KEY_ID,
        algorithm: "ML-DSA-87",
        vaultKey,
        identityId: IDENTITY_ID,
        encryptedSeed,
        storedPublicKey: Uint8Array.from(signingKeys.publicKey),
      },
    }
  } finally {
    zeroize(kemKeys.secretKey, signingKeys.secretKey)
  }
}

function buildVerifySignedMessageRequest(): VerifySignedMessageRequest {
  const dsa = createNobleDsa87()
  const signingKeys = dsa.keygen(DSA_SEED)
  const body: SignedMessageBodyV2 = {
    version: 2,
    messageId: Uint8Array.from(MESSAGE_ID),
    createdAt: CREATED_AT,
    recipientKemKeyId: KEM_KEY_ID,
    plaintext: new TextEncoder().encode("fixed composition plaintext"),
    senderSigningKeyId: SIGNING_KEY_ID,
  }
  const signature = signBody({
    provider: dsa,
    body,
    secretKey: signingKeys.secretKey,
  })
  try {
    return {
      signedMessageBytes: encodeSignedMessageV2({ body, signature }),
      senderPublicKey: Uint8Array.from(signingKeys.publicKey),
      algorithm: "ML-DSA-87",
    }
  } finally {
    zeroize(signingKeys.secretKey, body.plaintext, signature.value)
  }
}

describe("PQ worker hygiene", () => {
  it("zeroes the encrypt request plaintext after a successful call", async () => {
    const request = await buildEncryptRequest()
    const plaintext = request.plaintext
    const response = await handlePqWorkerRequest({
      id: "h1",
      operation: "encryptPqMessage",
      payload: request,
    })
    expect(response.ok).toBe(true)
    expect(plaintext.every((b) => b === 0)).toBe(true)
  })

  it("zeroes the encrypt request plaintext when the operation fails", async () => {
    const request = await buildEncryptRequest()
    request.sign.storedPublicKey[0] = request.sign.storedPublicKey[0]! ^ 0xff
    const plaintext = request.plaintext
    const response = await handlePqWorkerRequest({
      id: "h2",
      operation: "encryptPqMessage",
      payload: request,
    })
    expect(response.ok).toBe(false)
    expect(plaintext.every((b) => b === 0)).toBe(true)
  })

  it("zeroes the verifySignedMessage request bytes after the call", async () => {
    const request = buildVerifySignedMessageRequest()
    const bytes = request.signedMessageBytes
    const response = await handlePqWorkerRequest({
      id: "h3",
      operation: "verifySignedMessage",
      payload: request,
    })
    expect(response.ok).toBe(true)
    expect(bytes.every((b) => b === 0)).toBe(true)
  })

  it("wipeNonTransferred zeroes response arrays whose buffers were not transferred", () => {
    const kept = new Uint8Array([1, 2, 3])
    const moved = new Uint8Array([4, 5, 6])
    const response = { id: "h4", ok: true as const, value: { a: kept, b: moved } }
    wipeNonTransferred(response, [moved.buffer])
    expect(kept.every((b) => b === 0)).toBe(true)
    expect(moved.every((b) => b === 0)).toBe(false)
  })
})
