import { afterEach, describe, expect, it } from "vitest"
import { decryptWithAesKey, encryptWithAesKey } from "@/crypto/aes-gcm"
import {
  buildPublicKeyEnvelope,
  buildSymmetricKeyEnvelope,
  createRsaKeyPairRecord,
  createSymmetricKeyRecord,
} from "@/crypto/key-generation"
import { generateArtifactId, generateKeyId } from "@/crypto/random"
import { encodeMlKemEnvelopeV2 } from "@/crypto/pq/canonical-cbor"
import { toBase64Url } from "@/lib/base64url"
import { bytesToHex, utf8ByteLength, utf8ToBytes } from "@/lib/bytes"
import { encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import { buildV2Payload, encodeFrameToPayload } from "@/qr/payload-v2"
import type { StoredKeyRecord, StoredQrArtifact } from "@/schemas/domain"
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
  const kind =
    envelope.type === "message"
      ? "ciphertext"
      : envelope.type === "symmetric-key"
        ? "symmetric-key"
        : "public-key"
  const sensitivity =
    kind === "ciphertext" ? "confidential" : kind === "public-key" ? "public" : "secret"
  const keyId =
    envelope.type === "message"
      ? envelope.algorithm === "A256GCM"
        ? envelope.keyId
        : envelope.recipientKeyId
      : envelope.keyId
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
    const second = await createRsaKeyPairRecord("鍵B", NOW + 1)
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

  it("retains an RSA pair record whose non-extractable private key was lost", async () => {
    const pair = await createRsaKeyPairRecord("秘密鍵消失", NOW)
    const publicOnlyPair: StoredKeyRecord = {
      id: pair.id,
      name: pair.name,
      kind: "rsa-key-pair",
      algorithm: pair.algorithm,
      fingerprint: pair.fingerprint,
      createdAt: pair.createdAt,
      useCount: pair.useCount,
      publicKey: pair.publicKey!,
    }
    await saveKeyRecord(publicOnlyPair)
    const restored = await getKeyRecord(pair.id)
    expect(restored?.kind).toBe("rsa-key-pair")
    expect(restored?.privateKey).toBeUndefined()
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
})

describe("preferences and plaintext non-persistence", () => {
  it("uses env defaults and validates persisted updates", async () => {
    expect(await getPreferences()).toMatchObject({
      defaultAlgorithm: "A256GCM",
      qrErrorCorrection: "Q",
      autoClearPlaintextAfterEncrypt: true,
      backgroundClearEnabled: true,
    })
    expect(
      await updatePreferences({
        defaultAlgorithm: "RSA-HYBRID",
        qrErrorCorrection: "M",
        autoClearPlaintextAfterEncrypt: false,
        backgroundClearEnabled: false,
      }),
    ).toMatchObject({
      defaultAlgorithm: "RSA-HYBRID",
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
      defaultAlgorithm: "A256GCM",
      qrErrorCorrection: "H",
      autoClearPlaintextAfterEncrypt: true,
      backgroundClearEnabled: true,
    })
    expect(migrated).not.toHaveProperty("backgroundClearSeconds")
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
        (record) => record.kind === "ciphertext",
      ),
    ).toEqual([])
  })

  it("builds OCP1 public-key artifacts for the documented text export path", async () => {
    const pair = await createRsaKeyPairRecord("公開鍵", NOW)
    const envelope = await buildPublicKeyEnvelope(pair)
    const artifact = await qrArtifact("公開鍵", envelope)
    expect(artifact.payload).toMatch(/^OCP1:/u)
    expect(artifact.sensitivity).toBe("public")
  })
})
