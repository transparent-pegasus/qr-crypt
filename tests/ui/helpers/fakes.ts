import { useState } from "react"
import { vi } from "vitest"
import type { RegisterSWOptions } from "virtual:pwa-register/react"
import { AppError, type ErrorCode } from "@/crypto/errors"
import type {
  AesMessageEnvelopeV1,
  PublicKeyEnvelopeV1,
  SymmetricKeyEnvelopeV1,
} from "@/crypto/envelope"
import { storeOnlyZip } from "@/lib/best-effort-zip"
import type { FeatureSupport } from "@/lib/feature-detect"
import type { QrExportOptions } from "@/qr/export-image"
import type { TransferState } from "@/qr/multipart/transfer-state"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
  PqPublicBundleRecord,
  Preferences,
  PublicIdentityBundleV2,
  QrFrameV2,
  StoredKeyRecord,
  V2ArtifactType,
} from "@/schemas/domain"
import { PQ_PREFERENCE_DEFAULTS } from "@/schemas/domain"
import { MAX_ARTIFACT_BYTES_ABSOLUTE } from "@/lib/limits"

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

const IDENTITY_ID = "I".repeat(22)
const KEM_KEY_ID = "K".repeat(22)
const SIGNING_KEY_ID = "S".repeat(22)
const BUNDLE_RECORD_ID = "R".repeat(22)

function defaultIdentity(): PostQuantumIdentity {
  return {
    id: IDENTITY_ID,
    name: "自分のPQ ID",
    profile: "maximum",
    kem: {
      algorithm: "ML-KEM-1024",
      keyId: KEM_KEY_ID,
      publicKey: new Uint8Array(1568).fill(1),
      encryptedSeed: { iv: new Uint8Array(12), ciphertext: new Uint8Array(80) },
      fingerprint: "1".repeat(64),
    },
    signing: {
      algorithm: "ML-DSA-87",
      keyId: SIGNING_KEY_ID,
      publicKey: new Uint8Array(2592).fill(2),
      encryptedSeed: { iv: new Uint8Array(12), ciphertext: new Uint8Array(48) },
      fingerprint: "2".repeat(64),
    },
    identityFingerprint: "3".repeat(64),
    status: "active",
    createdAt: 1_723_000_000_000,
  }
}

function recordFromIdentity(identity: PostQuantumIdentity): PqPublicBundleRecord {
  return {
    recordId: BUNDLE_RECORD_ID,
    identityId: "P".repeat(22),
    name: "確認済みの相手",
    kem: {
      algorithm: identity.kem.algorithm,
      keyId: "Q".repeat(22),
      publicKey: Uint8Array.from(identity.kem.publicKey),
      fingerprint: "4".repeat(64),
    },
    signing: {
      algorithm: identity.signing.algorithm,
      keyId: "T".repeat(22),
      publicKey: Uint8Array.from(identity.signing.publicKey),
      fingerprint: "5".repeat(64),
    },
    identityFingerprint: "6".repeat(64),
    trust: "fingerprint-confirmed",
    trustConfirmedAt: 1_723_000_000_010,
    bundleCreatedAt: 1_723_000_000_000,
    importedAt: 1_723_000_000_005,
  }
}

export const fakeIdentities: PostQuantumIdentity[] = [defaultIdentity()]
export const fakeBundles: PqPublicBundleRecord[] = [
  recordFromIdentity(fakeIdentities[0]!),
]
export const fakePreferences: Preferences = {
  ...PQ_PREFERENCE_DEFAULTS,
  defaultAlgorithm: "A256GCM",
  frameBytes: 1_000,
  frameIntervalMs: 200,
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
let lastMessageEnvelope: AesMessageEnvelopeV1 | null = null
let lastPqEnvelope: MlKemMessageEnvelopeV2 = {
  version: 2,
  type: "pq-message",
  suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
  recipientKemKeyId: KEM_KEY_ID,
  kemCiphertext: new Uint8Array(1568),
  hkdfSalt: new Uint8Array(32),
  iv: new Uint8Array(12),
  ciphertext: new Uint8Array(128),
}
let lastPublicBundle: PublicIdentityBundleV2 | null = null
let lastKemEnvelope: KemPublicKeyEnvelopeV2 | null = null
let lastDsaEnvelope: DsaPublicKeyEnvelopeV2 | null = null

// errors.ts is pure (dependency-free), so use the real module instead of mocking it.
// Defining FakeAppError as a separate class creates a circular initialization between
// the vi.mock factory and fakes, so retain it as an alias of the real AppError.
export const FakeAppError = AppError
export type FakeAppError = AppError

export const detectFeatures = vi.fn(() => ({ ...fakeFeatures }))
export const probeWebAssemblyRuntime = vi.fn(async () => true)

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
export const encodeEnvelopeToPayload = vi.fn(
  (envelope: AesMessageEnvelopeV1 | SymmetricKeyEnvelopeV1 | PublicKeyEnvelopeV1) => {
    if (envelope.type === "message") {
      lastMessageEnvelope = envelope
      return `OCM1:${envelope.keyId}`
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
  if (payload.startsWith("OCM2:")) {
    return { kind: "pq-message" as const, envelope: lastPqEnvelope }
  }
  if (payload.startsWith("OCI2:")) {
    return {
      kind: "pq-public-identity" as const,
      envelope: lastPublicBundle ?? buildPublicBundle(fakeIdentities[0]!),
    }
  }
  if (payload.startsWith("OCP2:")) {
    return {
      kind: "pq-kem-public-key" as const,
      envelope:
        lastKemEnvelope ??
        ({
          version: 2,
          type: "pq-kem-public-key",
          identityId: IDENTITY_ID,
          algorithm: "ML-KEM-1024",
          keyId: KEM_KEY_ID,
          publicKey: new Uint8Array(1568),
          createdAt: 1_723_000_000_000,
        } satisfies KemPublicKeyEnvelopeV2),
    }
  }
  if (payload.startsWith("OCS2:")) {
    return {
      kind: "pq-dsa-public-key" as const,
      envelope:
        lastDsaEnvelope ??
        ({
          version: 2,
          type: "pq-dsa-public-key",
          identityId: IDENTITY_ID,
          algorithm: "ML-DSA-87",
          keyId: SIGNING_KEY_ID,
          publicKey: new Uint8Array(2592),
          createdAt: 1_723_000_000_000,
        } satisfies DsaPublicKeyEnvelopeV2),
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
export const estimatePayloadChars = vi.fn((bytes: number) => bytes * 2 + 220)
export const ecLevelFor = vi.fn(
  (kind: "message" | "stored-key" | "multipart-frame", prefs: Preferences) =>
    kind === "message" ? prefs.qrErrorCorrection : kind === "multipart-frame" ? "Q" : "H",
)
export const qrPngBlob = vi.fn<
  (payload: string, options: QrExportOptions) => Promise<Blob>
>(async () => new Blob(["png"]))
export const qrSvgBlob = vi.fn(async () => new Blob(["svg"]))
export const sanitizeQrFileName = vi.fn((name: string) => name.trim() || "qr")
export const buildExportFileName = vi.fn(
  (name: string, id: string, ext: "png" | "svg" | "txt") =>
    `${name}-${id.slice(0, 8)}.${ext}`,
)
export const triggerDownload = vi.fn()
export const exportQrFramePayloads = vi.fn(
  async (
    frames: ReadonlyArray<{ frameIndex: number; payload: string }>,
    options: { outputName: string; size: number; signal?: AbortSignal },
  ) => {
    if (frames.length === 0) return
    if (options.signal?.aborted) return
    const safeName = sanitizeQrFileName(options.outputName)

    if (frames.length === 1) {
      const blob = await qrPngBlob(frames[0]!.payload, {
        ecLevel: "Q",
        size: options.size,
      })
      if (options.signal?.aborted) return
      triggerDownload(blob, `${safeName}.png`)
      return
    }

    const entries: Array<{ name: string; data: Uint8Array }> = []
    for (const frame of frames) {
      if (options.signal?.aborted) return
      const blob = await qrPngBlob(frame.payload, {
        ecLevel: "Q",
        size: options.size,
      })
      if (options.signal?.aborted) return
      const data = new Uint8Array(await blob.arrayBuffer())
      if (options.signal?.aborted) return
      entries.push({
        name: `frame-${String(frame.frameIndex + 1).padStart(2, "0")}.png`,
        data,
      })
    }
    if (options.signal?.aborted) return
    triggerDownload(storeOnlyZip(entries), `${safeName}-frames.zip`)
  },
)
export const copyTextToClipboard = vi.fn(async () => undefined)

interface FakeCameraDiagnostic {
  phase: "acquiring" | "acquired" | "playing" | "track-ended"
  name: string | null
  detail: string
}

interface FakeCameraPipelineDiagnostic {
  readerModuleState: "idle" | "preparing" | "ready" | "failed" | "timed-out"
  videoFramesDrawn: number
  decodeAttemptsCompleted: number
  decodeResultsSeen: number
  lastErrorName: string | null
}

export const scannerStop = vi.fn()
export const warmQrReader = vi.fn(() => undefined)
let scanTextCallback: ((payload: string) => void) | null = null
let scanErrorCallback:
  | ((error: FakeAppError, diagnostic: FakeCameraDiagnostic) => void)
  | null = null
export const startQrScan = vi.fn(
  async (
    _video: HTMLVideoElement,
    onText: (payload: string) => void,
    onError: (
      error: FakeAppError,
      diagnostic: FakeCameraDiagnostic,
    ) => void,
    _options?: {
      once?: boolean
      signal?: AbortSignal
      onDiagnostic?: (diagnostic: FakeCameraPipelineDiagnostic) => void
    },
  ): Promise<{ stop: () => void }> => {
    void _options
    scanTextCallback = onText
    scanErrorCallback = onError
    return { stop: scannerStop }
  },
)
export function emitScannedPayload(payload: string): void {
  scanTextCallback?.(payload)
}
export function emitScanError(
  code: ErrorCode,
  diagnostic: FakeCameraDiagnostic = {
    phase: "acquiring",
    name: null,
    detail: "0x0 rs=0 track=none",
  },
): void {
  scanErrorCallback?.(new FakeAppError(code), diagnostic)
}

export const disposePqClient = vi.fn()
export const createPqCryptoClient = vi.fn(() => ({ dispose: disposePqClient }))
export const getOrCreateVaultKey = vi.fn(async () => cryptoKey("secret"))
export const registerPqCryptoClientForWipe = vi.fn(() => () => undefined)

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
  async ({ name, now }: { name: string; now: number }) => ({
    ...defaultIdentity(),
    id: `N${String(++keyCounter).padStart(21, "0")}`,
    name,
    kem: {
      ...defaultIdentity().kem,
      keyId: `K${String(keyCounter).padStart(21, "0")}`,
    },
    signing: {
      ...defaultIdentity().signing,
      keyId: `S${String(keyCounter).padStart(21, "0")}`,
    },
    createdAt: now,
  }),
)

export const rotateIdentity = vi.fn(
  async ({ current, now }: { current: PostQuantumIdentity; now: number }) => ({
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

export const encodeUnsignedMessageBodyV2 = vi.fn(
  (body: { plaintext: Uint8Array }) => new Uint8Array(body.plaintext.byteLength + 96),
)
export const encodeSignedMessageV2 = vi.fn(
  (message: { body: { plaintext: Uint8Array }; signature: { value: Uint8Array } }) =>
    new Uint8Array(
      message.body.plaintext.byteLength + message.signature.value.byteLength + 128,
    ),
)
export const encodeMlKemEnvelopeV2 = vi.fn((envelope: MlKemMessageEnvelopeV2) => {
  return new Uint8Array(
    envelope.kemCiphertext.byteLength + envelope.ciphertext.byteLength + 128,
  )
})
export const decodeMlKemEnvelopeV2 = vi.fn(() => lastPqEnvelope)
export const encodePublicIdentityBundleV2 = vi.fn((bundle: PublicIdentityBundleV2) => {
  lastPublicBundle = bundle
  return new Uint8Array(3_400)
})
export const decodePublicIdentityBundleV2 = vi.fn(
  () => lastPublicBundle ?? buildPublicBundle(fakeIdentities[0]!),
)
export const encodeKemPublicKeyEnvelopeV2 = vi.fn((envelope: KemPublicKeyEnvelopeV2) => {
  lastKemEnvelope = envelope
  return new Uint8Array(1_350)
})
export const decodeKemPublicKeyEnvelopeV2 = vi.fn(
  () =>
    lastKemEnvelope ??
    (decodePayload("OCP2:fake") as { envelope: KemPublicKeyEnvelopeV2 }).envelope,
)
export const encodeDsaPublicKeyEnvelopeV2 = vi.fn((envelope: DsaPublicKeyEnvelopeV2) => {
  lastDsaEnvelope = envelope
  return new Uint8Array(2_150)
})
export const decodeDsaPublicKeyEnvelopeV2 = vi.fn(
  () =>
    lastDsaEnvelope ??
    (decodePayload("OCS2:fake") as { envelope: DsaPublicKeyEnvelopeV2 }).envelope,
)

export const splitIntoFrames = vi.fn(
  async ({
    artifactType,
    artifactBytes,
    frameBytes,
    frameCount: requestedFrameCount,
  }: {
    artifactType: V2ArtifactType
    artifactBytes: Uint8Array
    frameBytes?: number
    frameCount?: number
  }): Promise<QrFrameV2[]> => {
    if (artifactBytes.byteLength > MAX_ARTIFACT_BYTES_ABSOLUTE) {
      throw new FakeAppError("QR_TOO_LARGE")
    }
    const frameCount =
      requestedFrameCount ??
      Math.max(1, Math.ceil(artifactBytes.byteLength / (frameBytes ?? 1)))
    const baseChunkBytes = Math.floor(artifactBytes.byteLength / frameCount)
    const largerChunks = artifactBytes.byteLength % frameCount
    let offset = 0
    return Array.from({ length: frameCount }, (_, frameIndex) => {
      const chunkBytes =
        requestedFrameCount === undefined
          ? (frameBytes ?? artifactBytes.byteLength)
          : baseChunkBytes + (frameIndex < largerChunks ? 1 : 0)
      const frame: QrFrameV2 = {
        version: 2,
        type: "qr-frame",
        transferId: new Uint8Array(16).fill(3),
        artifactType,
        frameIndex,
        frameCount,
        totalByteLength: artifactBytes.byteLength,
        chunk: artifactBytes.slice(offset, offset + chunkBytes),
      }
      offset += chunkBytes
      return frame
    })
  },
)

const V2_PREFIX: Record<V2ArtifactType, string> = {
  "pq-message": "OCM2:",
  "pq-public-identity": "OCI2:",
  "pq-kem-public-key": "OCP2:",
  "pq-dsa-public-key": "OCS2:",
  "encrypted-seed-backup": "OCB2:",
}
export const buildV2Payload = vi.fn((kind: V2ArtifactType) => `${V2_PREFIX[kind]}fake`)
export const splitV2Payload = vi.fn((payload: string) => {
  const match = (Object.entries(V2_PREFIX) as [V2ArtifactType, string][]).find(
    ([, prefix]) => payload.startsWith(prefix),
  )
  if (!match || match[0] === "encrypted-seed-backup") {
    throw new FakeAppError("INVALID_QR_PAYLOAD")
  }
  const [kind] = match
  return {
    kind,
    bytes: new Uint8Array(kind === "pq-public-identity" ? 650 : 350),
  }
})
export const encodeFrameToPayload = vi.fn(
  (frame: QrFrameV2) =>
    `OCF2:${Array.from(frame.transferId).join("")}:${frame.frameIndex}:${frame.frameCount}:${frame.artifactType}`,
)

export function multipartPayload(
  transfer: string,
  index: number,
  count: number,
  artifactType: V2ArtifactType = "pq-public-identity",
): string {
  return `OCF2:${transfer}:${index}:${count}:${artifactType}`
}

export class FakeTransferAssembler {
  readonly #timeoutMs: number
  #transfer: string | null = null
  #artifactType: V2ArtifactType = "pq-public-identity"
  #count = 0
  #received = new Set<number>()
  #expiresAt = 0
  #terminal: TransferState | null = null

  constructor(options: { transferTimeoutMinutes: number }) {
    this.#timeoutMs = options.transferTimeoutMinutes * 60_000
  }

  async add(payload: string): Promise<TransferState> {
    if (this.#terminal) return this.#terminal
    const match = /^OCF2:([^:]+):(\d+):(\d+):(.+)$/u.exec(payload)
    if (!match) return this.#fail("INVALID_QR_PAYLOAD")
    const transfer = match[1]!
    const index = Number(match[2])
    const count = Number(match[3])
    const artifactType = match[4] as V2ArtifactType
    if (this.#transfer === null) {
      this.#transfer = transfer
      this.#artifactType = artifactType
      this.#count = count
      this.#expiresAt = Date.now() + this.#timeoutMs
    } else if (
      transfer !== this.#transfer ||
      count !== this.#count ||
      artifactType !== this.#artifactType
    ) {
      return this.#fail("FRAME_MISMATCH")
    }
    this.#received.add(index)
    if (this.#received.size === this.#count) {
      this.#terminal = {
        kind: "complete",
        transferId: encoder.encode(transfer).slice(0, 16),
        artifactType: this.#artifactType,
        artifactBytes: Uint8Array.of(this.#count),
      }
    }
    return this.state()
  }

  state(): TransferState {
    if (this.#terminal) return this.#terminal
    if (this.#transfer === null) return { kind: "idle" }
    if (Date.now() >= this.#expiresAt) {
      this.discard()
      return { kind: "idle" }
    }
    const missingIndexes = Array.from(
      { length: this.#count },
      (_, index) => index,
    ).filter((index) => !this.#received.has(index))
    return {
      kind: "collecting",
      transferId: encoder.encode(this.#transfer).slice(0, 16),
      artifactType: this.#artifactType,
      frameCount: this.#count,
      receivedIndexes: new Set(this.#received),
      missingIndexes,
      expiresAt: this.#expiresAt,
    }
  }

  discard(): void {
    this.#transfer = null
    this.#count = 0
    this.#received.clear()
    this.#terminal = null
  }

  #fail(code: ErrorCode): TransferState {
    this.#terminal = { kind: "error", code }
    return this.#terminal
  }
}

export const encryptPq = vi.fn(
  async ({
    recipient,
    plaintext,
    sign,
    now,
  }: {
    recipient: PqPublicBundleRecord
    plaintext: Uint8Array
    sign?: { identity: PostQuantumIdentity }
    now: number
  }) => {
    void now
    lastPqEnvelope = {
      version: 2,
      type: "pq-message",
      suite:
        sign === undefined
          ? "ML-KEM-1024+HKDF-SHA256+A256GCM"
          : "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: recipient.kem.keyId,
      kemCiphertext: new Uint8Array(1568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(plaintext.byteLength + (sign ? 3_500 : 128)),
    }
    return lastPqEnvelope
  },
)

export const fakePqDecrypt = {
  kind: "signed-valid" as "unsigned" | "signed-valid" | "signed-key-unknown",
}
export const decryptPqMessage = vi.fn(async () => {
  if (fakePqDecrypt.kind === "signed-key-unknown") {
    return { kind: "signed-key-unknown" as const, senderSigningKeyId: "T".repeat(22) }
  }
  if (fakePqDecrypt.kind === "unsigned") {
    return { kind: "unsigned" as const, plaintext: encoder.encode("PQ復号済み平文") }
  }
  return {
    kind: "signed-valid" as const,
    plaintext: encoder.encode("署名済みPQ復号結果"),
    senderSigningKeyId: "T".repeat(22),
  }
})

export const armMaintenanceToken = vi.fn(async () => undefined)

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
export const renameIdentity = vi.fn(async (id: string, name: string) => {
  const existing = fakeIdentities.find((identity) => identity.id === id)
  if (existing === undefined || existing.status === "rotated") {
    throw new AppError("KEY_NOT_FOUND")
  }
  existing.name = name.trim()
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

export const findIdentityByKemKeyId = vi.fn(async (keyId: string) =>
  fakeIdentities.find((identity) => identity.kem.keyId === keyId),
)
export const listIdentities = vi.fn(async () => [...fakeIdentities])
export const saveIdentity = vi.fn(async (identity: PostQuantumIdentity) => {
  fakeIdentities.unshift(identity)
})
export const saveRotation = vi.fn(
  async ({
    next,
    previous,
  }: {
    next: PostQuantumIdentity
    previous: PostQuantumIdentity
  }) => {
    const index = fakeIdentities.findIndex((identity) => identity.id === previous.id)
    if (index >= 0) fakeIdentities[index] = previous
    fakeIdentities.unshift(next)
  },
)
export const revokeIdentity = vi.fn(async (id: string, revokedAt: number) => {
  const index = fakeIdentities.findIndex((identity) => identity.id === id)
  if (index >= 0) {
    fakeIdentities[index] = {
      ...fakeIdentities[index]!,
      status: "revoked",
      revokedAt,
    }
  }
})
export const deleteIdentity = vi.fn(async (id: string) => {
  const index = fakeIdentities.findIndex((identity) => identity.id === id)
  if (index >= 0) fakeIdentities.splice(index, 1)
})
export const deleteSupersededIdentities = vi.fn(
  async (ids: readonly string[]) => {
    const requested = new Set(ids)
    const present = fakeIdentities.filter((identity) => requested.has(identity.id))
    if (present.some((identity) => identity.status === "active")) {
      throw new AppError("STORAGE_FAILED")
    }
    const presentIds = new Set(present.map((identity) => identity.id))
    for (let index = fakeIdentities.length - 1; index >= 0; index -= 1) {
      if (presentIds.has(fakeIdentities[index]!.id)) fakeIdentities.splice(index, 1)
    }
  },
)
export const clearAllIdentities = vi.fn(async () => {
  fakeIdentities.splice(0)
})
export const markIdentityUsed = vi.fn(async () => undefined)

export const listBundles = vi.fn(async () => [...fakeBundles])
export const saveBundle = vi.fn(async (record: PqPublicBundleRecord) => {
  fakeBundles.unshift(record)
})
export const confirmBundleFingerprint = vi.fn(async (recordId: string, when: number) => {
  const index = fakeBundles.findIndex((record) => record.recordId === recordId)
  if (index >= 0) {
    fakeBundles[index] = {
      ...fakeBundles[index]!,
      trust: "fingerprint-confirmed",
      trustConfirmedAt: when,
    }
  }
})
export const revokeBundle = vi.fn(async (recordId: string, revokedAt: number) => {
  const index = fakeBundles.findIndex((record) => record.recordId === recordId)
  if (index >= 0) fakeBundles[index] = { ...fakeBundles[index]!, revokedAt }
})
export const deleteBundle = vi.fn(async (recordId: string) => {
  const index = fakeBundles.findIndex((record) => record.recordId === recordId)
  if (index >= 0) fakeBundles.splice(index, 1)
})
export const markBundleUsed = vi.fn(async () => undefined)
export const findBundleBySigningKeyId = vi.fn(async (keyId: string) =>
  fakeBundles.find((record) => record.signing.keyId === keyId),
)
export const findBundleByKemKeyId = vi.fn(async (keyId: string) =>
  fakeBundles.find((record) => record.kem.keyId === keyId),
)

export const getPreferences = vi.fn(async () => ({ ...fakePreferences }))
export const updatePreferences = vi.fn(async (patch: Partial<Preferences>) => {
  Object.assign(fakePreferences, patch)
  return { ...fakePreferences }
})
export const deleteEntireDatabase = vi.fn(async () => {
  fakeKeys.splice(0)
  fakeIdentities.splice(0)
  fakeBundles.splice(0)
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
  const identity = defaultIdentity()
  fakeIdentities.splice(0, fakeIdentities.length, identity)
  fakeBundles.splice(0, fakeBundles.length, recordFromIdentity(identity))
  Object.assign(fakePreferences, {
    ...PQ_PREFERENCE_DEFAULTS,
    defaultAlgorithm: "A256GCM",
    frameBytes: 1_000,
    frameIntervalMs: 200,
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
  lastPqEnvelope = {
    version: 2,
    type: "pq-message",
    suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
    recipientKemKeyId: identity.kem.keyId,
    kemCiphertext: new Uint8Array(1568),
    hkdfSalt: new Uint8Array(32),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(32),
  }
  lastPublicBundle = null
  lastKemEnvelope = null
  lastDsaEnvelope = null
  fakePqDecrypt.kind = "signed-valid"
  scanTextCallback = null
  scanErrorCallback = null
  vi.clearAllMocks()
}
