import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import {
  createSymmetricKey,
  expectNoQrArtifactStore,
  expectOnlineGate,
  loadOnlineGate,
  mainNavigation,
  rawStoreCount,
  switchToOfflineApp,
} from "./helpers"

interface SentinelControl {
  reachable: boolean
  hits: number
}

async function routeSentinelThroughNetwork(
  context: BrowserContext,
  control: SentinelControl,
): Promise<void> {
  await context.route(/\/reachability-sentinel\.txt(?:\?.*)?$/, async (route) => {
    control.hits += 1
    if (!control.reachable) {
      await route.abort("failed")
      return
    }
    await route.continue()
  })
}

/**
 * The two-tab race needs independent sentinel reachability for clients in one
 * browser context. Its page-level shim provides that per-tab control; the
 * single-tab tests instead observe the worker's real NetworkOnly network hop.
 */
async function controlPageSentinel(page: Page, control: SentinelControl): Promise<void> {
  await page.exposeFunction("__e2eSentinelProbe", () => {
    control.hits += 1
    return control.reachable
  })
  await page.addInitScript(() => {
    const probe = (window as Window & {
      __e2eSentinelProbe?: () => Promise<boolean>
    }).__e2eSentinelProbe
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (
        probe !== undefined &&
        new URL(href, location.href).pathname === "/reachability-sentinel.txt"
      ) {
        if (!(await probe())) throw new TypeError("Failed to fetch")
        return new Response("QR-CRYPT-REACHABLE", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        })
      }
      return nativeFetch(input, init)
    }
  })
}

async function installDatabaseDeleteProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = "__qr_crypt_e2e_delete_database_calls"
    const nativeDelete = IDBFactory.prototype.deleteDatabase
    IDBFactory.prototype.deleteDatabase = function deleteDatabase(name: string) {
      const calls = JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[]
      sessionStorage.setItem(key, JSON.stringify([...calls, name]))
      return nativeDelete.call(this, name)
    }
  })
}

async function databaseDeleteCalls(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      JSON.parse(
        sessionStorage.getItem("__qr_crypt_e2e_delete_database_calls") ?? "[]",
      ) as string[],
  )
}

test("the install path stays on installation without resetting when the sentinel succeeds but no data exists", async ({
  context,
  page,
}) => {
  const sentinel: SentinelControl = { reachable: true, hits: 0 }
  await installDatabaseDeleteProbe(page)
  await routeSentinelThroughNetwork(context, sentinel)
  await loadOnlineGate(page, "/encrypt")
  await expect.poll(() => sentinel.hits).toBeGreaterThan(0)
  await expectOnlineGate(page)
  await expect(
    page.getByRole("heading", {
      name: "Local data was reset after an online connection was detected",
    }),
  ).toHaveCount(0)
  expect(await databaseDeleteCalls(page)).toEqual([])
})

test("returning online to a reachable sentinel after key creation resets data and permits only a post-acknowledgement reload", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const sentinel: SentinelControl = { reachable: true, hits: 0 }
  await installDatabaseDeleteProbe(page)
  await routeSentinelThroughNetwork(context, sentinel)
  await loadOnlineGate(page, "/keys")

  sentinel.reachable = false
  await switchToOfflineApp(page, context)
  await createSymmetricKey(page, "wipe対象の機微鍵")
  expect(await rawStoreCount(page, "keys")).toBe(1)

  sentinel.reachable = true
  await context.setOffline(false)
  const wipedHeading = page.getByRole("heading", {
    name: "Local data was reset after an online connection was detected",
  })
  await expect(wipedHeading).toBeVisible({ timeout: 45_000 })
  expect(await databaseDeleteCalls(page)).toContain("qr-crypt")
  await expect(mainNavigation(page)).toBeHidden()

  sentinel.reachable = false
  await context.setOffline(true)
  const shell = page.getByRole("main", {
    name: "Confirm before continuing",
  })
  await expect(shell).toBeVisible()
  await expect(
    shell.getByText("Local data was reset after an online connection was detected"),
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("oc-offline-ack-pending")))
    .toBe("1")

  // A manual reload without acknowledgement must not bypass the shell.
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(shell).toBeVisible()
  await expect(mainNavigation(page)).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("oc-offline-ack-pending")))
    .toBe("1")

  const continueButton = shell.getByRole("button", {
    name: "Accept the risk and show offline features",
  })
  await expect(continueButton).toBeDisabled()
  await shell
    .getByRole("checkbox", {
      name: "I understand the statements above, accept the risk, and want to continue on this device",
    })
    .check()
  await continueButton.click()

  await expect(mainNavigation(page)).toBeVisible()
  await expect(shell).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("oc-offline-ack-pending")))
    .toBeNull()
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(mainNavigation(page)).toBeVisible()
  expect(await rawStoreCount(page, "keys")).toBe(0)
  expect(await rawStoreCount(page, "pqIdentities")).toBe(0)
  await expectNoQrArtifactStore(page)
})

test("preserves pending when a two-tab reset broadcast races a peer online-marker write", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const peer = await context.newPage()
  const senderSentinel: SentinelControl = { reachable: true, hits: 0 }
  const peerSentinel: SentinelControl = { reachable: false, hits: 0 }
  try {
    await peer.addInitScript(() => {
      const nativeSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (key === "oc-offline-ack-pending") {
          const count = Number(sessionStorage.getItem("__peer_marker_writes") ?? "0")
          sessionStorage.setItem("__peer_marker_writes", String(count + 1))
        }
        nativeSetItem.call(this, key, value)
      }
    })
    await Promise.all([
      controlPageSentinel(page, senderSentinel),
      controlPageSentinel(peer, peerSentinel),
    ])
    await Promise.all([loadOnlineGate(page, "/keys"), loadOnlineGate(peer)])

    senderSentinel.reachable = false
    await switchToOfflineApp(page, context)
    await expect(
      peer.getByRole("heading", {
        name: "Confirm before continuing",
      }),
    ).toBeVisible()
    await createSymmetricKey(page, "broadcast競合確認鍵")

    await peer.evaluate(() => {
      sessionStorage.setItem("__peer_marker_writes", "0")
      const channel = new BroadcastChannel("qr-crypt-wipe")
      channel.addEventListener("message", () => {
        const count = Number(sessionStorage.getItem("__peer_wipe_messages") ?? "0")
        sessionStorage.setItem("__peer_wipe_messages", String(count + 1))
      })
      ;(window as Window & { __peerWipeProbe?: BroadcastChannel }).__peerWipeProbe =
        channel
    })

    senderSentinel.reachable = true
    await context.setOffline(false)
    await expect(
      page.getByRole("heading", {
        name: "Local data was reset after an online connection was detected",
      }),
    ).toBeVisible({ timeout: 45_000 })

    await expect
      .poll(() =>
        peer.evaluate(() =>
          Number(sessionStorage.getItem("__peer_wipe_messages") ?? "0"),
        ),
      )
      .toBe(1)
    expect(
      await peer.evaluate(() =>
        Number(sessionStorage.getItem("__peer_marker_writes") ?? "0"),
      ),
    ).toBe(1)
    expect(
      await peer.evaluate(() => localStorage.getItem("oc-offline-ack-pending")),
    ).toBe("1")
  } finally {
    await peer.close()
  }
})
