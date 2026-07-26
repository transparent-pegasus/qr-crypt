import { afterEach, describe, expect, it } from "vitest"
import { readBootDecision } from "@/app/boot/boot-controller"
import { decryptWithAesKey, encryptWithAesKey } from "@/crypto/aes-gcm"
import { createSymmetricKeyRecord } from "@/crypto/key-generation"
import { generateKeyId } from "@/crypto/random"
import { toBase64Url } from "@/lib/base64url"
import { bytesToHex, utf8ToBytes } from "@/lib/bytes"
import type {
  PqProfileId,
  StoredKeyRecord,
  UiAlgorithm,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
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

const NOW = 1_700_000_000_000

afterEach(async () => {
  await deleteEntireDatabase()
})

const CURRENT_STORES = [
  STORE_APP_METADATA,
  STORE_KEYS,
  STORE_PQ_IDENTITIES,
  STORE_PQ_PUBLIC_BUNDLES,
  STORE_PREFERENCES,
].sort()

describe("database creation", () => {
  it("fresh-creates only the current stores and reopens without rebuilding", async () => {
    const database = await getDb()
    expect(database.version).toBe(DB_VERSION)
    expect(Array.from(database.objectStoreNames).sort()).toEqual(CURRENT_STORES)
    expect(Array.from(database.objectStoreNames)).not.toContain("qrArtifacts")
    const keyTx = database.transaction(STORE_KEYS)
    expect(Array.from(keyTx.store.indexNames).sort()).toEqual([
      "by-createdAt",
      "by-fingerprint",
    ])
    const identities = database.transaction(STORE_PQ_IDENTITIES).store
    expect(Array.from(identities.indexNames).sort()).toEqual([
      "by-createdAt",
      "by-kemKeyId",
      "by-signingKeyId",
    ])
    expect(identities.index("by-kemKeyId").unique).toBe(true)
    expect(identities.index("by-signingKeyId").unique).toBe(true)
    const bundles = database.transaction(STORE_PQ_PUBLIC_BUNDLES).store
    expect(Array.from(bundles.indexNames)).toEqual(["by-identityId"])
    expect(bundles.index("by-identityId").unique).toBe(false)

    const record = await createSymmetricKeyRecord("再オープン", NOW)
    await saveKeyRecord(record)
    closeDb()
    expect((await getDb()).version).toBe(DB_VERSION)
    expect((await getKeyRecord(record.id))?.fingerprint).toBe(record.fingerprint)
  })

  it("upgrades a pre-existing v2 DB by wiping stores and creating the current schema", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("qr-crypt", 2)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("legacyDummyStore")) {
          db.createObjectStore("legacyDummyStore", { keyPath: "id" })
        }
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error ?? new Error("open v2 failed"))
      request.onblocked = () => reject(new Error("open v2 blocked"))
    })

    const database = await getDb()
    expect(database.version).toBe(DB_VERSION)
    expect(Array.from(database.objectStoreNames).sort()).toEqual(CURRENT_STORES)
    expect(Array.from(database.objectStoreNames)).not.toContain("legacyDummyStore")
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

describe("preferences and plaintext non-persistence", () => {
  it("uses env defaults and validates persisted updates", async () => {
    expect(await getPreferences()).toMatchObject({
      defaultAlgorithm: env.defaultAlgorithm,
      qrErrorCorrection: "Q",
      autoClearPlaintextAfterEncrypt: true,
      backgroundClearEnabled: true,
      frameBytes: 100,
      frameIntervalMs: 1_000,
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

  it.each([
    [100, 100, true],
    [250, 300, false],
    [900, 900, true],
  ] as const)(
    "loads stored frameBytes=%i as %i with retired interval 3000 without endangering sensitive data",
    async (frameBytes, normalizedFrameBytes, activeWriteAllowed) => {
      const database = await getDb()
      await database.put(STORE_KEYS, { id: "confirmed-sensitive-row" } as never)
      await database.put(STORE_PREFERENCES, {
        key: "preferences",
        value: {
          frameBytes,
          frameIntervalMs: 3_000,
          wipeOnOnline: false,
        },
      })

      await expect(readBootDecision()).resolves.toMatchObject({
        preferencesReadFailed: false,
        sensitiveDataExists: true,
        wipeOnOnline: false,
      })
      await expect(getPreferences()).resolves.toMatchObject({
        frameBytes: normalizedFrameBytes,
        frameIntervalMs: 2_000,
        wipeOnOnline: false,
      })
      await expect(
        updatePreferences({ qrErrorCorrection: "M" }),
      ).resolves.toMatchObject({
        frameBytes: normalizedFrameBytes,
        frameIntervalMs: 2_000,
        qrErrorCorrection: "M",
        wipeOnOnline: false,
      })

      const activeWrite = expect(updatePreferences({ frameBytes }))
      if (activeWriteAllowed) {
        await activeWrite.resolves.toMatchObject({ frameBytes })
      } else {
        await activeWrite.rejects.toMatchObject({ code: "STORAGE_FAILED" })
      }
    },
  )

  it.each([99, 1_001] as const)(
    "fails closed for stored frameBytes=%i outside the boot-readable range",
    async (frameBytes) => {
      const database = await getDb()
      await database.put(STORE_KEYS, { id: "confirmed-sensitive-row" } as never)
      await database.put(STORE_PREFERENCES, {
        key: "preferences",
        value: { frameBytes, wipeOnOnline: false },
      })

      await expect(getPreferences()).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      })
      await expect(readBootDecision()).resolves.toMatchObject({
        preferencesReadFailed: true,
        sensitiveDataExists: true,
        wipeOnOnline: true,
      })
    },
  )

  it("normalizes boot-readable intervals and preserves the active 2000ms fallback", async () => {
    const database = await getDb()
    for (const [legacyInterval, normalizedInterval, activeWriteAllowed] of [
      [150, 200, false],
      [250, 300, false],
      [1_050, 1_000, false],
      [1_499, 1_000, false],
      [1_500, 2_000, false],
      [2_000, 2_000, true],
      [2_250, 2_000, false],
      [2_500, 2_000, false],
      [3_000, 2_000, false],
    ] as const) {
      await database.put(STORE_PREFERENCES, {
        key: "preferences",
        value: {
          frameIntervalMs: legacyInterval,
          wipeOnOnline: false,
        },
      })

      await expect(readBootDecision()).resolves.toMatchObject({
        preferencesReadFailed: false,
        wipeOnOnline: false,
      })
      await expect(getPreferences()).resolves.toMatchObject({
        frameIntervalMs: normalizedInterval,
        wipeOnOnline: false,
      })
      await expect(
        updatePreferences({ qrErrorCorrection: "M" }),
      ).resolves.toMatchObject({
        frameIntervalMs: normalizedInterval,
        qrErrorCorrection: "M",
        wipeOnOnline: false,
      })
      const activeWrite = expect(
        updatePreferences({ frameIntervalMs: legacyInterval }),
      )
      if (activeWriteAllowed) {
        await activeWrite.resolves.toMatchObject({
          frameIntervalMs: legacyInterval,
        })
      } else {
        await activeWrite.rejects.toMatchObject({ code: "STORAGE_FAILED" })
      }
    }
  })

  it.each([149, 3_001] as const)(
    "fails closed for stored frameIntervalMs=%i outside the boot-readable range",
    async (frameIntervalMs) => {
      const database = await getDb()
      await database.put(STORE_KEYS, { id: "confirmed-sensitive-row" } as never)
      await database.put(STORE_PREFERENCES, {
        key: "preferences",
        value: { frameIntervalMs, wipeOnOnline: false },
      })

      await expect(getPreferences()).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      })
      await expect(readBootDecision()).resolves.toMatchObject({
        preferencesReadFailed: true,
        sensitiveDataExists: true,
        wipeOnOnline: true,
      })
    },
  )

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

  it("never persists plaintext and has no QR artifact store", async () => {
    const secret = "秘密テキストXYZ-検査用"
    const plaintext = utf8ToBytes(secret)
    const aesRecord = await createSymmetricKeyRecord("AES保管", NOW)
    await saveKeyRecord(aesRecord)
    await encryptWithAesKey({
      key: aesRecord.symmetricKey!,
      keyId: aesRecord.id,
      plaintext,
      now: NOW + 2,
    })

    const needles = [
      secret,
      btoa(String.fromCharCode(...plaintext)),
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
    expect(Array.from(database.objectStoreNames)).not.toContain("qrArtifacts")
    for (const store of [
      STORE_KEYS,
      STORE_PREFERENCES,
      STORE_APP_METADATA,
      STORE_PQ_IDENTITIES,
      STORE_PQ_PUBLIC_BUNDLES,
    ] as const) {
      for (const record of await database.getAll(store)) inspect(record)
    }
  })
})
