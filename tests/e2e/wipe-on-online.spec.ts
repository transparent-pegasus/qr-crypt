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
  const reload = shell.getByRole("button", { name: "再読み込みして続行" })
  await expect(reload).toBeDisabled()
  await shell
    .getByRole("checkbox", {
      name: "上記を理解した上で、リスクを受け入れてこの端末で続行します",
    })
    .check()
  await reload.click()

  await expect(mainNavigation(page)).toBeVisible()
  await expect(shell).toBeHidden()
  expect(await rawStoreCount(page, "keys")).toBe(0)
  expect(await rawStoreCount(page, "pqIdentities")).toBe(0)
  expect(await rawStoreCount(page, "qrArtifacts")).toBe(0)
})
