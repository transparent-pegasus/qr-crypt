import { deleteDB, openDB } from "idb"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  armMaintenanceToken,
  consumeMaintenanceToken,
  readBootDecision,
  readMaintenanceToken,
} from "@/app/boot/boot-controller"
import {
  RESET_CHURN_DATABASE_NAME,
  bestEffortLocalReset,
  clearOcLocalStorage,
  runResetChurn,
  type BestEffortResetDependencies,
} from "@/storage/best-effort-reset"
import {
  deleteEntireDatabase,
  engageDatabaseAccessBarrier,
  getDb,
  resetDatabaseAccessBarrierForTesting,
  STORE_APP_METADATA,
  STORE_KEYS,
  STORE_PREFERENCES,
} from "@/storage/database"

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function dependencies(
  overrides: Partial<BestEffortResetDependencies> = {},
): BestEffortResetDependencies {
  return {
    clearLocalStorage: vi.fn(),
    deleteDatabase: vi.fn(async () => undefined),
    deleteVaultEncryptedSecrets: vi.fn(async () => undefined),
    deleteVaultKey: vi.fn(async () => undefined),
    runChurn: vi.fn(async () => ({
      aborted: false,
      quotaExceeded: false,
      writtenBytes: 0,
    })),
    verifyDatabaseAbsent: vi.fn(async () => false),
    ...overrides,
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  resetDatabaseAccessBarrierForTesting()
  await deleteEntireDatabase()
  await deleteDB(RESET_CHURN_DATABASE_NAME)
})

describe("best-effort local reset", () => {
  it("deletes Vault ciphertext rows before the Vault key and database", async () => {
    const order: string[] = []
    const report = await bestEffortLocalReset(
      { reason: "online-detected", resetChurnMb: 0 },
      dependencies({
        deleteVaultEncryptedSecrets: async () => {
          order.push("vault-secrets")
        },
        deleteVaultKey: async () => {
          order.push("vault-key")
        },
        deleteDatabase: async () => {
          order.push("database")
        },
        clearLocalStorage: () => {
          order.push("local-storage")
        },
        verifyDatabaseAbsent: async () => {
          order.push("verify")
          return false
        },
      }),
    )

    expect(report).toEqual({ ok: true, failedSteps: [] })
    expect(order).toEqual([
      "vault-secrets",
      "vault-key",
      "database",
      "local-storage",
      "verify",
    ])
  })

  it("does no churn writes at the default zero setting", async () => {
    const runChurn = vi.fn(async () => ({
      aborted: false,
      quotaExceeded: false,
      writtenBytes: 0,
    }))
    await bestEffortLocalReset(
      { reason: "online-detected", resetChurnMb: 0 },
      dependencies({ runChurn }),
    )
    expect(runChurn).not.toHaveBeenCalled()
  })

  it("clamps churn to 512 MiB and continues after quota exhaustion", async () => {
    const order: string[] = []
    const runChurn = vi.fn(async (megabytes: number) => {
      order.push(`churn-${megabytes}`)
      return { aborted: false, quotaExceeded: true, writtenBytes: 1024 }
    })
    const report = await bestEffortLocalReset(
      { reason: "online-detected", resetChurnMb: 999 },
      dependencies({
        runChurn,
        verifyDatabaseAbsent: async () => {
          order.push("verify")
          return false
        },
      }),
    )

    expect(runChurn).toHaveBeenCalledWith(512, undefined)
    expect(order).toEqual(["churn-512", "verify"])
    expect(report).toEqual({ ok: false, failedSteps: ["churn"] })
  })

  it("writes only the requested churn bytes and removes its temporary DB", async () => {
    const report = await runResetChurn(1)
    expect(report).toEqual({
      aborted: false,
      quotaExceeded: false,
      writtenBytes: 1024 * 1024,
    })
    expect(
      (await indexedDB.databases()).some(
        (database) => database.name === RESET_CHURN_DATABASE_NAME,
      ),
    ).toBe(false)
  })

  it("catches QuotaExceededError and reports incomplete churn", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError")
    })
    await expect(runResetChurn(1)).resolves.toEqual({
      aborted: false,
      quotaExceeded: true,
      writtenBytes: 0,
    })
  })

  it("honors AbortSignal without skipping subsequent logical deletion steps", async () => {
    const controller = new AbortController()
    controller.abort()
    const order: string[] = []
    const report = await bestEffortLocalReset(
      {
        reason: "online-detected",
        resetChurnMb: 1,
        signal: controller.signal,
      },
      dependencies({
        runChurn: async () => ({
          aborted: true,
          quotaExceeded: false,
          writtenBytes: 0,
        }),
        verifyDatabaseAbsent: async () => {
          order.push("verify")
          return false
        },
      }),
    )
    expect(order).toEqual(["verify"])
    expect(report.failedSteps).toEqual(["churn"])
  })

  it("removes only oc-* localStorage keys", () => {
    const storage = new MemoryStorage()
    storage.setItem("oc-theme", "dark")
    storage.setItem("oc-sensitive", "value")
    storage.setItem("unrelated", "keep")
    clearOcLocalStorage(storage)
    expect(Array.from(storage.values.entries())).toEqual([["unrelated", "keep"]])
  })

  it("performs the real logical DB deletion and absence verification", async () => {
    const database = await getDb()
    await database.put(STORE_KEYS, { id: "sensitive-row" } as never)
    await database.put(STORE_APP_METADATA, {
      key: "vault-key",
      value: { algorithm: "AES-GCM" },
    })

    await expect(
      bestEffortLocalReset({ reason: "online-detected", resetChurnMb: 0 }),
    ).resolves.toEqual({ ok: true, failedSteps: [] })
    expect((await indexedDB.databases()).some((entry) => entry.name === "qrypt")).toBe(
      false,
    )
  })
})

describe("boot storage APIs and barrier", () => {
  it("persists and consumes a valid maintenance token exactly once", async () => {
    await armMaintenanceToken(1_700_000_000_000)
    await expect(readMaintenanceToken()).resolves.toEqual({
      armedAt: 1_700_000_000_000,
    })
    await expect(consumeMaintenanceToken()).resolves.toBe(true)
    await expect(consumeMaintenanceToken()).resolves.toBe(false)
    await expect(readMaintenanceToken()).resolves.toBeUndefined()
  })

  it("fails safe on malformed preferences only when sensitive data is confirmed", async () => {
    const database = await getDb()
    await database.put(STORE_KEYS, { id: "confirmed-sensitive-row" } as never)
    await database.put(STORE_PREFERENCES, {
      key: "preferences",
      value: { wipeOnOnline: "broken" },
    })
    await expect(readBootDecision()).resolves.toMatchObject({
      preferencesReadFailed: true,
      sensitiveDataExists: true,
      wipeOnOnline: true,
    })
  })

  it("rejects all new getDb operations once the one-way barrier is engaged", async () => {
    await getDb()
    engageDatabaseAccessBarrier()
    await expect(getDb()).rejects.toMatchObject({ code: "RESET_FAILED" })
  })

  it("turns a blocked delete timeout into RESET_FAILED", async () => {
    await getDb()
    const blocker = await openDB("qrypt")
    let blockedNotifications = 0
    try {
      await expect(
        deleteEntireDatabase({
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
  })
})
