import { expect, test, type Page } from "@playwright/test"
import {
  createSymmetricKey,
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

async function controlSentinel(page: Page, control: SentinelControl): Promise<void> {
  await page.route("**/reachability-sentinel.txt*", async (route) => {
    control.hits += 1
    if (!control.reachable) {
      await route.abort("internetdisconnected")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: { "cache-control": "no-store" },
      body: "QRYPT-REACHABLE",
    })
  })
}

async function installDatabaseDeleteProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = "__qrypt_e2e_delete_database_calls"
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
        sessionStorage.getItem("__qrypt_e2e_delete_database_calls") ?? "[]",
      ) as string[],
  )
}

test("install 経路は sentinel 成功でもデータが無ければ wipe せず導入画面に留まる", async ({
  page,
}) => {
  const sentinel: SentinelControl = { reachable: true, hits: 0 }
  await installDatabaseDeleteProbe(page)
  await controlSentinel(page, sentinel)
  await loadOnlineGate(page, "/encrypt")
  await expect.poll(() => sentinel.hits).toBeGreaterThan(0)
  await expectOnlineGate(page)
  await expect(
    page.getByRole("heading", {
      name: "オンラインを検出したため、ローカルデータを初期化しました",
    }),
  ).toHaveCount(0)
  expect(await databaseDeleteCalls(page)).toEqual([])
})

test("鍵作成後に sentinel 到達可能な online へ戻ると wipe し、承認後の reload だけを許す", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const sentinel: SentinelControl = { reachable: true, hits: 0 }
  await installDatabaseDeleteProbe(page)
  await controlSentinel(page, sentinel)
  await loadOnlineGate(page, "/keys")

  sentinel.reachable = false
  await switchToOfflineApp(page, context)
  await createSymmetricKey(page, "wipe対象の機微鍵")
  expect(await rawStoreCount(page, "keys")).toBe(1)

  sentinel.reachable = true
  await context.setOffline(false)
  const wipedHeading = page.getByRole("heading", {
    name: "オンラインを検出したため、ローカルデータを初期化しました",
  })
  await expect(wipedHeading).toBeVisible({ timeout: 45_000 })
  expect(await databaseDeleteCalls(page)).toContain("qrypt")
  await expect(mainNavigation(page)).toBeHidden()

  sentinel.reachable = false
  await context.setOffline(true)
  const shell = page.getByRole("main", {
    name: "オフラインへ切り替わりました — 続行前の確認",
  })
  await expect(shell).toBeVisible()
  await expect(
    shell.getByText("オンラインを検出したため、ローカルデータを初期化しました"),
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
    name: "リスクを理解してオフライン機能を表示",
  })
  await expect(continueButton).toBeDisabled()
  await shell
    .getByRole("checkbox", {
      name: "上記を理解した上で、リスクを受け入れてこの端末で続行します",
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
  expect(await rawStoreCount(page, "qrArtifacts")).toBe(0)
})

test("2タブ wipe broadcast と peer の online marker 書込が競合しても pending を保持する", async ({
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
      controlSentinel(page, senderSentinel),
      controlSentinel(peer, peerSentinel),
    ])
    await Promise.all([loadOnlineGate(page, "/keys"), loadOnlineGate(peer)])

    senderSentinel.reachable = false
    await switchToOfflineApp(page, context)
    await expect(
      peer.getByRole("heading", {
        name: "オフラインへ切り替わりました — 続行前の確認",
      }),
    ).toBeVisible()
    await createSymmetricKey(page, "broadcast競合確認鍵")

    await peer.evaluate(() => {
      sessionStorage.setItem("__peer_marker_writes", "0")
      const channel = new BroadcastChannel("qrypt-wipe")
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
        name: "オンラインを検出したため、ローカルデータを初期化しました",
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
