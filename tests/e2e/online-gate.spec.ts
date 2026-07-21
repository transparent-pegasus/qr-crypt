import { expect, test } from "@playwright/test"
import {
  expectOnlineGate,
  loadOnlineGate,
  mainNavigation,
  switchToOfflineApp,
} from "./helpers"

test("オンライン遷移で機能と一時平文を隠しオフライン復帰時に消去済みにする", async ({
  context,
  page,
}) => {
  await loadOnlineGate(page)
  await expect(page.getByLabel("平文")).toBeHidden()
  await switchToOfflineApp(page, context)

  const plaintext = page.getByLabel("平文", { exact: true })
  await plaintext.fill("オンライン遷移で即時消去する一時平文")
  await context.setOffline(false)
  await expectOnlineGate(page)
  await expect(plaintext).toBeHidden()

  await context.setOffline(true)
  await expect(mainNavigation(page)).toBeVisible()
  await expect(page.getByLabel("平文", { exact: true })).toHaveValue("")
})
