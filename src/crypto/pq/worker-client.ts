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
import { WIRE_SUITES } from "@/schemas/domain"
import { AppError, ERROR_CODES, type ErrorCode } from "@/crypto/errors"
import { guardMlKemEnvelopeV2 } from "@/crypto/pq/canonical-cbor"
import { DSA_SIZES, KEM_SIZES, PQ_PROFILES } from "@/crypto/pq/profiles"
import {
  ACTIVE_PROFILE,
  assertActiveProfile,
  assertActiveSuite,
  resolveSuite,
  suiteComponents,
} from "@/crypto/pq/suites"
import { keyIdRawBytes } from "@/crypto/pq/wire-bytes"
import { env } from "@/schemas/env-schema"
import {
  DSA_SEED_BYTES,
  IV_BYTES,
  KEM_SEED_BYTES,
  KEY_ID_PATTERN,
  MAX_PLAINTEXT_BYTES,
  MESSAGE_ID_BYTES,
} from "@/lib/limits"

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
  { valid: true; plaintext: Uint8Array } | { valid: false }

export interface PqCryptoClient {
  generateIdentityKeys(req: GenerateIdentityKeysRequest): Promise<GeneratedIdentityKeys>
  publicKeysFromSeeds(req: PublicKeysFromSeedsRequest): Promise<PublicKeysFromSeedsResult>
  signWithSeed(req: SignWithSeedRequest): Promise<Uint8Array>
  verify(req: VerifyRequest): Promise<boolean>
  encryptPqMessage(req: EncryptPqMessageRequest): Promise<MlKemMessageEnvelopeV2>
  openPqEnvelope(req: OpenPqEnvelopeRequest): Promise<OpenedPqEnvelope>
  verifySignedMessage(req: VerifySignedMessageRequest): Promise<VerifySignedMessageResult>
  // 進行中 RPC の破棄と Worker terminate(WipeCoordinator が使用。plan2.1 §B3)
  dispose(): void
}

export interface CreatePqCryptoClientOptions {
  // テスト用 seam。省略時は env.pqWorkerEnabled と実行環境から解決する
  timeoutMs?: number
}

export type PqWorkerOperation =
  | "generateIdentityKeys"
  | "publicKeysFromSeeds"
  | "signWithSeed"
  | "verify"
  | "encryptPqMessage"
  | "openPqEnvelope"
  | "verifySignedMessage"

export interface PqWorkerRpcRequest {
  id: string
  operation: PqWorkerOperation
  payload: unknown
}

export type PqWorkerRpcResponse =
  { id: string; ok: true; value: unknown } | { id: string; ok: false; code: ErrorCode }

interface WorkerRequestMap {
  generateIdentityKeys: GenerateIdentityKeysRequest
  publicKeysFromSeeds: PublicKeysFromSeedsRequest
  signWithSeed: SignWithSeedRequest
  verify: VerifyRequest
  encryptPqMessage: EncryptPqMessageRequest
  openPqEnvelope: OpenPqEnvelopeRequest
  verifySignedMessage: VerifySignedMessageRequest
}

interface WorkerResultMap {
  generateIdentityKeys: GeneratedIdentityKeys
  publicKeysFromSeeds: PublicKeysFromSeedsResult
  signWithSeed: Uint8Array
  verify: boolean
  encryptPqMessage: MlKemMessageEnvelopeV2
  openPqEnvelope: OpenedPqEnvelope
  verifySignedMessage: VerifySignedMessageResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isBytes(value: unknown, length?: number): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    (length === undefined || value.byteLength === length)
  )
}

function isKeyId(value: unknown): value is string {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) return false
  try {
    return keyIdRawBytes(value).byteLength === 16
  } catch {
    return false
  }
}

function isVaultKey(value: unknown): value is CryptoKey {
  if (!isRecord(value)) return false
  const key = value as unknown as Partial<CryptoKey>
  const algorithm = key.algorithm as Partial<AesKeyAlgorithm> | undefined
  return (
    key.type === "secret" &&
    key.extractable === false &&
    algorithm?.name === "AES-GCM" &&
    algorithm.length === 256 &&
    Array.isArray(key.usages) &&
    key.usages.includes("encrypt") &&
    key.usages.includes("decrypt")
  )
}

function isEncryptedSecret(value: unknown, seedBytes: number): boolean {
  if (!isRecord(value)) return false
  return isBytes(value["iv"], IV_BYTES) && isBytes(value["ciphertext"], seedBytes + 16)
}

function requestError(operation: PqWorkerOperation): AppError {
  switch (operation) {
    case "openPqEnvelope":
    case "publicKeysFromSeeds":
      return new AppError("DECRYPTION_FAILED")
    case "verify":
    case "verifySignedMessage":
      return new AppError("SIGNATURE_INVALID")
    case "generateIdentityKeys":
    case "signWithSeed":
    case "encryptPqMessage":
      return new AppError("ENCRYPTION_FAILED")
  }
}

function assertProfilePair(
  kemAlgorithm: "ML-KEM-768" | "ML-KEM-1024",
  dsaAlgorithm: MlDsaAlgorithm,
): void {
  const valid =
    (kemAlgorithm === "ML-KEM-768" && dsaAlgorithm === "ML-DSA-65") ||
    (kemAlgorithm === "ML-KEM-1024" && dsaAlgorithm === "ML-DSA-87")
  if (!valid) throw new AppError("DECRYPTION_FAILED")
}

function assertActiveDsaAlgorithm(algorithm: MlDsaAlgorithm): void {
  if (algorithm !== PQ_PROFILES[ACTIVE_PROFILE].signature.algorithm) {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
}

// Browser 側では postMessage より前、Worker 側では処理開始前に同じ検査を行う。
export function validatePqWorkerRequest(
  operation: PqWorkerOperation,
  payload: unknown,
): void {
  try {
    if (!isRecord(payload)) throw requestError(operation)
    switch (operation) {
      case "generateIdentityKeys": {
        const profile = payload["profile"]
        if (
          (profile !== "balanced" && profile !== "maximum") ||
          !isVaultKey(payload["vaultKey"]) ||
          !isKeyId(payload["identityId"]) ||
          !isKeyId(payload["kemKeyId"]) ||
          !isKeyId(payload["signingKeyId"])
        ) {
          throw requestError(operation)
        }
        assertActiveProfile(profile)
        return
      }
      case "publicKeysFromSeeds": {
        const kem = payload["kem"]
        const signing = payload["signing"]
        if (
          !isVaultKey(payload["vaultKey"]) ||
          !isKeyId(payload["identityId"]) ||
          !isRecord(kem) ||
          !isRecord(signing)
        ) {
          throw requestError(operation)
        }
        const kemAlgorithm = kem["algorithm"]
        const dsaAlgorithm = signing["algorithm"]
        if (
          (kemAlgorithm !== "ML-KEM-768" && kemAlgorithm !== "ML-KEM-1024") ||
          (dsaAlgorithm !== "ML-DSA-65" && dsaAlgorithm !== "ML-DSA-87")
        ) {
          throw requestError(operation)
        }
        assertProfilePair(kemAlgorithm, dsaAlgorithm)
        assertActiveSuite(resolveSuite(kemAlgorithm, dsaAlgorithm))
        if (
          !isKeyId(kem["keyId"]) ||
          !isEncryptedSecret(kem["encryptedSeed"], KEM_SEED_BYTES) ||
          !isBytes(kem["storedPublicKey"], KEM_SIZES[kemAlgorithm].publicKeyBytes) ||
          !isKeyId(signing["keyId"]) ||
          !isEncryptedSecret(signing["encryptedSeed"], DSA_SEED_BYTES) ||
          !isBytes(signing["storedPublicKey"], DSA_SIZES[dsaAlgorithm].publicKeyBytes)
        ) {
          throw requestError(operation)
        }
        return
      }
      case "signWithSeed": {
        const algorithm = payload["algorithm"]
        if (algorithm !== "ML-DSA-65" && algorithm !== "ML-DSA-87") {
          throw requestError(operation)
        }
        assertActiveDsaAlgorithm(algorithm)
        if (
          !isVaultKey(payload["vaultKey"]) ||
          !isKeyId(payload["identityId"]) ||
          !isKeyId(payload["keyId"]) ||
          !isEncryptedSecret(payload["encryptedSeed"], DSA_SEED_BYTES) ||
          !isBytes(payload["storedPublicKey"], DSA_SIZES[algorithm].publicKeyBytes) ||
          !isBytes(payload["message"])
        ) {
          throw requestError(operation)
        }
        return
      }
      case "verify": {
        const algorithm = payload["algorithm"]
        if (algorithm !== "ML-DSA-65" && algorithm !== "ML-DSA-87") {
          throw requestError(operation)
        }
        assertActiveDsaAlgorithm(algorithm)
        if (
          !isBytes(payload["publicKey"], DSA_SIZES[algorithm].publicKeyBytes) ||
          !isBytes(payload["message"]) ||
          !isBytes(payload["signature"], DSA_SIZES[algorithm].signatureBytes)
        ) {
          throw requestError(operation)
        }
        return
      }
      case "encryptPqMessage": {
        const rawSuite = payload["suite"]
        if (
          typeof rawSuite !== "string" ||
          !(WIRE_SUITES as readonly string[]).includes(rawSuite)
        ) {
          throw requestError(operation)
        }
        const suite = rawSuite as WireSuite
        const components = suiteComponents(suite)
        assertActiveSuite(suite)
        const sign = payload["sign"]
        if (
          !isKeyId(payload["recipientKemKeyId"]) ||
          !isBytes(
            payload["recipientKemPublicKey"],
            KEM_SIZES[components.kem].publicKeyBytes,
          ) ||
          !isBytes(payload["plaintext"]) ||
          (payload["plaintext"] as Uint8Array).byteLength > MAX_PLAINTEXT_BYTES ||
          !isBytes(payload["messageId"], MESSAGE_ID_BYTES) ||
          typeof payload["createdAt"] !== "number" ||
          !Number.isSafeInteger(payload["createdAt"]) ||
          (payload["createdAt"] as number) < 0
        ) {
          throw requestError(operation)
        }
        if (components.signature === undefined) {
          if (sign !== undefined) throw requestError(operation)
          return
        }
        if (!isRecord(sign) || sign["algorithm"] !== components.signature) {
          throw requestError(operation)
        }
        if (
          !isKeyId(sign["senderSigningKeyId"]) ||
          !isVaultKey(sign["vaultKey"]) ||
          !isKeyId(sign["identityId"]) ||
          !isEncryptedSecret(sign["encryptedSeed"], DSA_SEED_BYTES) ||
          !isBytes(
            sign["storedPublicKey"],
            DSA_SIZES[components.signature].publicKeyBytes,
          )
        ) {
          throw requestError(operation)
        }
        return
      }
      case "openPqEnvelope": {
        const envelope = guardMlKemEnvelopeV2(payload["envelope"])
        assertActiveSuite(envelope.suite)
        const recipient = payload["recipient"]
        if (!isRecord(recipient)) throw requestError(operation)
        const components = suiteComponents(envelope.suite)
        const maxInnerBytes =
          MAX_PLAINTEXT_BYTES +
          (components.signature === undefined
            ? 512
            : DSA_SIZES[components.signature].signatureBytes + 1024) +
          16
        if (
          envelope.ciphertext.byteLength > maxInnerBytes ||
          recipient["kemAlgorithm"] !== components.kem ||
          recipient["kemKeyId"] !== envelope.recipientKemKeyId ||
          !isKeyId(recipient["identityId"]) ||
          !isKeyId(recipient["kemKeyId"]) ||
          !isEncryptedSecret(recipient["encryptedKemSeed"], KEM_SEED_BYTES) ||
          !isBytes(
            recipient["storedKemPublicKey"],
            KEM_SIZES[components.kem].publicKeyBytes,
          ) ||
          !isVaultKey(recipient["vaultKey"])
        ) {
          throw requestError(operation)
        }
        return
      }
      case "verifySignedMessage": {
        const algorithm = payload["algorithm"]
        if (algorithm !== "ML-DSA-65" && algorithm !== "ML-DSA-87") {
          throw requestError(operation)
        }
        assertActiveDsaAlgorithm(algorithm)
        const signedMessageBytes = payload["signedMessageBytes"]
        if (
          !isBytes(signedMessageBytes) ||
          signedMessageBytes.byteLength === 0 ||
          signedMessageBytes.byteLength >
            MAX_PLAINTEXT_BYTES + DSA_SIZES[algorithm].signatureBytes + 1024 ||
          !isBytes(payload["senderPublicKey"], DSA_SIZES[algorithm].publicKeyBytes)
        ) {
          throw requestError(operation)
        }
        return
      }
    }
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === requestError(operation).code ||
        error.code === "UNSUPPORTED_ALGORITHM")
    ) {
      throw error
    }
    throw requestError(operation)
  }
}

function validateWorkerResult<K extends PqWorkerOperation>(
  operation: K,
  request: WorkerRequestMap[K],
  value: unknown,
): WorkerResultMap[K] {
  try {
    switch (operation) {
      case "generateIdentityKeys": {
        if (!isRecord(value) || !isRecord(value["kem"]) || !isRecord(value["signing"])) {
          throw new TypeError("worker result")
        }
        const profile = PQ_PROFILES[(request as GenerateIdentityKeysRequest).profile]
        if (
          !isBytes(value["kem"]["publicKey"], profile.kem.publicKeyBytes) ||
          !isEncryptedSecret(value["kem"]["encryptedSeed"], KEM_SEED_BYTES) ||
          !isBytes(value["signing"]["publicKey"], profile.signature.publicKeyBytes) ||
          !isEncryptedSecret(value["signing"]["encryptedSeed"], DSA_SEED_BYTES)
        ) {
          throw new TypeError("worker result")
        }
        break
      }
      case "publicKeysFromSeeds": {
        const req = request as PublicKeysFromSeedsRequest
        if (
          !isRecord(value) ||
          !isBytes(value["kemPublicKey"], KEM_SIZES[req.kem.algorithm].publicKeyBytes) ||
          !isBytes(value["dsaPublicKey"], DSA_SIZES[req.signing.algorithm].publicKeyBytes)
        ) {
          throw new TypeError("worker result")
        }
        break
      }
      case "signWithSeed": {
        const req = request as SignWithSeedRequest
        if (!isBytes(value, DSA_SIZES[req.algorithm].signatureBytes)) {
          throw new TypeError("worker result")
        }
        break
      }
      case "verify":
        if (typeof value !== "boolean") throw new TypeError("worker result")
        break
      case "encryptPqMessage": {
        const req = request as EncryptPqMessageRequest
        const envelope = guardMlKemEnvelopeV2(value)
        if (
          envelope.suite !== req.suite ||
          envelope.recipientKemKeyId !== req.recipientKemKeyId
        ) {
          throw new TypeError("worker result")
        }
        break
      }
      case "openPqEnvelope": {
        const req = request as OpenPqEnvelopeRequest
        if (
          !isRecord(value) ||
          (value["kind"] !== "unsigned" && value["kind"] !== "signed")
        ) {
          throw new TypeError("worker result")
        }
        const components = suiteComponents(req.envelope.suite)
        if (value["kind"] === "unsigned") {
          if (components.signature !== undefined || !isBytes(value["plaintext"])) {
            throw new TypeError("worker result")
          }
        } else if (
          components.signature === undefined ||
          !isBytes(value["signedMessageBytes"]) ||
          !isKeyId(value["senderSigningKeyId"]) ||
          value["signatureAlgorithm"] !== components.signature
        ) {
          throw new TypeError("worker result")
        }
        break
      }
      case "verifySignedMessage":
        if (!isRecord(value) || typeof value["valid"] !== "boolean") {
          throw new TypeError("worker result")
        }
        if (value["valid"] && !isBytes(value["plaintext"])) {
          throw new TypeError("worker result")
        }
        if (!value["valid"] && "plaintext" in value) throw new TypeError("worker result")
        break
    }
    return value as WorkerResultMap[K]
  } catch {
    throw new AppError("WORKER_UNAVAILABLE")
  }
}

type RpcCall = <K extends PqWorkerOperation>(
  operation: K,
  payload: WorkerRequestMap[K],
) => Promise<WorkerResultMap[K]>

function clientFromRpc(call: RpcCall, dispose: () => void): PqCryptoClient {
  return {
    generateIdentityKeys: (request) => call("generateIdentityKeys", request),
    publicKeysFromSeeds: (request) => call("publicKeysFromSeeds", request),
    signWithSeed: (request) => call("signWithSeed", request),
    verify: (request) => call("verify", request),
    encryptPqMessage: (request) => call("encryptPqMessage", request),
    openPqEnvelope: (request) => call("openPqEnvelope", request),
    verifySignedMessage: (request) => call("verifySignedMessage", request),
    dispose,
  }
}

function createInProcessClient(): PqCryptoClient {
  let disposed = false
  let nextId = 0
  const handler = import("@/workers/pq-crypto.worker").then(
    (module) => module.handlePqWorkerRequest,
  )
  const call: RpcCall = async (operation, payload) => {
    if (disposed) throw new AppError("WORKER_UNAVAILABLE")
    validatePqWorkerRequest(operation, payload)
    const id = `node-${nextId++}`
    const response = await (await handler)({ id, operation, payload })
    if (disposed) throw new AppError("WORKER_UNAVAILABLE")
    if (!response.ok) throw new AppError(response.code)
    return validateWorkerResult(operation, payload, response.value)
  }
  return clientFromRpc(call, () => {
    disposed = true
  })
}

interface PendingRpc {
  operation: PqWorkerOperation
  payload: WorkerRequestMap[PqWorkerOperation]
  resolve(value: unknown): void
  reject(error: AppError): void
  timeout: ReturnType<typeof setTimeout>
}

function createBrowserWorkerClient(timeoutMs: number): PqCryptoClient {
  if (!env.pqWorkerEnabled || typeof Worker === "undefined") {
    throw new AppError("WORKER_UNAVAILABLE")
  }
  let worker: Worker
  try {
    worker = new Worker(new URL("../../workers/pq-crypto.worker.ts", import.meta.url), {
      type: "module",
      name: "qrypt-pq-crypto",
    })
  } catch {
    throw new AppError("WORKER_UNAVAILABLE")
  }

  let disposed = false
  let nextId = 0
  const pending = new Map<string, PendingRpc>()

  const failAll = (): void => {
    if (!disposed) worker.terminate()
    disposed = true
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout)
      entry.reject(new AppError("WORKER_UNAVAILABLE"))
    }
    pending.clear()
  }

  worker.addEventListener("error", failAll)
  worker.addEventListener("messageerror", failAll)
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const response = event.data
    if (!isRecord(response) || typeof response["id"] !== "string") return
    const entry = pending.get(response["id"])
    if (entry === undefined) return // timeout/dispose 後の late response
    pending.delete(response["id"])
    clearTimeout(entry.timeout)
    if (response["ok"] === true) {
      try {
        entry.resolve(
          validateWorkerResult(entry.operation, entry.payload, response["value"]),
        )
      } catch {
        failAll()
        entry.reject(new AppError("WORKER_UNAVAILABLE"))
      }
      return
    }
    const code = response["code"]
    if (
      response["ok"] === false &&
      typeof code === "string" &&
      (ERROR_CODES as readonly string[]).includes(code)
    ) {
      entry.reject(new AppError(code as ErrorCode))
    } else {
      failAll()
      entry.reject(new AppError("WORKER_UNAVAILABLE"))
    }
  })

  async function call<K extends PqWorkerOperation>(
    operation: K,
    payload: WorkerRequestMap[K],
  ): Promise<WorkerResultMap[K]> {
    if (disposed) return Promise.reject(new AppError("WORKER_UNAVAILABLE"))
    validatePqWorkerRequest(operation, payload)
    const id = `browser-${nextId++}`
    return new Promise<WorkerResultMap[K]>((resolve, reject) => {
      const timeout = setTimeout(failAll, timeoutMs)
      pending.set(id, {
        operation,
        payload: payload as WorkerRequestMap[PqWorkerOperation],
        resolve,
        reject,
        timeout,
      })
      try {
        // 秘密入力を含むため transfer list は意図的に渡さない。
        worker.postMessage({ id, operation, payload } satisfies PqWorkerRpcRequest)
      } catch {
        failAll()
      }
    })
  }
  return clientFromRpc(call, failAll)
}

export function createPqCryptoClient(
  options?: CreatePqCryptoClientOptions,
): PqCryptoClient {
  const timeoutMs = options?.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new AppError("WORKER_UNAVAILABLE")
  }
  const isNode =
    typeof window === "undefined" &&
    typeof process !== "undefined" &&
    process.versions?.node !== undefined
  return isNode ? createInProcessClient() : createBrowserWorkerClient(timeoutMs)
}
