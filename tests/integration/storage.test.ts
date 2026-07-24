import { afterEach, describe, expect, it } from "vitest"
import { readBootDecision } from "@/app/boot/boot-controller"
import { decryptWithAesKey, encryptWithAesKey } from "@/crypto/aes-gcm"
import { env } from "@/schemas/env-schema"
import {
  buildSymmetricKeyEnvelope,
  createSymmetricKeyRecord,
} from "@/crypto/key-generation"
import { generateArtifactId, generateKeyId } from "@/crypto/random"
import {
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodeMlKemEnvelopeV2,
  encodePublicIdentityBundleV2,
} from "@/crypto/pq/canonical-cbor"
import { toBase64Url } from "@/lib/base64url"
import { bytesToHex, utf8ByteLength, utf8ToBytes } from "@/lib/bytes"
import { encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import { buildV2Payload, encodeFrameToPayload } from "@/qr/payload-v2"
import type {
  PqProfileId,
  StorablePqArtifactKind,
  StoredKeyRecord,
  StoredQrArtifact,
  UiAlgorithm,
} from "@/schemas/domain"
import {
  closeDb,
  DB_VERSION,
  deleteEntireDatabase,
  getDb,
  STORE_APP_METADATA,
  STORE_KEYS,
  STORE_PQ_IDENTITIES,
  STORE_PQ_PUBLIC_BUNDLES,
  STORE_PREFERENCES,
  STORE_QR_ARTIFACTS,
} from "@/storage/database"
import {
  clearAllKeys,
  deleteKeyRecord,
  findKeyByFingerprint,
  getKeyRecord,
  listKeyRecords,
  markKeyUsed,
  renameKeyRecord,
  saveKeyRecord,
} from "@/storage/key-repository"
import { getPreferences, updatePreferences } from "@/storage/preferences-repository"
import {
  clearAllQrArtifacts,
  deleteQrArtifact,
  findQrByPayloadSha256,
  listQrArtifacts,
  markQrViewed,
  renameQrArtifact,
  saveQrArtifact,
} from "@/storage/qr-repository"

const NOW = 1_700_000_000_000

afterEach(async () => {
  await deleteEntireDatabase()
})

async function qrArtifact(
  name: string,
  envelope: Parameters<typeof encodeEnvelopeToPayload>[0],
  overrides: Partial<StoredQrArtifact> = {},
): Promise<StoredQrArtifact> {
  const payload = encodeEnvelopeToPayload(envelope)
  const kind = envelope.type === "symmetric-key" ? "symmetric-key" : "public-key"
  const sensitivity = kind === "public-key" ? "public" : "secret"
  if (envelope.type === "message") throw new Error("message artifacts are not persistent")
  const keyId = envelope.keyId
  return {
    id: generateArtifactId(),
    name,
    kind,
    sensitivity,
    algorithm: envelope.algorithm,
    payload,
    payloadSha256: await payloadSha256Hex(payload),
    byteLength: utf8ByteLength(payload),
    createdAt: NOW,
    keyId,
    ...overrides,
  }
}

async function pqQrArtifacts(): Promise<StoredQrArtifact[]> {
  const identityId = "I".repeat(22)
  const kemKeyId = "K".repeat(22)
  const dsaKeyId = "S".repeat(22)
  const createdAt = NOW
  const definitions: {
    name: string
    kind: StorablePqArtifactKind
    bytes: Uint8Array
    algorithm: string
    keyId: string
  }[] = [
    {
      name: "公開鍵セット",
      kind: "pq-public-identity",
      bytes: encodePublicIdentityBundleV2({
        version: 2,
        type: "pq-public-identity",
        identityId,
        name: "保存テスト",
        kem: {
          algorithm: "ML-KEM-1024",
          keyId: kemKeyId,
          publicKey: new Uint8Array(1568).fill(1),
        },
        signing: {
          algorithm: "ML-DSA-87",
          keyId: dsaKeyId,
          publicKey: new Uint8Array(2592).fill(2),
        },
        createdAt,
      }),
      algorithm: "ML-KEM-1024+ML-DSA-87",
      keyId: identityId,
    },
    {
      name: "暗号化用公開鍵",
      kind: "pq-kem-public-key",
      bytes: encodeKemPublicKeyEnvelopeV2({
        version: 2,
        type: "pq-kem-public-key",
        identityId,
        name: "保存テスト",
        algorithm: "ML-KEM-1024",
        keyId: kemKeyId,
        publicKey: new Uint8Array(1568).fill(1),
        createdAt,
      }),
      algorithm: "ML-KEM-1024",
      keyId: kemKeyId,
    },
    {
      name: "署名検証用公開鍵",
      kind: "pq-dsa-public-key",
      bytes: encodeDsaPublicKeyEnvelopeV2({
        version: 2,
        type: "pq-dsa-public-key",
        identityId,
        name: "保存テスト",
        algorithm: "ML-DSA-87",
        keyId: dsaKeyId,
        publicKey: new Uint8Array(2592).fill(2),
        createdAt,
      }),
      algorithm: "ML-DSA-87",
      keyId: dsaKeyId,
    },
  ]

  return Promise.all(
    definitions.map(async (definition, index) => {
      const payload = buildV2Payload(definition.kind, definition.bytes)
      return {
        id: generateArtifactId(),
        name: definition.name,
        kind: definition.kind,
        sensitivity: "public",
        algorithm: definition.algorithm,
        payload,
        payloadSha256: await payloadSha256Hex(payload),
        byteLength: utf8ByteLength(payload),
        createdAt: NOW + index,
        keyId: definition.keyId,
      }
    }),
  )
}

describe("database creation and migrations", () => {
  it("creates all v2 stores/indexes and reopens without rerunning destructive setup", async () => {
    const database = await getDb()
    expect(database.version).toBe(DB_VERSION)
    expect(Array.from(database.objectStoreNames).sort()).toEqual(
      [
        STORE_APP_METADATA,
        STORE_KEYS,
        STORE_PQ_IDENTITIES,
        STORE_PQ_PUBLIC_BUNDLES,
        STORE_PREFERENCES,
        STORE_QR_ARTIFACTS,
      ].sort(),
    )
    const keyTx = database.transaction(STORE_KEYS)
    expect(Array.from(keyTx.store.indexNames).sort()).toEqual([
      "by-createdAt",
      "by-fingerprint",
    ])
    const qrTx = database.transaction(STORE_QR_ARTIFACTS)
    expect(Array.from(qrTx.store.indexNames).sort()).toEqual([
      "by-createdAt",
      "by-payloadSha256",
    ])
    const record = await createSymmetricKeyRecord("再オープン", NOW)
    await saveKeyRecord(record)
    closeDb()
    expect((await getDb()).version).toBe(2)
    expect((await getKeyRecord(record.id))?.fingerprint).toBe(record.fingerprint)
  })
})

describe("key repository", () => {
  it("supports CRUD, lookup, atomic usage increments, and CryptoKey reuse after reopen", async () => {
    const first = await createSymmetricKeyRecord("鍵A", NOW)
    const second = await createSymmetricKeyRecord("鍵B", NOW + 1)
    await saveKeyRecord(first)
    await saveKeyRecord(second)
    expect((await listKeyRecords()).map((record) => record.id)).toEqual([
      second.id,
      first.id,
    ])
    expect((await findKeyByFingerprint(first.fingerprint))?.id).toBe(first.id)
    await renameKeyRecord(first.id, " 鍵A改 ")
    await Promise.all(Array.from({ length: 5 }, () => markKeyUsed(first.id, NOW + 2)))
    const used = await getKeyRecord(first.id)
    expect(used?.name).toBe("鍵A改")
    expect(used?.useCount).toBe(5)
    expect(used?.lastUsedAt).toBe(NOW + 2)

    const beforeClose = await encryptWithAesKey({
      key: first.symmetricKey!,
      keyId: first.id,
      plaintext: utf8ToBytes("再起動後"),
      now: NOW + 3,
    })
    closeDb()
    const restored = await getKeyRecord(first.id)
    expect(restored?.symmetricKey).toBeDefined()
    expect(
      await decryptWithAesKey({
        key: restored!.symmetricKey!,
        envelope: beforeClose,
      }),
    ).toEqual(utf8ToBytes("再起動後"))

    await deleteKeyRecord(second.id)
    expect(await getKeyRecord(second.id)).toBeUndefined()
    await clearAllKeys()
    expect(await listKeyRecords()).toEqual([])
  })

  it("rejects duplicate fingerprints and isolates malformed persisted records", async () => {
    const valid = await createSymmetricKeyRecord("元鍵", NOW)
    await saveKeyRecord(valid)
    const duplicate: StoredKeyRecord = {
      ...valid,
      id: generateKeyId(),
      name: "複製",
    }
    await expect(saveKeyRecord(duplicate)).rejects.toMatchObject({
      code: "DUPLICATE_KEY",
    })

    await clearAllKeys()
    const raceA = { ...valid, id: generateKeyId(), name: "競合A" }
    const raceB = { ...valid, id: generateKeyId(), name: "競合B" }
    const settled = await Promise.allSettled([saveKeyRecord(raceA), saveKeyRecord(raceB)])
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(settled.find((result) => result.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: { code: "DUPLICATE_KEY" },
    })

    const malformed = {
      ...valid,
      id: generateKeyId(),
      fingerprint: "f".repeat(64),
      algorithm: "AES-ECB",
    } as StoredKeyRecord
    await (await getDb()).add(STORE_KEYS, malformed)
    expect((await listKeyRecords()).map((record) => record.id)).not.toContain(
      malformed.id,
    )
    await expect(getKeyRecord(malformed.id)).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    })
  })
})

describe("QR repository", () => {
  it("supports CRUD, view timestamps, duplicate confirmation, and concurrent detection", async () => {
    const key = await createSymmetricKeyRecord("QR鍵", NOW)
    const envelope = await buildSymmetricKeyEnvelope(key)
    const first = await qrArtifact("QR-A", envelope)
    await saveQrArtifact(first)
    await expect(
      saveQrArtifact(await qrArtifact("QR-B", envelope)),
    ).rejects.toMatchObject({ code: "DUPLICATE_QR" })
    const allowed = await qrArtifact("QR-C", envelope)
    await saveQrArtifact(allowed, { allowDuplicate: true })
    expect(await findQrByPayloadSha256(first.payloadSha256)).toBeDefined()

    await renameQrArtifact(first.id, " QR-改 ")
    await markQrViewed(first.id, NOW + 4)
    expect(
      await getDb().then((db) => db.get(STORE_QR_ARTIFACTS, first.id)),
    ).toMatchObject({
      name: "QR-改",
      lastViewedAt: NOW + 4,
    })
    await deleteQrArtifact(allowed.id)

    await clearAllQrArtifacts()
    const raceA = await qrArtifact("競合A", envelope)
    const raceB = await qrArtifact("競合B", envelope)
    const settled = await Promise.allSettled([
      saveQrArtifact(raceA),
      saveQrArtifact(raceB),
    ])
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = settled.find((result) => result.status === "rejected")
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "DUPLICATE_QR" },
    })
  })

  it("sorts records and filters malformed artifacts", async () => {
    const key = await createSymmetricKeyRecord("QR鍵", NOW)
    const envelope = await buildSymmetricKeyEnvelope(key)
    const older = await qrArtifact("古い", envelope, { createdAt: NOW })
    const newer = await qrArtifact("新しい", envelope, {
      id: generateArtifactId(),
      createdAt: NOW + 1,
      payloadSha256: "e".repeat(64),
    })
    await saveQrArtifact(older)
    await saveQrArtifact(newer)
    expect((await listQrArtifacts()).map((artifact) => artifact.id)).toEqual([
      newer.id,
      older.id,
    ])
    const malformed = {
      ...older,
      id: generateArtifactId(),
      payloadSha256: "d".repeat(64),
      sensitivity: "public",
    } as StoredQrArtifact
    await (await getDb()).add(STORE_QR_ARTIFACTS, malformed)
    expect((await listQrArtifacts()).map((artifact) => artifact.id)).not.toContain(
      malformed.id,
    )
  })

  it("round-trips, renames, and marks all storable PQ public QR kinds", async () => {
    const artifacts = await pqQrArtifacts()
    for (const artifact of artifacts) await saveQrArtifact(artifact)

    for (const [index, artifact] of artifacts.entries()) {
      await renameQrArtifact(artifact.id, `PQ QR ${index + 1}`)
      await markQrViewed(artifact.id, NOW + 100 + index)
    }

    const listed = await listQrArtifacts()
    expect(listed).toHaveLength(3)
    for (const [index, artifact] of artifacts.entries()) {
      expect(listed.find((entry) => entry.id === artifact.id)).toMatchObject({
        kind: artifact.kind,
        name: `PQ QR ${index + 1}`,
        sensitivity: "public",
        algorithm: artifact.algorithm,
        keyId: artifact.keyId,
        lastViewedAt: NOW + 100 + index,
      })
    }
  })

  it("rejects PQ payload metadata mismatches and quarantines malformed raw rows", async () => {
    const [identity, kem] = await pqQrArtifacts()
    expect(identity).toBeDefined()
    expect(kem).toBeDefined()
    const invalidArtifacts: StoredQrArtifact[] = [
      {
        ...kem!,
        id: generateArtifactId(),
        kind: "pq-dsa-public-key",
      },
      {
        ...kem!,
        id: generateArtifactId(),
        algorithm: "ML-KEM-768",
      },
      {
        ...kem!,
        id: generateArtifactId(),
        keyId: "Z".repeat(22),
      },
      {
        ...identity!,
        id: generateArtifactId(),
        sensitivity: "secret",
      },
    ]

    for (const artifact of invalidArtifacts) {
      await expect(saveQrArtifact(artifact)).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      })
    }
    expect(await (await getDb()).count(STORE_QR_ARTIFACTS)).toBe(0)

    const malformedRaw = {
      ...identity!,
      id: generateArtifactId(),
      algorithm: "ML-KEM-1024",
    }
    await (await getDb()).add(STORE_QR_ARTIFACTS, malformedRaw)
    expect((await listQrArtifacts()).map((artifact) => artifact.id)).not.toContain(
      malformedRaw.id,
    )
  })

  it("rejects OCM2 and OCF2 message artifacts at the active-kind boundary", async () => {
    const recipientKemKeyId = generateKeyId()
    const ocm2 = buildV2Payload(
      "pq-message",
      encodeMlKemEnvelopeV2({
        version: 2,
        type: "pq-message",
        suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
        recipientKemKeyId,
        kemCiphertext: new Uint8Array(1568),
        hkdfSalt: new Uint8Array(32),
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(16),
      }),
    )
    const ocf2 = encodeFrameToPayload({
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16),
      artifactType: "pq-message",
      frameIndex: 0,
      frameCount: 1,
      totalByteLength: 1,
      payloadSha256: new Uint8Array(32),
      chunk: Uint8Array.of(1),
    })

    for (const payload of [ocm2, ocf2]) {
      const messageArtifact = {
        id: generateArtifactId(),
        name: "保存禁止メッセージ",
        kind: "pq-message",
        sensitivity: "confidential",
        algorithm: "ML-KEM-1024",
        payload,
        payloadSha256: await payloadSha256Hex(payload),
        byteLength: utf8ByteLength(payload),
        createdAt: NOW,
        keyId: recipientKemKeyId,
      } as unknown as StoredQrArtifact
      await expect(saveQrArtifact(messageArtifact)).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      })
    }
    expect(await (await getDb()).count(STORE_QR_ARTIFACTS)).toBe(0)
  })
})

describe("preferences and plaintext non-persistence", () => {
  it("uses env defaults and validates persisted updates", async () => {
    // 既定は env 由来(.env.local の有無で変わる)— クリーンチェックアウトでも
    // 成立するよう env-schema の解決値を単一の真実として参照する
    expect(await getPreferences()).toMatchObject({
      defaultAlgorithm: env.defaultAlgorithm,
      qrErrorCorrection: "Q",
      autoClearPlaintextAfterEncrypt: true,
      backgroundClearEnabled: true,
    })
    expect(
      await updatePreferences({
        defaultAlgorithm: "MLKEM1024_MLDSA87_A256GCM",
        qrErrorCorrection: "M",
        autoClearPlaintextAfterEncrypt: false,
        backgroundClearEnabled: false,
      }),
    ).toMatchObject({
      defaultAlgorithm: "MLKEM1024_MLDSA87_A256GCM",
      qrErrorCorrection: "M",
      autoClearPlaintextAfterEncrypt: false,
      backgroundClearEnabled: false,
    })
    await expect(
      updatePreferences({
        backgroundClearEnabled: "invalid" as unknown as boolean,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" })
    await (
      await getDb()
    ).put(STORE_PREFERENCES, {
      key: "preferences",
      value: { qrErrorCorrection: "H", backgroundClearSeconds: 12 },
    })
    const migrated = await getPreferences()
    expect(migrated).toMatchObject({
      defaultAlgorithm: env.defaultAlgorithm,
      qrErrorCorrection: "H",
      autoClearPlaintextAfterEncrypt: true,
      backgroundClearEnabled: true,
    })
    expect(migrated).not.toHaveProperty("backgroundClearSeconds")
  })

  it("normalizes legacy PQ/RSA preferences while boot preserves wipeOnOnline=false", async () => {
    const database = await getDb()
    await database.put(STORE_KEYS, { id: "confirmed-sensitive-row" } as never)
    const cases = [
      ["MLKEM768_A256GCM", "MLKEM1024_A256GCM"],
      ["MLKEM768_MLDSA65_A256GCM", "MLKEM1024_MLDSA87_A256GCM"],
      ["RSA-HYBRID", "A256GCM"],
    ] as const

    for (const [legacyAlgorithm, expectedAlgorithm] of cases) {
      await database.put(STORE_PREFERENCES, {
        key: "preferences",
        value: {
          defaultAlgorithm: legacyAlgorithm,
          defaultPqProfile: "balanced",
          wipeOnOnline: false,
        },
      })

      await expect(getPreferences()).resolves.toMatchObject({
        defaultAlgorithm: expectedAlgorithm,
        defaultPqProfile: "maximum",
        wipeOnOnline: false,
      })
      await expect(readBootDecision()).resolves.toMatchObject({
        preferencesReadFailed: false,
        sensitiveDataExists: true,
        wipeOnOnline: false,
      })
    }
  })

  it("rejects legacy algorithm and balanced profile injection through updates", async () => {
    for (const defaultAlgorithm of ["MLKEM768_A256GCM", "MLKEM768_MLDSA65_A256GCM"]) {
      await expect(
        updatePreferences({
          defaultAlgorithm: defaultAlgorithm as unknown as UiAlgorithm,
        }),
      ).rejects.toMatchObject({ code: "STORAGE_FAILED" })
    }
    await expect(
      updatePreferences({
        defaultPqProfile: "balanced" as unknown as PqProfileId,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" })
  })

  it("rejects disguised message artifacts before writing and leaves no plaintext in any store", async () => {
    const secret = "秘密テキストXYZ-検査用"
    const plaintext = utf8ToBytes(secret)
    const aesRecord = await createSymmetricKeyRecord("AES保管", NOW)
    await saveKeyRecord(aesRecord)
    const keyEnvelope = await buildSymmetricKeyEnvelope(aesRecord)
    const retainedKeyQr = await qrArtifact("鍵QR", keyEnvelope)
    await saveQrArtifact(retainedKeyQr)

    const aesEnvelope = await encryptWithAesKey({
      key: aesRecord.symmetricKey!,
      keyId: aesRecord.id,
      plaintext,
      now: NOW + 2,
    })
    const ocm1 = encodeEnvelopeToPayload(aesEnvelope)
    const recipientKemKeyId = generateKeyId()
    const ocm2 = buildV2Payload(
      "pq-message",
      encodeMlKemEnvelopeV2({
        version: 2,
        type: "pq-message",
        suite: "ML-KEM-768+HKDF-SHA256+A256GCM",
        recipientKemKeyId,
        kemCiphertext: new Uint8Array(1088),
        hkdfSalt: new Uint8Array(32),
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(16),
      }),
    )
    const ocf2 = encodeFrameToPayload({
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16),
      artifactType: "pq-message",
      frameIndex: 0,
      frameCount: 1,
      totalByteLength: 1,
      payloadSha256: new Uint8Array(32),
      chunk: Uint8Array.of(1),
    })

    const rawCountBefore = await (await getDb()).count(STORE_QR_ARTIFACTS)
    for (const [index, payload] of [ocm1, ocm2, ocf2].entries()) {
      const disguised = {
        ...retainedKeyQr,
        id: generateArtifactId(),
        name: `偽装-${index}`,
        kind: "public-key",
        sensitivity: "public",
        algorithm: index === 0 ? "A256GCM" : "ML-KEM-768",
        payload,
        payloadSha256: await payloadSha256Hex(payload),
        byteLength: utf8ByteLength(payload),
        keyId: recipientKemKeyId,
      } as StoredQrArtifact
      await expect(saveQrArtifact(disguised)).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      })
      expect(await (await getDb()).count(STORE_QR_ARTIFACTS)).toBe(rawCountBefore)
    }

    const standardBase64 = btoa(String.fromCharCode(...plaintext))
    const needles = [
      secret,
      standardBase64,
      toBase64Url(plaintext),
      bytesToHex(plaintext),
    ]
    const seen = new WeakSet<object>()
    const inspect = (value: unknown): void => {
      if (typeof value === "string") {
        for (const needle of needles) expect(value).not.toContain(needle)
        return
      }
      if (value instanceof Uint8Array) {
        const representations = [
          toBase64Url(value),
          bytesToHex(value),
          btoa(String.fromCharCode(...value)),
        ]
        for (const representation of representations) {
          for (const needle of needles) expect(representation).not.toContain(needle)
        }
        return
      }
      if (typeof value !== "object" || value === null || seen.has(value)) return
      seen.add(value)
      for (const nested of Object.values(value)) inspect(nested)
    }
    const database = await getDb()
    for (const store of [
      STORE_KEYS,
      STORE_QR_ARTIFACTS,
      STORE_PREFERENCES,
      STORE_APP_METADATA,
      STORE_PQ_IDENTITIES,
      STORE_PQ_PUBLIC_BUNDLES,
    ] as const) {
      for (const record of await database.getAll(store)) inspect(record)
    }
    expect(
      (await database.getAll(STORE_QR_ARTIFACTS)).filter(
        (record) => (record as { kind: string }).kind === "ciphertext",
      ),
    ).toEqual([])
  })
})
