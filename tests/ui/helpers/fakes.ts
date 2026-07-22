import { useState } from "react"
import { vi } from "vitest"
import type { RegisterSWOptions } from "virtual:pwa-register/react"
import { AppError, type ErrorCode, userMessageFor } from "@/crypto/errors"
import type {
  AesMessageEnvelopeV1,
  PublicKeyEnvelopeV1,
  RsaHybridEnvelopeV1,
  SymmetricKeyEnvelopeV1,
} from "@/crypto/envelope"
import type { FeatureSupport } from "@/lib/feature-detect"
import type { Preferences, StoredKeyRecord, StoredQrArtifact } from "@/schemas/domain"
import { PQ_PREFERENCE_DEFAULTS } from "@/schemas/domain"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function cryptoKey(type: KeyType): CryptoKey {
  return {
    type,
    extractable: type !== "private",
    algorithm: { name: type === "secret" ? "AES-GCM" : "RSA-OAEP" },
    usages:
      type === "secret"
        ? ["encrypt", "decrypt"]
        : type === "public"
          ? ["encrypt"]
          : ["decrypt"],
  } as CryptoKey
}

function defaultKeys(): StoredKeyRecord[] {
  return [
    {
      id: "sym-key-00000001",
      name: "共通鍵A",
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      createdAt: 1_720_000_000_000,
      useCount: 2,
      symmetricKey: cryptoKey("secret"),
    },
    {
      id: "rsa-key-00000001",
      name: "受信鍵B",
      kind: "rsa-key-pair",
      algorithm: "RSA-OAEP-3072",
      fingerprint: "102132435465768798a9bacbdcedfe0f102132435465768798a9bacbdcedfe0f",
      createdAt: 1_721_000_000_000,
      useCount: 1,
      publicKey: cryptoKey("public"),
      privateKey: cryptoKey("private"),
    },
    {
      id: "public-key-0001",
      name: "相手の公開鍵",
      kind: "public-key",
      algorithm: "RSA-OAEP-3072",
      fingerprint: "2031425364758697a8b9cadbecfd0e1f2031425364758697a8b9cadbecfd0e1f",
      createdAt: 1_722_000_000_000,
      useCount: 0,
      publicKey: cryptoKey("public"),
    },
  ]
}

export const fakeKeys: StoredKeyRecord[] = defaultKeys()
export const fakeArtifacts: StoredQrArtifact[] = []
export const fakePreferences: Preferences = {
  ...PQ_PREFERENCE_DEFAULTS,
  defaultAlgorithm: "A256GCM",
  qrErrorCorrection: "Q",
  autoClearPlaintextAfterEncrypt: true,
  backgroundClearEnabled: true,
}
export const fakeFeatures: FeatureSupport = {
  webCrypto: true,
  indexedDb: true,
  camera: true,
  serviceWorker: true,
}
export const fakePwa = {
  offlineReady: false,
}

let artifactCounter = 0
let keyCounter = 0
let lastMessageEnvelope: AesMessageEnvelopeV1 | RsaHybridEnvelopeV1 | null = null

// errors.ts は純粋(依存ゼロ)のためモックせず実物を使う。
// FakeAppError の別クラス化は vi.mock factory ↔ fakes の循環初期化を起こすため
// 廃止し、実 AppError の別名として維持する(WP-A2 で修正)。
export const FakeAppError = AppError
export type FakeAppError = AppError

export function fakeUserMessageFor(code: ErrorCode): string {
  return userMessageFor(code)
}

export const detectFeatures = vi.fn(() => ({ ...fakeFeatures }))

export const utf8ToBytes = vi.fn((value: string) => encoder.encode(value))
export const bytesToUtf8 = vi.fn((value: Uint8Array) => decoder.decode(value))
export const utf8ByteLength = vi.fn((value: string) => encoder.encode(value).byteLength)
export const bytesToHex = vi.fn((value: Uint8Array) =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(""),
)
export const concatBytes = vi.fn((...parts: Uint8Array[]) => {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
})
export const bytesEqual = vi.fn(
  (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((byte, index) => byte === b[index]),
)
export const toOwnedArrayBuffer = vi.fn((value: Uint8Array) => value.slice().buffer)
export const sha256 = vi.fn(async (value: Uint8Array) => {
  const result = new Uint8Array(32)
  result[0] = value.byteLength % 256
  return result
})
export const sha256Hex = vi.fn(async (value: Uint8Array) =>
  value.byteLength.toString(16).padStart(64, "0"),
)

export const generateArtifactId = vi.fn(() => {
  artifactCounter += 1
  return `artifact-${String(artifactCounter).padStart(8, "0")}`
})
export const generateKeyId = vi.fn(() => {
  keyCounter += 1
  return `generated-key-${String(keyCounter).padStart(8, "0")}`
})
export const shortId = vi.fn((value: string) => value.slice(0, 8))
export const randomBytes = vi.fn((length: number) => new Uint8Array(length))

export const encryptWithAesKey = vi.fn(
  async ({
    keyId,
    plaintext,
    now,
  }: {
    keyId: string
    plaintext: Uint8Array
    now: number
  }) => {
    const envelope: AesMessageEnvelopeV1 = {
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId,
      createdAt: now,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]),
      aad: encoder.encode(`OCAAD1|${keyId}`),
    }
    lastMessageEnvelope = envelope
    return envelope
  },
)
export const decryptWithAesKey = vi.fn(async () => encoder.encode("復号済み平文"))
export const generateAesKey = vi.fn(async () => cryptoKey("secret"))
export const encryptRsaHybrid = vi.fn(
  async ({
    recipientKeyId,
    plaintext,
    now,
  }: {
    recipientKeyId: string
    plaintext: Uint8Array
    now: number
  }) => {
    const envelope: RsaHybridEnvelopeV1 = {
      v: 1,
      type: "message",
      algorithm: "RSA-OAEP-3072+A256GCM",
      recipientKeyId,
      createdAt: now,
      wrappedKey: new Uint8Array(384),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]),
      aad: encoder.encode(`OCAAD1|${recipientKeyId}`),
    }
    lastMessageEnvelope = envelope
    return envelope
  },
)
export const decryptRsaHybrid = vi.fn(async () => encoder.encode("RSA復号済み平文"))
export const generateRsaKeyPair = vi.fn(async () => ({
  publicKey: cryptoKey("public"),
  privateKey: cryptoKey("private"),
}))

function generatedFingerprint(counter: number): string {
  return counter.toString(16).padStart(64, "0")
}

export const createSymmetricKeyRecord = vi.fn(
  async (name: string, now: number): Promise<StoredKeyRecord> => {
    keyCounter += 1
    return {
      id: `generated-sym-${keyCounter}`,
      name,
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: generatedFingerprint(100 + keyCounter),
      createdAt: now,
      useCount: 0,
      symmetricKey: cryptoKey("secret"),
    }
  },
)
export const createRsaKeyPairRecord = vi.fn(
  async (name: string, now: number): Promise<StoredKeyRecord> => {
    keyCounter += 1
    return {
      id: `generated-rsa-${keyCounter}`,
      name,
      kind: "rsa-key-pair",
      algorithm: "RSA-OAEP-3072",
      fingerprint: generatedFingerprint(200 + keyCounter),
      createdAt: now,
      useCount: 0,
      publicKey: cryptoKey("public"),
      privateKey: cryptoKey("private"),
    }
  },
)
export const buildSymmetricKeyEnvelope = vi.fn(
  async (record: StoredKeyRecord): Promise<SymmetricKeyEnvelopeV1> => ({
    v: 1,
    type: "symmetric-key",
    algorithm: "A256GCM",
    keyId: record.id,
    createdAt: record.createdAt,
    key: new Uint8Array(32),
  }),
)
export const buildPublicKeyEnvelope = vi.fn(
  async (record: StoredKeyRecord): Promise<PublicKeyEnvelopeV1> => ({
    v: 1,
    type: "public-key",
    algorithm: "RSA-OAEP-3072",
    keyId: record.id,
    createdAt: record.createdAt,
    spki: new Uint8Array(400),
  }),
)
export const importSymmetricKeyRecord = vi.fn(
  async (name: string, envelope: SymmetricKeyEnvelopeV1, now: number) => ({
    id: envelope.keyId,
    name,
    kind: "symmetric" as const,
    algorithm: "A256GCM",
    fingerprint: generatedFingerprint(301),
    createdAt: now,
    useCount: 0,
    symmetricKey: cryptoKey("secret"),
  }),
)
export const importPublicKeyRecord = vi.fn(
  async (name: string, envelope: PublicKeyEnvelopeV1, now: number) => ({
    id: envelope.keyId,
    name,
    kind: "public-key" as const,
    algorithm: "RSA-OAEP-3072",
    fingerprint: generatedFingerprint(302),
    createdAt: now,
    useCount: 0,
    publicKey: cryptoKey("public"),
  }),
)

export const encodeEnvelopeToPayload = vi.fn(
  (
    envelope:
      | AesMessageEnvelopeV1
      | RsaHybridEnvelopeV1
      | SymmetricKeyEnvelopeV1
      | PublicKeyEnvelopeV1,
  ) => {
    if (envelope.type === "message") {
      lastMessageEnvelope = envelope
      return `OCM1:${"keyId" in envelope ? envelope.keyId : envelope.recipientKeyId}`
    }
    if (envelope.type === "symmetric-key") return `OCK1:${envelope.keyId}`
    return `OCP1:${envelope.keyId}`
  },
)
export const decodePayload = vi.fn((payload: string) => {
  if (payload.startsWith("OCM1:") && lastMessageEnvelope) {
    return { kind: "message" as const, envelope: lastMessageEnvelope }
  }
  if (payload.startsWith("OCM1:")) {
    return {
      kind: "message" as const,
      envelope: {
        v: 1,
        type: "message",
        algorithm: "A256GCM",
        keyId: payload.slice(5),
        createdAt: 1_720_000_000_000,
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(24),
        aad: encoder.encode("OCAAD1"),
      } satisfies AesMessageEnvelopeV1,
    }
  }
  if (payload.startsWith("OCK1:")) {
    return {
      kind: "symmetric-key" as const,
      envelope: {
        v: 1,
        type: "symmetric-key",
        algorithm: "A256GCM",
        keyId: payload.slice(5),
        createdAt: 1_720_000_000_000,
        key: new Uint8Array(32),
      } satisfies SymmetricKeyEnvelopeV1,
    }
  }
  if (payload.startsWith("OCP1:")) {
    return {
      kind: "public-key" as const,
      envelope: {
        v: 1,
        type: "public-key",
        algorithm: "RSA-OAEP-3072",
        keyId: payload.slice(5),
        createdAt: 1_720_000_000_000,
        spki: new Uint8Array(400),
      } satisfies PublicKeyEnvelopeV1,
    }
  }
  throw new FakeAppError("INVALID_QR_PREFIX")
})
export const payloadSha256Hex = vi.fn(async (payload: string) =>
  encoder.encode(payload).byteLength.toString(16).padStart(64, "0"),
)
export const renderQrDataUrl = vi.fn(
  async (payload: string) => `data:image/png;base64,${btoa(payload)}`,
)
export const renderQrSvgString = vi.fn(async () => "<svg viewBox='0 0 1 1'/>")
export const qrByteCapacity = vi.fn(
  (level: "L" | "M" | "Q" | "H") => ({ L: 2953, M: 2331, Q: 1663, H: 1273 })[level],
)
export const payloadFits = vi.fn(
  (payload: string, level: "L" | "M" | "Q" | "H") =>
    payload.length <= qrByteCapacity(level),
)
export const estimatePayloadChars = vi.fn(
  (bytes: number, algorithm: "A256GCM" | "RSA-HYBRID") =>
    bytes * 2 + (algorithm === "A256GCM" ? 220 : 760),
)
export const ecLevelFor = vi.fn((kind: StoredQrArtifact["kind"], prefs: Preferences) =>
  kind === "ciphertext" ? prefs.qrErrorCorrection : "H",
)
export const qrPngBlob = vi.fn(async () => new Blob(["png"]))
export const qrSvgBlob = vi.fn(async () => new Blob(["svg"]))
export const sanitizeQrFileName = vi.fn((name: string) => name.trim() || "qr")
export const buildExportFileName = vi.fn(
  (name: string, id: string, ext: "png" | "svg" | "txt") =>
    `${name}-${id.slice(0, 8)}.${ext}`,
)
export const triggerDownload = vi.fn()
export const copyTextToClipboard = vi.fn(async () => undefined)

export const scannerStop = vi.fn()
let scanTextCallback: ((payload: string) => void) | null = null
let scanErrorCallback: ((error: FakeAppError) => void) | null = null
export const startQrScan = vi.fn(
  async (
    _video: HTMLVideoElement,
    onText: (payload: string) => void,
    onError: (error: FakeAppError) => void,
  ) => {
    scanTextCallback = onText
    scanErrorCallback = onError
    return { stop: scannerStop }
  },
)
export function emitScannedPayload(payload: string): void {
  scanTextCallback?.(payload)
}
export function emitScanError(code: ErrorCode): void {
  scanErrorCallback?.(new FakeAppError(code))
}

export const listKeyRecords = vi.fn(async () => [...fakeKeys])
export const saveKeyRecord = vi.fn(async (record: StoredKeyRecord) => {
  if (fakeKeys.some((item) => item.fingerprint === record.fingerprint)) {
    throw new FakeAppError("DUPLICATE_KEY")
  }
  fakeKeys.unshift(record)
})
export const getKeyRecord = vi.fn(async (id: string) =>
  fakeKeys.find((record) => record.id === id),
)
export const findKeyByFingerprint = vi.fn(async (fingerprint: string) =>
  fakeKeys.find((record) => record.fingerprint === fingerprint),
)
export const renameKeyRecord = vi.fn(async (id: string, name: string) => {
  const record = fakeKeys.find((item) => item.id === id)
  if (record) record.name = name
})
export const deleteKeyRecord = vi.fn(async (id: string) => {
  const index = fakeKeys.findIndex((item) => item.id === id)
  if (index >= 0) fakeKeys.splice(index, 1)
})
export const markKeyUsed = vi.fn(async (id: string, when: number) => {
  const record = fakeKeys.find((item) => item.id === id)
  if (record) {
    record.useCount += 1
    record.lastUsedAt = when
  }
})
export const clearAllKeys = vi.fn(async () => {
  fakeKeys.splice(0)
})

export const listQrArtifacts = vi.fn(async () => [...fakeArtifacts])
export const saveQrArtifact = vi.fn(
  async (artifact: StoredQrArtifact, options?: { allowDuplicate?: boolean }) => {
    const duplicate = fakeArtifacts.some(
      (item) => item.payloadSha256 === artifact.payloadSha256,
    )
    if (duplicate && !options?.allowDuplicate) {
      throw new FakeAppError("DUPLICATE_QR")
    }
    fakeArtifacts.unshift(artifact)
  },
)
export const findQrByPayloadSha256 = vi.fn(async (hash: string) =>
  fakeArtifacts.find((artifact) => artifact.payloadSha256 === hash),
)
export const renameQrArtifact = vi.fn(async (id: string, name: string) => {
  const artifact = fakeArtifacts.find((item) => item.id === id)
  if (artifact) artifact.name = name
})
export const deleteQrArtifact = vi.fn(async (id: string) => {
  const index = fakeArtifacts.findIndex((item) => item.id === id)
  if (index >= 0) fakeArtifacts.splice(index, 1)
})
export const markQrViewed = vi.fn(async (id: string, when: number) => {
  const artifact = fakeArtifacts.find((item) => item.id === id)
  if (artifact) artifact.lastViewedAt = when
})
export const clearAllQrArtifacts = vi.fn(async () => {
  fakeArtifacts.splice(0)
})

export const getPreferences = vi.fn(async () => ({ ...fakePreferences }))
export const updatePreferences = vi.fn(async (patch: Partial<Preferences>) => {
  Object.assign(fakePreferences, patch)
  return { ...fakePreferences }
})
export const deleteEntireDatabase = vi.fn(async () => {
  fakeKeys.splice(0)
  fakeArtifacts.splice(0)
})
export const getDb = vi.fn()
export const closeDb = vi.fn()

export function useFakeRegisterSW(_options?: RegisterSWOptions) {
  void _options
  const offlineReadyState = useState(fakePwa.offlineReady)
  return {
    offlineReady: offlineReadyState,
  }
}

export function resetFakes(): void {
  fakeKeys.splice(0, fakeKeys.length, ...defaultKeys())
  fakeArtifacts.splice(0)
  Object.assign(fakePreferences, {
    ...PQ_PREFERENCE_DEFAULTS,
    defaultAlgorithm: "A256GCM",
    qrErrorCorrection: "Q",
    autoClearPlaintextAfterEncrypt: true,
    backgroundClearEnabled: true,
  } satisfies Preferences)
  Object.assign(fakeFeatures, {
    webCrypto: true,
    indexedDb: true,
    camera: true,
    serviceWorker: true,
  } satisfies FeatureSupport)
  fakePwa.offlineReady = false
  artifactCounter = 0
  keyCounter = 0
  lastMessageEnvelope = null
  scanTextCallback = null
  scanErrorCallback = null
  vi.clearAllMocks()
}
