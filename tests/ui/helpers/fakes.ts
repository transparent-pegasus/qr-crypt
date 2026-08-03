import { useState } from "react"
import { vi } from "vitest"
import type { RegisterSWOptions } from "virtual:pwa-register/react"
import { AppError, type ErrorCode } from "@/crypto/errors"
import type { DecryptPqMessageArgs } from "@/crypto/pq/decrypt-orchestrator"
import type { ReceiptSubject, ReceiptVerdict } from "@/features/receipt-cache"
import { storeOnlyZip } from "@/lib/best-effort-zip"
import { fromBase64Url } from "@/lib/base64url"
import type { FeatureSupport } from "@/lib/feature-detect"
import type { QrExportOptions } from "@/qr/export-image"
import type { TransferState } from "@/qr/multipart/transfer-state"
import type {
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
  PqDecryptResult,
  PqPublicBundleRecord,
  Preferences,
  PublicIdentityBundleV2,
  QrFrameV2,
  StoredKeyRecord,
  SymMessageEnvelopeV2,
  SymmetricKeyEnvelopeV2,
  V2ArtifactType,
} from "@/schemas/domain"
import { PQ_PREFERENCE_DEFAULTS } from "@/schemas/domain"
import {
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  SYM_MESSAGE_OVERHEAD_BYTES,
} from "@/lib/limits"

const encoder = new TextEncoder()

function cryptoKey(): CryptoKey {
  return {
    type: "secret",
    extractable: true,
    algorithm: { name: "AES-GCM", length: 256 },
    usages: ["encrypt", "decrypt"],
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
      status: "active",
      symmetricKey: cryptoKey(),
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
  autoClearPlaintextAfterEncrypt: true,
  backgroundClearEnabled: true,
}
const defaultPreferencesSnapshot: Preferences = { ...fakePreferences }
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
let lastSymMessageEnvelope: SymMessageEnvelopeV2 | null = null
const symmetricFingerprintsByKeyId = new Map<string, string>()
let lastPqEnvelope: MlKemMessageEnvelopeV2 = {
  version: 2,
  type: "pq-message",
  suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
  recipientKemKeyId: KEM_KEY_ID,
  kemCiphertext: new Uint8Array(1568),
  iv: new Uint8Array(12),
  ciphertext: new Uint8Array(128),
}
let lastPublicBundle: PublicIdentityBundleV2 | null = null

export const detectFeatures = vi.fn(() => ({ ...fakeFeatures }))
let webAssemblyRuntimeSettled: boolean | undefined
let webAssemblyProbeGeneration = 0
export const probeWebAssemblyRuntime = vi.fn(async () => true)
export const webAssemblyRuntimeSupport = vi.fn(
  (): boolean | undefined => webAssemblyRuntimeSettled,
)

export function mockWebAssemblyProbe(result: boolean | Promise<boolean>): void {
  const generation = ++webAssemblyProbeGeneration
  webAssemblyRuntimeSettled = undefined
  const promise = Promise.resolve(result)
  probeWebAssemblyRuntime.mockReturnValue(promise)
  void promise.then((value) => {
    if (generation === webAssemblyProbeGeneration) {
      webAssemblyRuntimeSettled = value
    }
  })
}

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

export const sealSymMessage = vi.fn(
  async ({
    record,
    plaintext,
    now,
  }: {
    record: StoredKeyRecord
    plaintext: Uint8Array
    now: number
  }): Promise<SymMessageEnvelopeV2> => {
    const envelope: SymMessageEnvelopeV2 = {
      version: 2,
      type: "sym-message",
      suite: "HKDF-SHA256+A256GCM",
      keyId: record.id,
      createdAt: now,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]),
    }
    lastSymMessageEnvelope = envelope
    return envelope
  },
)
export const openSymMessage = vi.fn(async () =>
  encoder.encode("sym-v2復号済み平文"),
)
export const generateAesKey = vi.fn(async () => cryptoKey())
function generatedFingerprint(counter: number): string {
  return counter.toString(16).padStart(64, "0")
}

export const createSymmetricKeyRecord = vi.fn(
  async (name: string, now: number): Promise<StoredKeyRecord> => {
    keyCounter += 1
    return {
      id: `G${String(keyCounter).padStart(21, "0")}`,
      name,
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: generatedFingerprint(100 + keyCounter),
      createdAt: now,
      useCount: 0,
      status: "active",
      symmetricKey: cryptoKey(),
    }
  },
)

async function defaultRotateSymmetricKeyRecord(
  current: StoredKeyRecord,
  now: number,
): Promise<{ next: StoredKeyRecord; previous: StoredKeyRecord }> {
  const created = await createSymmetricKeyRecord(current.name, now)
  return {
    next: { ...created, rotatedFromId: current.id },
    previous: { ...current, status: "rotated", rotatedAt: now },
  }
}

export const rotateSymmetricKeyRecord = vi.fn(
  defaultRotateSymmetricKeyRecord,
)
export const buildSymmetricKeyEnvelopeV2 = vi.fn(
  async (record: StoredKeyRecord): Promise<SymmetricKeyEnvelopeV2> => {
    if (
      record.status !== "active"
    ) {
      throw new AppError("KEY_TYPE_MISMATCH")
    }
    symmetricFingerprintsByKeyId.set(record.id, record.fingerprint)
    return {
      version: 2,
      type: "symmetric-key",
      algorithm: "A256GCM",
      keyId: record.id,
      createdAt: record.createdAt,
      key: new Uint8Array(32).fill(0x7c),
    }
  },
)
export const importSymmetricKeyRecordV2 = vi.fn(
  async (name: string, envelope: SymmetricKeyEnvelopeV2, now: number) => {
    const record: StoredKeyRecord = {
      id: envelope.keyId,
      name,
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint:
        symmetricFingerprintsByKeyId.get(envelope.keyId) ?? generatedFingerprint(302),
      createdAt: now,
      useCount: 0,
      status: "active",
      symmetricKey: cryptoKey(),
    }
    envelope.key.fill(0)
    return record
  },
)
export const decodePayload = vi.fn((payload: string) => {
  if (payload.startsWith("OCK2:")) {
    return {
      kind: "symmetric-key" as const,
      envelope: decodeSymmetricKeyEnvelopeV2(
        fromBase64Url(payload.slice("OCK2:".length)),
      ),
    }
  }
  if (payload.startsWith("OCM2:")) {
    return { kind: "pq-message" as const, envelope: lastPqEnvelope }
  }
  if (payload.startsWith("OCA2:")) {
    return {
      kind: "sym-message" as const,
      envelope:
        lastSymMessageEnvelope ??
        ({
          version: 2,
          type: "sym-message",
          suite: "HKDF-SHA256+A256GCM",
          keyId: payload.slice("OCA2:".length),
          createdAt: 1_723_000_000_001,
          iv: new Uint8Array(12),
          ciphertext: new Uint8Array(16),
        } satisfies SymMessageEnvelopeV2),
    }
  }
  if (payload.startsWith("OCI2:")) {
    return {
      kind: "pq-public-identity" as const,
      envelope: lastPublicBundle ?? buildPublicBundle(fakeIdentities[0]!),
    }
  }
  throw new AppError("INVALID_QR_PREFIX")
})
export const payloadSha256Hex = vi.fn(async (payload: string) =>
  encoder.encode(payload).byteLength.toString(16).padStart(64, "0"),
)
export const recordReceipt = vi.fn<
  (subject: ReceiptSubject, now: number) => ReceiptVerdict
>(() => ({ kind: "first-seen" }) as const)
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

type FakeCameraFailureState = "failed" | "track-ended"

export const scannerStop = vi.fn()
export const readerModuleState = vi.fn<
  () => "idle" | "preparing" | "ready" | "failed"
>(() => "ready")
export const warmQrReader = vi.fn<() => Promise<void>>(() => Promise.resolve())
let scanTextCallback: ((payload: string) => void) | null = null
export const startQrScan = vi.fn(
  async (
    _video: HTMLVideoElement,
    onText: (payload: string) => void,
    _onError: (error: AppError, failureState: FakeCameraFailureState) => void,
    _options?: {
      once?: boolean
      signal?: AbortSignal
    },
  ): Promise<{ stop: () => void }> => {
    void _options
    scanTextCallback = onText
    return { stop: scannerStop }
  },
)
export function emitScannedPayload(payload: string): void {
  scanTextCallback?.(payload)
}

export const disposePqClient = vi.fn()
export const createPqCryptoClient = vi.fn(() => ({ dispose: disposePqClient }))
export const getOrCreateVaultKey = vi.fn(async () => cryptoKey())

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
export const encodeSymMessageEnvelopeV2 = vi.fn(
  (envelope: SymMessageEnvelopeV2) => {
    lastSymMessageEnvelope = envelope
    return new Uint8Array(
      SYM_MESSAGE_OVERHEAD_BYTES + envelope.ciphertext.byteLength,
    )
  },
)
export const decodeSymMessageEnvelopeV2 = vi.fn(() => {
  if (lastSymMessageEnvelope === null) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  return lastSymMessageEnvelope
})
export const encodeSymmetricKeyEnvelopeV2 = vi.fn<
  (envelope: SymmetricKeyEnvelopeV2) => Uint8Array
>()
export const decodeSymmetricKeyEnvelopeV2 = vi.fn<
  (bytes: Uint8Array) => SymmetricKeyEnvelopeV2
>()
export const encodePublicIdentityBundleV2 = vi.fn((bundle: PublicIdentityBundleV2) => {
  lastPublicBundle = bundle
  return new Uint8Array(3_400)
})
export const decodePublicIdentityBundleV2 = vi.fn(
  () => lastPublicBundle ?? buildPublicBundle(fakeIdentities[0]!),
)

// Mirrors the one surviving generation mode: uniform chunks with a possibly
// shorter final one. Offering the retired balanced frameCount mode here would
// let a UI test drive a partition the product can no longer produce.
export const splitIntoFrames = vi.fn(
  async ({
    artifactType,
    artifactBytes,
    frameBytes,
  }: {
    artifactType: V2ArtifactType
    artifactBytes: Uint8Array
    frameBytes: number
  }): Promise<QrFrameV2[]> => {
    if (artifactBytes.byteLength > MAX_ARTIFACT_BYTES_ABSOLUTE) {
      throw new AppError("QR_TOO_LARGE")
    }
    const frameCount = Math.max(
      1,
      Math.ceil(artifactBytes.byteLength / frameBytes),
    )
    let offset = 0
    return Array.from({ length: frameCount }, (_, frameIndex) => {
      const frame: QrFrameV2 = {
        version: 2,
        type: "qr-frame",
        transferId: new Uint8Array(16).fill(3),
        artifactType,
        frameIndex,
        frameCount,
        totalByteLength: artifactBytes.byteLength,
        chunk: artifactBytes.slice(offset, offset + frameBytes),
      }
      offset += frameBytes
      return frame
    })
  },
)

export function multipartPayload(
  transfer: string,
  index: number,
  count: number,
  artifactType: V2ArtifactType = "pq-public-identity",
): string {
  return `OCF2:${transfer}:${index}:${count}:${artifactType}`
}

let nextMultipartAddGate: Promise<void> | null = null
let nextMultipartArtifactBytes: Uint8Array | null = null

export function deferNextMultipartAdd(gate: Promise<void>): void {
  nextMultipartAddGate = gate
}

export function setNextMultipartArtifactBytes(bytes: Uint8Array): void {
  nextMultipartArtifactBytes = bytes.slice()
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
    const gate = nextMultipartAddGate
    nextMultipartAddGate = null
    if (gate !== null) await gate
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
      const artifactBytes =
        nextMultipartArtifactBytes?.slice() ?? Uint8Array.of(this.#count)
      nextMultipartArtifactBytes = null
      this.#terminal = {
        kind: "complete",
        transferId: encoder.encode(transfer).slice(0, 16),
        artifactType: this.#artifactType,
        artifactBytes,
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
    sign: { identity: PostQuantumIdentity }
    now: number
  }) => {
    void now
    void sign
    lastPqEnvelope = {
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: recipient.kem.keyId,
      kemCiphertext: new Uint8Array(1568),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(plaintext.byteLength + 3_500),
    }
    return lastPqEnvelope
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

export const armMaintenanceToken = vi.fn(async () => undefined)

export const listKeyRecords = vi.fn(async () => [...fakeKeys])
export const saveKeyRecord = vi.fn(async (record: StoredKeyRecord) => {
  if (fakeKeys.some((item) => item.fingerprint === record.fingerprint)) {
    throw new AppError("DUPLICATE_KEY")
  }
  fakeKeys.unshift(record)
})
export const getKeyRecord = vi.fn(async (id: string) =>
  fakeKeys.find((record) => record.id === id),
)
async function defaultGetActiveKeyRecord(
  id: string,
): Promise<StoredKeyRecord | undefined> {
  const record = fakeKeys.find((item) => item.id === id)
  return record?.status === "active" ? record : undefined
}
export const getActiveKeyRecord = vi.fn(defaultGetActiveKeyRecord)
async function defaultSaveSymmetricRotation({
  next,
  previous,
}: {
  next: StoredKeyRecord
  previous: StoredKeyRecord
}): Promise<void> {
  const index = fakeKeys.findIndex((item) => item.id === previous.id)
  const persisted = fakeKeys[index]
  if (
    persisted === undefined ||
    persisted.status !== "active" ||
    persisted.fingerprint !== previous.fingerprint
  ) {
    throw new AppError("STORAGE_FAILED")
  }
  fakeKeys[index] = previous
  fakeKeys.unshift(next)
}
export const saveSymmetricRotation = vi.fn(defaultSaveSymmetricRotation)
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

export const groupSymmetricKeys = vi.fn((records: StoredKeyRecord[]) => {
  const byId = new Map(records.map((record) => [record.id, record]))
  const superseded = new Set(
    records
      .map((record) => record.rotatedFromId)
      .filter((id): id is string => id !== undefined),
  )
  return records
    .filter((record) => !superseded.has(record.id))
    .map((head) => {
      const previous: StoredKeyRecord[] = []
      const visited = new Set([head.id])
      for (let cursor = head.rotatedFromId; cursor !== undefined;) {
        const generation = byId.get(cursor)
        if (generation === undefined || visited.has(generation.id)) break
        visited.add(generation.id)
        previous.push(generation)
        cursor = generation.rotatedFromId
      }
      return { head, previous }
    })
})

async function defaultFindBundleBySigningKeyId(keyId: string) {
  return fakeBundles.find(
    (record) => record.signing.keyId === keyId && record.revokedAt === undefined,
  )
}

async function defaultFindBundleByKemKeyId(keyId: string) {
  return fakeBundles.find(
    (record) => record.kem.keyId === keyId && record.revokedAt === undefined,
  )
}

export const findBundleBySigningKeyId = vi.fn(defaultFindBundleBySigningKeyId)
export const findBundleByKemKeyId = vi.fn(defaultFindBundleByKemKeyId)

function defaultFakePreferences(): Preferences {
  return { ...defaultPreferencesSnapshot }
}

export const defaultPreferences = vi.fn(defaultFakePreferences)
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
  lastSymMessageEnvelope = null
  symmetricFingerprintsByKeyId.clear()
  lastPqEnvelope = {
    version: 2,
    type: "pq-message",
    suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
    recipientKemKeyId: identity.kem.keyId,
    kemCiphertext: new Uint8Array(1568),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(32),
  }
  lastPublicBundle = null
  fakePqDecrypt.kind = "signed-valid"
  scanTextCallback = null
  nextMultipartAddGate = null
  nextMultipartArtifactBytes = null
  decryptPqMessage.mockImplementation(defaultDecryptPqMessage)
  rotateSymmetricKeyRecord.mockImplementation(defaultRotateSymmetricKeyRecord)
  getActiveKeyRecord.mockImplementation(defaultGetActiveKeyRecord)
  saveSymmetricRotation.mockImplementation(defaultSaveSymmetricRotation)
  findBundleBySigningKeyId.mockImplementation(defaultFindBundleBySigningKeyId)
  findBundleByKemKeyId.mockImplementation(defaultFindBundleByKemKeyId)
  recordReceipt.mockImplementation(() => ({ kind: "first-seen" }) as const)
  webAssemblyProbeGeneration += 1
  webAssemblyRuntimeSettled = undefined
  vi.clearAllMocks()
  defaultPreferences.mockImplementation(defaultFakePreferences)
  probeWebAssemblyRuntime.mockImplementation(async () => true)
  webAssemblyRuntimeSupport.mockImplementation(() => webAssemblyRuntimeSettled)
  readerModuleState.mockImplementation(() => "ready")
  warmQrReader.mockImplementation(() => Promise.resolve())
}
