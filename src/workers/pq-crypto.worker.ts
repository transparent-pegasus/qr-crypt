// PQ cryptographic Worker RPC host.
// Hold the synchronous provider (provider-noble) only inside this Worker.
// Never return secret material (seeds, expanded secret keys, shared secrets, or derived
// key bytes) through postMessage; zeroize it in each operation's finally block.
import { AppError, type ErrorCode } from "@/crypto/errors"
import {
  decodeSignedMessageV2,
  encodeMlKemAadV2,
  encodeSignedMessageV2,
} from "@/crypto/pq/canonical-cbor"
import { generateDsaSeed, generateKemSeed } from "@/crypto/pq/key-seeds"
import { signBody, verifySignedBody } from "@/crypto/pq/ml-dsa-signature"
import { resolveProviders } from "@/crypto/pq/provider"
import { PQ_PROFILES } from "@/crypto/pq/profiles"
import { suiteComponents } from "@/crypto/pq/suites"
import {
  type PqWorkerOperation,
  type PqWorkerRpcRequest,
  type PqWorkerRpcResponse,
  validatePqWorkerRequest,
} from "@/crypto/pq/worker-client"
import type {
  EncryptPqMessageRequest,
  GenerateIdentityKeysRequest,
  GeneratedIdentityKeys,
  OpenedPqEnvelope,
  OpenPqEnvelopeRequest,
  PublicKeysFromSeedsRequest,
  PublicKeysFromSeedsResult,
  SignWithSeedRequest,
  VerifyRequest,
  VerifySignedMessageRequest,
  VerifySignedMessageResult,
} from "@/crypto/pq/worker-client"
import { zeroize } from "@/crypto/pq/zeroize"
import { hkdfInfoV2, mlDsaContextV2 } from "@/crypto/pq/wire-bytes"
import { randomBytes } from "@/crypto/random"
import { decryptSecret } from "@/crypto/vault/decrypt-secret"
import { encryptSecret } from "@/crypto/vault/encrypt-secret"
import { bytesEqual, sha256, toOwnedArrayBuffer } from "@/lib/bytes"
import { HKDF_SALT_BYTES, IV_BYTES } from "@/lib/limits"
import type {
  EncryptedSecret,
  SignedMessageBodyV2,
} from "@/schemas/domain"

const providers = resolveProviders("noble")

type IdentityKeyStage = "seed" | "keygen" | "public-key-digest" | "seed-encryption"

// Every failure inside an operation collapses to one public code (sanitizedCode),
// which is the right boundary but leaves a failing run unable to say which stage
// broke: a CSPRNG fault, noble keygen, SHA-256 and AES-GCM all arrive as
// ENCRYPTION_FAILED, and the two innermost of those are already sanitized before
// this frame sees them. Emit the stage under the test build only, and only
// allowlisted values: the stage label plus the error's class name or AppError
// code. Never the message, stack, cause, request payload or any byte array —
// docs/security/security-review.md forbids those on every surface, console included, and
// MODE is "test" only under vitest, so neither a production build nor a
// `vite dev` session with real key material can reach this.
function reportStage(stage: IdentityKeyStage, error: unknown): void {
  if (import.meta.env.MODE !== "test") return
  const kind =
    error instanceof AppError
      ? `AppError:${error.code}`
      : error instanceof Error
        ? error.name
        : typeof error
  console.error("[pq-worker-stage]", "generateIdentityKeys", stage, kind)
}

async function deriveMessageKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    toOwnedArrayBuffer(sharedSecret),
    "HKDF",
    false,
    ["deriveKey"],
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toOwnedArrayBuffer(salt),
      info: toOwnedArrayBuffer(info),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  if (key.extractable || key.type !== "secret") {
    throw new AppError("ENCRYPTION_FAILED")
  }
  return key
}

async function generateIdentityKeys(
  request: GenerateIdentityKeysRequest,
): Promise<GeneratedIdentityKeys> {
  const profile = PQ_PROFILES[request.profile]
  const kem = providers.kem1024
  const dsa = providers.dsa87
  let kemSeed: Uint8Array | undefined
  let dsaSeed: Uint8Array | undefined
  let kemSecretKey: Uint8Array | undefined
  let dsaSecretKey: Uint8Array | undefined
  let stage: IdentityKeyStage = "seed"
  try {
    // Independent CSPRNG calls. Sharing a seed between KEM and DSA is prohibited.
    kemSeed = generateKemSeed()
    dsaSeed = generateDsaSeed()
    stage = "keygen"
    const kemKeys = kem.keygen(kemSeed)
    const dsaKeys = dsa.keygen(dsaSeed)
    kemSecretKey = kemKeys.secretKey
    dsaSecretKey = dsaKeys.secretKey
    stage = "public-key-digest"
    const [kemPublicKeySha256, dsaPublicKeySha256] = await Promise.all([
      sha256(kemKeys.publicKey),
      sha256(dsaKeys.publicKey),
    ])
    stage = "seed-encryption"
    // allSettled, not all: `all` rejects on the first failure while the sibling
    // encryption is still inside crypto.subtle, so the handler would return and
    // the finally would zeroize with an operation still in flight, and a second
    // rejection would surface as an unhandled rejection.
    const encrypted = await Promise.allSettled([
      encryptSecret({
        vaultKey: request.vaultKey,
        plaintextSecret: kemSeed,
        aad: {
          identityId: request.identityId,
          role: "ml-kem-seed",
          algorithm: profile.kem.algorithm,
          keyId: request.kemKeyId,
          publicKeySha256: kemPublicKeySha256,
        },
      }),
      encryptSecret({
        vaultKey: request.vaultKey,
        plaintextSecret: dsaSeed,
        aad: {
          identityId: request.identityId,
          role: "ml-dsa-seed",
          algorithm: profile.signature.algorithm,
          keyId: request.signingKeyId,
          publicKeySha256: dsaPublicKeySha256,
        },
      }),
    ])
    const rejected = encrypted.find((result) => result.status === "rejected")
    if (rejected !== undefined) throw rejected.reason
    const [encryptedKemSeed, encryptedDsaSeed] = encrypted.map(
      (result) => (result as PromiseFulfilledResult<EncryptedSecret>).value,
    ) as [EncryptedSecret, EncryptedSecret]
    return {
      kem: {
        publicKey: Uint8Array.from(kemKeys.publicKey),
        encryptedSeed: encryptedKemSeed,
      },
      signing: {
        publicKey: Uint8Array.from(dsaKeys.publicKey),
        encryptedSeed: encryptedDsaSeed,
      },
    }
  } catch (error) {
    reportStage(stage, error)
    throw error
  } finally {
    zeroize(kemSeed, dsaSeed, kemSecretKey, dsaSecretKey)
  }
}

async function publicKeysFromSeeds(
  request: PublicKeysFromSeedsRequest,
): Promise<PublicKeysFromSeedsResult> {
  const kem = providers.kem1024
  const dsa = providers.dsa87
  let kemSeed: Uint8Array | undefined
  let dsaSeed: Uint8Array | undefined
  let kemSecretKey: Uint8Array | undefined
  let dsaSecretKey: Uint8Array | undefined
  try {
    const [kemPublicKeySha256, dsaPublicKeySha256] = await Promise.all([
      sha256(request.kem.storedPublicKey),
      sha256(request.signing.storedPublicKey),
    ])
    ;[kemSeed, dsaSeed] = await Promise.all([
      decryptSecret({
        vaultKey: request.vaultKey,
        secret: request.kem.encryptedSeed,
        aad: {
          identityId: request.identityId,
          role: "ml-kem-seed",
          algorithm: request.kem.algorithm,
          keyId: request.kem.keyId,
          publicKeySha256: kemPublicKeySha256,
        },
      }),
      decryptSecret({
        vaultKey: request.vaultKey,
        secret: request.signing.encryptedSeed,
        aad: {
          identityId: request.identityId,
          role: "ml-dsa-seed",
          algorithm: request.signing.algorithm,
          keyId: request.signing.keyId,
          publicKeySha256: dsaPublicKeySha256,
        },
      }),
    ])
    const kemKeys = kem.keygen(kemSeed)
    const dsaKeys = dsa.keygen(dsaSeed)
    kemSecretKey = kemKeys.secretKey
    dsaSecretKey = dsaKeys.secretKey
    if (
      !bytesEqual(kemKeys.publicKey, request.kem.storedPublicKey) ||
      !bytesEqual(dsaKeys.publicKey, request.signing.storedPublicKey)
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }
    return {
      kemPublicKey: Uint8Array.from(kemKeys.publicKey),
      dsaPublicKey: Uint8Array.from(dsaKeys.publicKey),
    }
  } finally {
    zeroize(kemSeed, dsaSeed, kemSecretKey, dsaSecretKey)
  }
}

async function signWithSeed(request: SignWithSeedRequest): Promise<Uint8Array> {
  const provider = providers.dsa87
  let seed: Uint8Array | undefined
  let secretKey: Uint8Array | undefined
  try {
    seed = await decryptSecret({
      vaultKey: request.vaultKey,
      secret: request.encryptedSeed,
      aad: {
        identityId: request.identityId,
        role: "ml-dsa-seed",
        algorithm: request.algorithm,
        keyId: request.keyId,
        publicKeySha256: await sha256(request.storedPublicKey),
      },
    })
    const generated = provider.keygen(seed)
    secretKey = generated.secretKey
    if (!bytesEqual(generated.publicKey, request.storedPublicKey)) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    return provider.sign(request.message, secretKey, mlDsaContextV2())
  } finally {
    zeroize(seed, secretKey)
  }
}

function verify(request: VerifyRequest): boolean {
  return providers.dsa87.verify(
    request.signature,
    request.message,
    request.publicKey,
    mlDsaContextV2(),
  )
}

async function encryptPqMessage(
  request: EncryptPqMessageRequest,
): Promise<import("@/schemas/domain").MlKemMessageEnvelopeV2> {
  const components = suiteComponents(request.suite)
  const kem = providers.kem1024
  const plaintext = Uint8Array.from(request.plaintext)
  let signingSeed: Uint8Array | undefined
  let signingSecretKey: Uint8Array | undefined
  let signatureValue: Uint8Array | undefined
  let innerBytes: Uint8Array | undefined
  let sharedSecret: Uint8Array | undefined
  let hkdfInfo: Uint8Array | undefined
  try {
    const sign = request.sign
    if (sign.algorithm !== components.signature) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    const provider = providers.dsa87
    signingSeed = await decryptSecret({
      vaultKey: sign.vaultKey,
      secret: sign.encryptedSeed,
      aad: {
        identityId: sign.identityId,
        role: "ml-dsa-seed",
        algorithm: sign.algorithm,
        keyId: sign.senderSigningKeyId,
        publicKeySha256: await sha256(sign.storedPublicKey),
      },
    })
    const generated = provider.keygen(signingSeed)
    signingSecretKey = generated.secretKey
    if (!bytesEqual(generated.publicKey, sign.storedPublicKey)) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    const body: SignedMessageBodyV2 = {
      version: 2,
      messageId: Uint8Array.from(request.messageId),
      createdAt: request.createdAt,
      recipientKemKeyId: request.recipientKemKeyId,
      plaintext,
      senderSigningKeyId: sign.senderSigningKeyId,
    }
    const signature = signBody({ provider, body, secretKey: signingSecretKey })
    signatureValue = signature.value
    innerBytes = encodeSignedMessageV2({ body, signature })

    const encapsulated = kem.encapsulate(request.recipientKemPublicKey)
    sharedSecret = encapsulated.sharedSecret
    const hkdfSalt = randomBytes(HKDF_SALT_BYTES)
    const iv = randomBytes(IV_BYTES)
    hkdfInfo = hkdfInfoV2(request.suite, request.recipientKemKeyId)
    const aesKey = await deriveMessageKey(sharedSecret, hkdfSalt, hkdfInfo)
    const additionalData = encodeMlKemAadV2({
      version: 2,
      type: "pq-message",
      suite: request.suite,
      recipientKemKeyId: request.recipientKemKeyId,
      kemCiphertextSha256: await sha256(encapsulated.ciphertext),
    })
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(iv),
          additionalData: toOwnedArrayBuffer(additionalData),
          tagLength: 128,
        },
        aesKey,
        toOwnedArrayBuffer(innerBytes),
      ),
    )
    return {
      version: 2,
      type: "pq-message",
      suite: request.suite,
      recipientKemKeyId: request.recipientKemKeyId,
      kemCiphertext: Uint8Array.from(encapsulated.ciphertext),
      hkdfSalt,
      iv,
      ciphertext,
    }
  } finally {
    zeroize(
      plaintext,
      signingSeed,
      signingSecretKey,
      signatureValue,
      innerBytes,
      sharedSecret,
      hkdfInfo,
    )
  }
}

async function openPqEnvelope(request: OpenPqEnvelopeRequest): Promise<OpenedPqEnvelope> {
  const { envelope, recipient } = request
  const components = suiteComponents(envelope.suite)
  const kem = providers.kem1024
  let seed: Uint8Array | undefined
  let secretKey: Uint8Array | undefined
  let sharedSecret: Uint8Array | undefined
  let hkdfInfo: Uint8Array | undefined
  let decrypted: Uint8Array | undefined
  let parsedPlaintext: Uint8Array | undefined
  let parsedSignature: Uint8Array | undefined
  try {
    if (
      recipient.kemAlgorithm !== components.kem ||
      recipient.kemKeyId !== envelope.recipientKemKeyId
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }
    seed = await decryptSecret({
      vaultKey: recipient.vaultKey,
      secret: recipient.encryptedKemSeed,
      aad: {
        identityId: recipient.identityId,
        role: "ml-kem-seed",
        algorithm: recipient.kemAlgorithm,
        keyId: recipient.kemKeyId,
        publicKeySha256: await sha256(recipient.storedKemPublicKey),
      },
    })
    const generated = kem.keygen(seed)
    secretKey = generated.secretKey
    if (!bytesEqual(generated.publicKey, recipient.storedKemPublicKey)) {
      throw new AppError("DECRYPTION_FAILED")
    }
    sharedSecret = kem.decapsulate(envelope.kemCiphertext, secretKey)
    hkdfInfo = hkdfInfoV2(envelope.suite, envelope.recipientKemKeyId)
    const aesKey = await deriveMessageKey(sharedSecret, envelope.hkdfSalt, hkdfInfo)
    const additionalData = encodeMlKemAadV2({
      version: 2,
      type: "pq-message",
      suite: envelope.suite,
      recipientKemKeyId: envelope.recipientKemKeyId,
      kemCiphertextSha256: await sha256(envelope.kemCiphertext),
    })
    decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(envelope.iv),
          additionalData: toOwnedArrayBuffer(additionalData),
          tagLength: 128,
        },
        aesKey,
        toOwnedArrayBuffer(envelope.ciphertext),
      ),
    )

    const signed = decodeSignedMessageV2(decrypted)
    parsedPlaintext = signed.body.plaintext
    parsedSignature = signed.signature.value
    if (
      signed.body.recipientKemKeyId !== envelope.recipientKemKeyId ||
      signed.signature.algorithm !== components.signature
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }
    return {
      kind: "signed",
      signedMessageBytes: Uint8Array.from(decrypted),
      senderSigningKeyId: signed.body.senderSigningKeyId,
      signatureAlgorithm: signed.signature.algorithm,
    }
  } finally {
    zeroize(
      seed,
      secretKey,
      sharedSecret,
      hkdfInfo,
      decrypted,
      parsedPlaintext,
      parsedSignature,
    )
  }
}

function verifySignedMessage(
  request: VerifySignedMessageRequest,
): VerifySignedMessageResult {
  const encoded = Uint8Array.from(request.signedMessageBytes)
  let plaintext: Uint8Array | undefined
  let signatureBytes: Uint8Array | undefined
  try {
    const signed = decodeSignedMessageV2(encoded)
    plaintext = signed.body.plaintext
    signatureBytes = signed.signature.value
    if (signed.signature.algorithm !== request.algorithm) return { valid: false }
    const valid = verifySignedBody({
      provider: providers.dsa87,
      body: signed.body,
      signature: signed.signature,
      senderPublicKey: request.senderPublicKey,
    })
    return valid
      ? {
          valid: true,
          plaintext: Uint8Array.from(signed.body.plaintext),
          messageId: Uint8Array.from(signed.body.messageId),
          createdAt: signed.body.createdAt,
        }
      : { valid: false }
  } catch {
    return { valid: false }
  } finally {
    zeroize(encoded, plaintext, signatureBytes)
  }
}

function fallbackCode(operation: PqWorkerOperation): ErrorCode {
  switch (operation) {
    case "generateIdentityKeys":
    case "signWithSeed":
    case "encryptPqMessage":
      return "ENCRYPTION_FAILED"
    case "publicKeysFromSeeds":
    case "openPqEnvelope":
      return "DECRYPTION_FAILED"
    case "verify":
    case "verifySignedMessage":
      return "SIGNATURE_INVALID"
  }
}

function sanitizedCode(error: unknown, operation: PqWorkerOperation): ErrorCode {
  // Collapse failures into public errors for each RPC operation without exposing
  // internal CBOR/WebCrypto/noble stages to the caller. Only a signature mismatch
  // becomes a public verification error code.
  if (error instanceof AppError && error.code === "UNSUPPORTED_ALGORITHM") {
    return error.code
  }
  return fallbackCode(operation)
}

function isOperation(value: unknown): value is PqWorkerOperation {
  return (
    value === "generateIdentityKeys" ||
    value === "publicKeysFromSeeds" ||
    value === "signWithSeed" ||
    value === "verify" ||
    value === "encryptPqMessage" ||
    value === "openPqEnvelope" ||
    value === "verifySignedMessage"
  )
}

export async function handlePqWorkerRequest(
  request: PqWorkerRpcRequest,
): Promise<PqWorkerRpcResponse> {
  const id =
    typeof request?.id === "string" && request.id.length <= 128 ? request.id : "invalid"
  if (!isOperation(request?.operation)) {
    return { id, ok: false, code: "WORKER_UNAVAILABLE" }
  }
  const operation = request.operation
  try {
    validatePqWorkerRequest(operation, request.payload)
    let value: unknown
    switch (operation) {
      case "generateIdentityKeys":
        value = await generateIdentityKeys(request.payload as GenerateIdentityKeysRequest)
        break
      case "publicKeysFromSeeds":
        value = await publicKeysFromSeeds(request.payload as PublicKeysFromSeedsRequest)
        break
      case "signWithSeed":
        value = await signWithSeed(request.payload as SignWithSeedRequest)
        break
      case "verify":
        value = verify(request.payload as VerifyRequest)
        break
      case "encryptPqMessage":
        value = await encryptPqMessage(request.payload as EncryptPqMessageRequest)
        break
      case "openPqEnvelope":
        value = await openPqEnvelope(request.payload as OpenPqEnvelopeRequest)
        break
      case "verifySignedMessage":
        value = verifySignedMessage(request.payload as VerifySignedMessageRequest)
        break
    }
    return { id, ok: true, value }
  } catch (error) {
    return { id, ok: false, code: sanitizedCode(error, operation) }
  }
}

function exactOwnedBuffer(view: Uint8Array): ArrayBuffer | undefined {
  if (
    view.buffer instanceof ArrayBuffer &&
    view.byteOffset === 0 &&
    view.byteLength === view.buffer.byteLength
  ) {
    return view.buffer
  }
  return undefined
}

// Do not transfer secret results (plaintext / signedMessageBytes). Transfer only
// exact-length owned ArrayBuffers containing public artifacts.
function publicTransferables(
  operation: PqWorkerOperation,
  response: PqWorkerRpcResponse,
): Transferable[] {
  if (!response.ok || typeof response.value !== "object" || response.value === null) {
    return []
  }
  const value = response.value as Record<string, unknown>
  const views: Uint8Array[] = []
  if (operation === "generateIdentityKeys") {
    const kem = value["kem"] as Record<string, unknown> | undefined
    const signing = value["signing"] as Record<string, unknown> | undefined
    if (kem?.["publicKey"] instanceof Uint8Array) views.push(kem["publicKey"])
    if (signing?.["publicKey"] instanceof Uint8Array) views.push(signing["publicKey"])
  } else if (operation === "publicKeysFromSeeds") {
    if (value["kemPublicKey"] instanceof Uint8Array) views.push(value["kemPublicKey"])
    if (value["dsaPublicKey"] instanceof Uint8Array) views.push(value["dsaPublicKey"])
  } else if (operation === "signWithSeed" && response.value instanceof Uint8Array) {
    views.push(response.value)
  } else if (operation === "encryptPqMessage") {
    for (const key of ["kemCiphertext", "hkdfSalt", "iv", "ciphertext"] as const) {
      if (value[key] instanceof Uint8Array) views.push(value[key])
    }
  }
  const buffers = new Set<ArrayBuffer>()
  for (const view of views) {
    const buffer = exactOwnedBuffer(view)
    if (buffer !== undefined) buffers.add(buffer)
  }
  return [...buffers]
}

interface WorkerScopeLike {
  document?: unknown
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PqWorkerRpcRequest>) => void,
  ): void
  postMessage(message: PqWorkerRpcResponse, transfer: Transferable[]): void
}

const possibleWorkerScope = globalThis as unknown as Partial<WorkerScopeLike>
if (
  possibleWorkerScope.document === undefined &&
  typeof possibleWorkerScope.addEventListener === "function" &&
  typeof possibleWorkerScope.postMessage === "function"
) {
  const workerScope = possibleWorkerScope as WorkerScopeLike
  workerScope.addEventListener("message", (event) => {
    void handlePqWorkerRequest(event.data).then((response) => {
      const operation = isOperation(event.data?.operation)
        ? event.data.operation
        : "verify"
      workerScope.postMessage(response, publicTransferables(operation, response))
    })
  })
}
