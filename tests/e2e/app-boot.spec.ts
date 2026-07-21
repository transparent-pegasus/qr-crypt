import { expect, test } from "@playwright/test"
import { loadOnlineGate, mainNavigation, switchToOfflineApp } from "./helpers"

test("オンライン導入画面、PWA 資産、オフライン起動とナビゲーション", async ({
  context,
  page,
}) => {
  await loadOnlineGate(page, "/")
  const manifest = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest")
    const body = (await response.json()) as {
      name?: unknown
      display?: unknown
      icons?: unknown[]
    }
    return { status: response.status, body }
  })
  expect(manifest.status).toBe(200)
  const headerTitle = (await page.locator("header h1").innerText()).trim()
  expect(headerTitle.length).toBeGreaterThan(0)
  expect(manifest.body.name).toBe(headerTitle)
  expect(manifest.body.display).toBe("standalone")
  expect(manifest.body.icons).toHaveLength(3)

  const iconStatus = await page.evaluate(async () =>
    (await fetch("/icons/icon-192.png")).status,
  )
  expect(iconStatus).toBe(200)

  await switchToOfflineApp(page, context)
  await expect(page).toHaveURL(/\/encrypt$/)
  const navigation = mainNavigation(page)
  await expect(navigation.getByRole("link")).toHaveCount(4)
  for (const label of ["暗号化", "鍵", "保存済み", "設定"]) {
    await expect(
      navigation.getByRole("link", { name: new RegExp(`^${label}`) }),
    ).toBeVisible()
  }
})
