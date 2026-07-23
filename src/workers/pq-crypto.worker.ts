// PQ 暗号 Worker RPC ホスト(spec2 §4、WP-11)。
// 同期プロバイダー(provider-noble)は本 Worker 内でのみ保持する。
// 秘密素材(seed / 展開済み秘密鍵 / 共有秘密 / 導出鍵バイト)は
// postMessage で外へ返さず、各操作の finally で zeroize する(plan2.1 §F)。
import { AppError, type ErrorCode } from "@/crypto/errors"
import {
  decodeSignedMessageV2,
  decodeUnsignedMessageBodyV2,
  encodeMlKemAadV2,
  encodeSignedMessageV2,
  encodeUnsignedMessageBodyV2,
} from "@/crypto/pq/canonical-cbor"
import { generateDsaSeed, generateKemSeed } from "@/crypto/pq/key-seeds"
import { signBody, verifySignedBody } from "@/crypto/pq/ml-dsa-signature"
import type { MlDsaProvider, MlKemProvider } from "@/crypto/pq/provider"
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
  MlDsaAlgorithm,
  MlKemAlgorithm,
  SignedMessageBodyV2,
} from "@/schemas/domain"

const providers = resolveProviders("noble")

function kemProvider(algorithm: MlKemAlgorithm): MlKemProvider {
  return algorithm === "ML-KEM-768" ? providers.kem768 : providers.kem1024
}

function dsaProvider(algorithm: MlDsaAlgorithm): MlDsaProvider {
  return algorithm === "ML-DSA-65" ? providers.dsa65 : providers.dsa87
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
  const kem = kemProvider(profile.kem.algorithm)
  const dsa = dsaProvider(profile.signature.algorithm)
  let kemSeed: Uint8Array | undefined
  let dsaSeed: Uint8Array | undefined
  let kemSecretKey: Uint8Array | undefined
  let dsaSecretKey: Uint8Array | undefined
  try {
    // 独立した CSPRNG 呼出。KEM seed と DSA seed の共用は禁止。
    kemSeed = generateKemSeed()
    dsaSeed = generateDsaSeed()
    const kemKeys = kem.keygen(kemSeed)
    const dsaKeys = dsa.keygen(dsaSeed)
    kemSecretKey = kemKeys.secretKey
    dsaSecretKey = dsaKeys.secretKey
    const [kemPublicKeySha256, dsaPublicKeySha256] = await Promise.all([
      sha256(kemKeys.publicKey),
      sha256(dsaKeys.publicKey),
    ])
    const [encryptedKemSeed, encryptedDsaSeed] = await Promise.all([
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
  } finally {
    zeroize(kemSeed, dsaSeed, kemSecretKey, dsaSecretKey)
  }
}

async function publicKeysFromSeeds(
  request: PublicKeysFromSeedsRequest,
): Promise<PublicKeysFromSeedsResult> {
  const kem = kemProvider(request.kem.algorithm)
  const dsa = dsaProvider(request.signing.algorithm)
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
  const provider = dsaProvider(request.algorithm)
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
  return dsaProvider(request.algorithm).verify(
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
  const kem = kemProvider(components.kem)
  const plaintext = Uint8Array.from(request.plaintext)
  let signingSeed: Uint8Array | undefined
  let signingSecretKey: Uint8Array | undefined
  let signatureValue: Uint8Array | undefined
  let innerBytes: Uint8Array | undefined
  let sharedSecret: Uint8Array | undefined
  let hkdfInfo: Uint8Array | undefined
  try {
    if (components.signature === undefined) {
      innerBytes = encodeUnsignedMessageBodyV2({
        version: 2,
        messageId: Uint8Array.from(request.messageId),
        createdAt: request.createdAt,
        recipientKemKeyId: request.recipientKemKeyId,
        plaintext,
      })
    } else {
      const sign = request.sign
      if (sign === undefined || sign.algorithm !== components.signature) {
        throw new AppError("ENCRYPTION_FAILED")
      }
      const provider = dsaProvider(sign.algorithm)
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
    }

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
  const kem = kemProvider(components.kem)
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

    if (components.signature === undefined) {
      const body = decodeUnsignedMessageBodyV2(decrypted)
      parsedPlaintext = body.plaintext
      if (body.recipientKemKeyId !== envelope.recipientKemKeyId) {
        throw new AppError("DECRYPTION_FAILED")
      }
      return { kind: "unsigned", plaintext: Uint8Array.from(body.plaintext) }
    }

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
      provider: dsaProvider(request.algorithm),
      body: signed.body,
      signature: signed.signature,
      senderPublicKey: request.senderPublicKey,
    })
    return valid
      ? { valid: true, plaintext: Uint8Array.from(signed.body.plaintext) }
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
  // RPC 操作ごとの公開エラーへ畳み込み、CBOR/WebCrypto/noble の内部段階を
  // 呼出側へ漏らさない。署名の不一致だけは verify 系の公開コードになる。
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

// 秘密結果(plaintext / signedMessageBytes)は transfer しない。公開 artifact の
// exact-length owned ArrayBuffer だけを移動する。
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
