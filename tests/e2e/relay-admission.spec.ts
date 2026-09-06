import { expect, test, type Page } from "@playwright/test"
import { loadOnlineGate } from "./helpers"

type SensitiveStore = "keys" | "pqIdentities" | "appMetadata"
type HandoffWindow = Window & {
  relayHandoff: { requested: boolean; completed: boolean; resume: () => void }
}

async function openProbePage(page: Page): Promise<Page> {
  // Inherit A's origin without a navigation the service worker could turn into
  // another app client, whose boot-time storage check would contend with us.
  const popup = page.waitForEvent("popup")
  await page.evaluate(() => {
    window.open("about:blank")
  })
  const second = await popup
  expect(await second.opener()).toBe(page)
  expect(
    await second.evaluate(async () => ({
      origin: window.origin,
      readyState: document.readyState,
      body: document.body.innerHTML,
      scripts: document.scripts.length,
      nativeLocks: navigator.locks instanceof LockManager,
      databases: (await indexedDB.databases()).map(({ name }) => name),
    })),
  ).toEqual({
    origin: new URL(page.url()).origin,
    readyState: "complete",
    body: "",
    scripts: 0,
    nativeLocks: true,
    databases: expect.arrayContaining(["qr-crypt"]),
  })
  expect(await page.evaluate(() => navigator.locks instanceof LockManager)).toBe(true)
  return second
}

// Delay only the handoff to the native API. All requests still use Chromium's
// real origin-wide Web Locks, and every IDB transaction below is real. This
// instrumentation lives exclusively in the test; the app exposes no test hook.
async function pauseSessionRequest(page: Page): Promise<void> {
  await page.evaluate(() => {
    const request = navigator.locks.request.bind(navigator.locks)
    let resume!: () => void
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    const handoff = { requested: false, completed: false, resume }
    ;(window as unknown as HandoffWindow).relayHandoff = handoff
    navigator.locks.request = new Proxy(request, {
      apply(target, receiver, args: [string, LockOptions, LockGrantedCallback<unknown>]) {
        if (args[0] !== "qr-crypt-sensitive-write" || args[1]?.ifAvailable !== true) {
          return Reflect.apply(target, receiver, args)
        }
        navigator.locks.request = request
        handoff.requested = true
        return gate
          .then(() => Reflect.apply(target, receiver, args) as Promise<unknown>)
          .finally(() => {
            handoff.completed = true
          })
      },
    })
  })
}

async function cooperatingWrite(page: Page, store: SensitiveStore): Promise<void> {
  await page.evaluate(async (storeName) => {
    await navigator.locks.request(
      "qr-crypt-sensitive-write",
      { mode: "shared" },
      async () => {
        const key = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          storeName === "keys",
          ["encrypt", "decrypt"],
        )
        const row =
          storeName === "keys"
            ? {
                id: "AAAAAAAAAAAAAAAAAAAAAA",
                name: "Completed writer key",
                kind: "symmetric",
                algorithm: "A256GCM",
                fingerprint: "a".repeat(64),
                createdAt: 1_700_000_000_000,
                useCount: 0,
                status: "active",
                symmetricKey: key,
              }
            : storeName === "pqIdentities"
              ? {
                  id: "IIIIIIIIIIIIIIIIIIIIII",
                  name: "Completed writer identity",
                  profile: "maximum",
                  kem: {
                    algorithm: "ML-KEM-1024",
                    keyId: "KKKKKKKKKKKKKKKKKKKKKK",
                    publicKey: new Uint8Array(1568).fill(1),
                    encryptedSeed: {
                      iv: new Uint8Array(12),
                      ciphertext: new Uint8Array(80),
                    },
                    fingerprint: "b".repeat(64),
                  },
                  signing: {
                    algorithm: "ML-DSA-87",
                    keyId: "SSSSSSSSSSSSSSSSSSSSSS",
                    publicKey: new Uint8Array(2592).fill(2),
                    encryptedSeed: {
                      iv: new Uint8Array(12),
                      ciphertext: new Uint8Array(48),
                    },
                    fingerprint: "c".repeat(64),
                  },
                  identityFingerprint: "d".repeat(64),
                  status: "active",
                  createdAt: 1_700_000_000_000,
                }
              : { key: "vault-key", value: key }
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("qr-crypt")
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const database = open.result
            const transaction = database.transaction(storeName, "readwrite")
            transaction.onabort = () => {
              database.close()
              reject(transaction.error)
            }
            transaction.onerror = () => {
              database.close()
              reject(transaction.error)
            }
            transaction.oncomplete = () => {
              database.close()
              resolve()
            }
            transaction.objectStore(storeName).add(row)
          }
        })
      },
    )
  }, store)
}

async function sharedLock(page: Page): Promise<string> {
  return page.evaluate(() =>
    navigator.locks.request(
      "qr-crypt-sensitive-write",
      { mode: "shared", ifAvailable: true },
      (lock) => (lock === null ? "blocked" : "granted"),
    ),
  )
}

for (const store of ["keys", "pqIdentities", "appMetadata"] as const) {
  test(`refuses stale clean eligibility after page B completes a ${store} write before page A acquires its lease`, async ({
    page,
  }) => {
    await loadOnlineGate(page)
    await page.getByRole("button", { name: "Relay", exact: true }).click()
    const open = page.getByRole("button", { name: "Text → QR" })
    await expect(open).toBeEnabled() // A has recorded the old clean proof.
    const second = await openProbePage(page)
    await pauseSessionRequest(page)
    try {
      await open.click()
      await page.waitForFunction(
        () => (window as unknown as HandoffWindow).relayHandoff.requested,
      )
      await expect(page.getByRole("dialog")).toHaveCount(0)

      // The awaited transaction completion AND release of B's shared lock are
      // the handoff. An active-writer-only test cannot catch the old race.
      await cooperatingWrite(second, store)
      expect(await sharedLock(second)).toBe("granted")
      await page.evaluate(() =>
        (window as unknown as HandoffWindow).relayHandoff.resume(),
      )

      await expect
        .poll(
          async () => {
            if (await page.getByRole("dialog").isVisible()) return "opened"
            if (
              !(await open.isVisible()) ||
              (await page
                .getByText(/another tab.*relay|relay.*another tab|busy/i)
                .isVisible())
            )
              return "refused"
            if (
              await page.evaluate(
                () => (window as unknown as HandoffWindow).relayHandoff.completed,
              )
            )
              return "refused"
            return "pending"
          },
          { timeout: 5_000 },
        )
        .toBe("refused")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect.poll(() => sharedLock(second)).toBe("granted")
    } finally {
      await page.evaluate(() =>
        (window as unknown as HandoffWindow).relayHandoff.resume(),
      )
      await second.close()
    }
  })
}

test("pagehide cancels a delayed native admission without reopening or retaining the lock", async ({
  page,
}) => {
  await loadOnlineGate(page)
  await page.getByRole("button", { name: "Relay", exact: true }).click()
  const second = await openProbePage(page)
  await pauseSessionRequest(page)
  try {
    await page.getByRole("button", { name: "Text → QR" }).click()
    await page.waitForFunction(
      () => (window as unknown as HandoffWindow).relayHandoff.requested,
    )
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")))
    expect(await sharedLock(second)).toBe("granted")
    await page.evaluate(() => (window as unknown as HandoffWindow).relayHandoff.resume())
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as HandoffWindow).relayHandoff.completed,
          ),
        { timeout: 5_000 },
      )
      .toBe(true)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect.poll(() => sharedLock(second)).toBe("granted")
  } finally {
    await page.evaluate(() => (window as unknown as HandoffWindow).relayHandoff.resume())
    await second.close()
  }
})

test("a held relay lease blocks a real IDB writer until the dialog closes", async ({
  page,
}) => {
  await loadOnlineGate(page)
  await page.getByRole("button", { name: "Relay", exact: true }).click()
  await page.getByRole("button", { name: "Text → QR" }).click()
  const dialog = page.getByRole("dialog", { name: "Turn relay text into QR" })
  await expect(dialog).toBeVisible()
  const second = await openProbePage(page)
  let completed = false
  const write = cooperatingWrite(second, "keys").then(() => {
    completed = true
  })
  try {
    await expect
      .poll(() =>
        second.evaluate(async () =>
          (await navigator.locks.query()).pending?.some(
            (lock) => lock.name === "qr-crypt-sensitive-write" && lock.mode === "shared",
          ),
        ),
      )
      .toBe(true)
    expect(completed).toBe(false)
    await dialog.getByRole("button", { name: "Close" }).click()
    await write
    expect(completed).toBe(true)
  } finally {
    await second.close()
  }
})
