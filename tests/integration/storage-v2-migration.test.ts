import { afterEach, describe, expect, it } from "vitest"
import { openDB } from "idb"
import type { IDBPDatabase } from "idb"
import { encryptWithAesKey } from "@/crypto/aes-gcm"
import {
  buildSymmetricKeyEnvelope,
  createSymmetricKeyRecord,
} from "@/crypto/key-generation"
import { generateArtifactId } from "@/crypto/random"
import { sha256Hex, utf8ByteLength, utf8ToBytes } from "@/lib/bytes"
import { encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import type { StoredKeyRecord } from "@/schemas/domain"
import type { LegacyStoredQrArtifactV1 } from "@/schemas/key-schema"
import {
  closeDb,
  DB_NAME,
  DB_VERSION,
  getDb,
  type OfflineCipherDb,
  STORE_APP_METADATA,
  STORE_KEYS,
  STORE_PQ_IDENTITIES,
  STORE_PQ_PUBLIC_BUNDLES,
  STORE_PREFERENCES,
  STORE_QR_ARTIFACTS,
} from "@/storage/database"
import { applyMigrations } from "@/storage/migrations"

const NOW = 1_700_100_000_000

interface SeededV1 {
  keyIds: string[]
  keySummaries: Array<Pick<StoredKeyRecord, "id" | "kind" | "fingerprint">>
  retainedQrIds: string[]
  purgedQrIds: string[]
  purgedHashes: string[]
  preferenceRow: { key: string; value: unknown }
  originalQrCount: number
}

function createV1Stores(database: IDBPDatabase<OfflineCipherDb>): void {
  const keys = database.createObjectStore(STORE_KEYS, { keyPath: "id" })
  keys.createIndex("by-fingerprint", "fingerprint", { unique: true })
  keys.createIndex("by-createdAt", "createdAt")
  const qrArtifacts = database.createObjectStore(STORE_QR_ARTIFACTS, {
    keyPath: "id",
  })
  qrArtifacts.createIndex("by-payloadSha256", "payloadSha256")
  qrArtifacts.createIndex("by-createdAt", "createdAt")
  database.createObjectStore(STORE_PREFERENCES, { keyPath: "key" })
  database.createObjectStore(STORE_APP_METADATA, { keyPath: "key" })
}

async function artifact(
  name: string,
  envelope: Parameters<typeof encodeEnvelopeToPayload>[0],
): Promise<LegacyStoredQrArtifactV1> {
  const payload = encodeEnvelopeToPayload(envelope)
  const kind =
    envelope.type === "message"
      ? "ciphertext"
      : envelope.type === "symmetric-key"
        ? "symmetric-key"
        : "public-key"
  const keyId = envelope.keyId
  return {
    id: generateArtifactId(),
    name,
    kind,
    sensitivity:
      kind === "ciphertext"
        ? "confidential"
        : kind === "public-key"
          ? "public"
          : "secret",
    algorithm: envelope.algorithm,
    payload,
    payloadSha256: await payloadSha256Hex(payload),
    byteLength: utf8ByteLength(payload),
    createdAt: NOW,
    keyId,
  }
}

async function legacyRsaKeyRecord(): Promise<StoredKeyRecord> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3072,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: "SHA-256",
    },
    false,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  )) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))
  return {
    id: generateArtifactId(),
    name: "v1 RSA legacy row",
    kind: "rsa-key-pair",
    algorithm: "RSA-OAEP-3072",
    fingerprint: await sha256Hex(spki),
    createdAt: NOW + 1,
    useCount: 0,
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
  }
}

async function seedV1Database(): Promise<SeededV1> {
  const aes = await createSymmetricKeyRecord("v1 AES", NOW)
  const rsa = await legacyRsaKeyRecord()
  const plaintext = utf8ToBytes("migration ciphertext")
  const activeRows = [
    await artifact("AES 鍵QR", await buildSymmetricKeyEnvelope(aes)),
    await artifact(
      "AES 暗号文 1",
      await encryptWithAesKey({
        key: aes.symmetricKey!,
        keyId: aes.id,
        plaintext,
        now: NOW + 2,
      }),
    ),
    await artifact(
      "AES 暗号文 2",
      await encryptWithAesKey({
        key: aes.symmetricKey!,
        keyId: aes.id,
        plaintext,
        now: NOW + 3,
      }),
    ),
  ]
  const legacyPublicPayload = "OCP1:legacy-rsa-public-key"
  const legacyPublicQr: LegacyStoredQrArtifactV1 = {
    id: generateArtifactId(),
    name: "RSA 公開鍵QR legacy row",
    kind: "public-key",
    sensitivity: "public",
    algorithm: "RSA-OAEP-3072",
    payload: legacyPublicPayload,
    payloadSha256: await payloadSha256Hex(legacyPublicPayload),
    byteLength: utf8ByteLength(legacyPublicPayload),
    createdAt: NOW,
    keyId: rsa.id,
  }
  const rows: LegacyStoredQrArtifactV1[] = [...activeRows, legacyPublicQr]
  const unknownId = generateArtifactId()
  const preferenceRow = {
    key: "preferences",
    value: { qrErrorCorrection: "H", migrationSentinel: "preserve-me" },
  }
  const database = await openDB<OfflineCipherDb>(DB_NAME, 1, {
    upgrade(db) {
      createV1Stores(db)
    },
  })
  try {
    for (const key of [aes, rsa] as StoredKeyRecord[]) {
      await database.add(STORE_KEYS, key)
    }
    for (const row of rows) await database.add(STORE_QR_ARTIFACTS, row as never)
    await database.add(STORE_QR_ARTIFACTS, {
      id: unknownId,
      kind: "unclassifiable-v1-row",
    } as never)
    await database.add(STORE_PREFERENCES, preferenceRow)
    await database.add(STORE_APP_METADATA, {
      key: "migration-sentinel",
      value: "preserve-me",
    })
  } finally {
    database.close()
  }
  const ciphertextRows = rows.filter((row) => row.kind === "ciphertext")
  return {
    keyIds: [aes.id, rsa.id].sort(),
    keySummaries: [aes, rsa]
      .map(({ id, kind, fingerprint }) => ({ id, kind, fingerprint }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    retainedQrIds: rows
      .filter((row) => row.kind !== "ciphertext")
      .map((row) => row.id)
      .sort(),
    purgedQrIds: [...ciphertextRows.map((row) => row.id), unknownId].sort(),
    purgedHashes: ciphertextRows.map((row) => row.payloadSha256),
    preferenceRow,
    originalQrCount: rows.length + 1,
  }
}

afterEach(async () => {
  closeDb()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("database deletion blocked"))
  })
})

describe("storage v2 migration", () => {
  it("supports a fresh 0→2 create with the exact v2 stores and indexes", async () => {
    const database = await openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        expect(oldVersion).toBe(0)
        applyMigrations(db, oldVersion, transaction)
      },
    })
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
    database.close()
  })

  it("purges ciphertext and unknown rows in 1→2 while preserving key data exactly, then reopens 2→2", async () => {
    const seeded = await seedV1Database()
    let deletedCount = -1
    const database = await openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        expect(oldVersion).toBe(1)
        applyMigrations(db, oldVersion, transaction, {
          onCiphertextPurgeComplete(count) {
            deletedCount = count
          },
        })
      },
    })

    expect(deletedCount).toBe(3)
    const rawQrRows = await database.getAll(STORE_QR_ARTIFACTS)
    expect(rawQrRows.map((row) => row.id).sort()).toEqual(seeded.retainedQrIds)
    expect(
      rawQrRows.filter((row) => (row as { kind: string }).kind === "ciphertext"),
    ).toEqual([])
    expect(await database.count(STORE_QR_ARTIFACTS)).toBe(seeded.retainedQrIds.length)
    for (const hash of seeded.purgedHashes) {
      expect(
        await database.countFromIndex(STORE_QR_ARTIFACTS, "by-payloadSha256", hash),
      ).toBe(0)
    }
    const migratedKeys = await database.getAll(STORE_KEYS)
    expect(
      migratedKeys
        .map(({ id, kind, fingerprint }) => ({ id, kind, fingerprint }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(seeded.keySummaries)
    expect(
      (
        migratedKeys.find((row) => row.kind === "symmetric")?.symmetricKey?.algorithm as
          KeyAlgorithm | undefined
      )?.name,
    ).toBe("AES-GCM")
    const migratedRsa = migratedKeys.find((row) => row.kind === "rsa-key-pair")
    expect((migratedRsa?.publicKey?.algorithm as KeyAlgorithm | undefined)?.name).toBe(
      "RSA-OAEP",
    )
    expect(migratedRsa?.privateKey?.extractable).toBe(false)
    expect(await database.get(STORE_PREFERENCES, seeded.preferenceRow.key)).toEqual(
      seeded.preferenceRow,
    )
    expect(await database.get(STORE_APP_METADATA, "migration-sentinel")).toEqual({
      key: "migration-sentinel",
      value: "preserve-me",
    })
    for (const purgedId of seeded.purgedQrIds) {
      expect(await database.get(STORE_QR_ARTIFACTS, purgedId)).toBeUndefined()
    }
    database.close()

    let upgradeCalled = false
    const reopened = await openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
      upgrade() {
        upgradeCalled = true
      },
    })
    expect(upgradeCalled).toBe(false)
    expect(reopened.version).toBe(2)
    expect(await reopened.count(STORE_QR_ARTIFACTS)).toBe(seeded.retainedQrIds.length)
    reopened.close()
  })

  it("aborts the whole upgrade on a purge failure and leaves version 1 plus every row intact", async () => {
    const seeded = await seedV1Database()
    let deleteAttempts = 0
    await expect(
      openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, _newVersion, transaction) {
          applyMigrations(db, oldVersion, transaction, {
            beforeCiphertextPurgeDelete() {
              deleteAttempts += 1
              if (deleteAttempts === 2) throw new Error("injected purge failure")
            },
          })
        },
      }),
    ).rejects.toBeDefined()
    expect(deleteAttempts).toBe(2)

    const unchanged = await openDB<OfflineCipherDb>(DB_NAME)
    expect(unchanged.version).toBe(1)
    expect(await unchanged.count(STORE_QR_ARTIFACTS)).toBe(seeded.originalQrCount)
    expect((await unchanged.getAll(STORE_KEYS)).map((row) => row.id).sort()).toEqual(
      seeded.keyIds,
    )
    expect(unchanged.objectStoreNames.contains(STORE_PQ_IDENTITIES)).toBe(false)
    expect(unchanged.objectStoreNames.contains(STORE_PQ_PUBLIC_BUNDLES)).toBe(false)
    unchanged.close()
  })

  it("notifies and times out when a v1 tab blocks the v2 open", async () => {
    await seedV1Database()
    const blocker = await openDB<OfflineCipherDb>(DB_NAME)
    let blockedNotifications = 0
    try {
      await expect(
        getDb({
          timeoutMs: 10,
          onBlocked() {
            blockedNotifications += 1
          },
        }),
      ).rejects.toMatchObject({ code: "RESET_FAILED" })
      expect(blockedNotifications).toBe(1)
    } finally {
      blocker.close()
    }

    // Wait for the timed-out native request to finish and close itself after the
    // blocker releases the versionchange event.
    const settled = await openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        applyMigrations(db, oldVersion, transaction)
      },
    })
    settled.close()
  })
})
