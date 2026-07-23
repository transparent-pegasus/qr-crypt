import { expect, test } from "@playwright/test"
import {
  acknowledgeOfflineRisk,
  expectOfflineAcknowledgement,
  expectOnlineGate,
  loadOnlineGate,
  mainNavigation,
  switchToColdOfflineApp,
  switchToOfflineApp,
  waitForServiceWorkerControl,
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
  await expectOfflineAcknowledgement(page)
  await expect(plaintext).toBeHidden()
  await acknowledgeOfflineRisk(page)
  await expect(mainNavigation(page)).toBeVisible()
  await expect(page.getByLabel("平文", { exact: true })).toHaveValue("")
})

test("マーカー不在の真のコールドオフライン起動では承認を要求しない", async ({
  context,
  page,
}) => {
  await loadOnlineGate(page)
  await switchToColdOfflineApp(page, context)
  await expect(
    page.getByRole("heading", {
      name: "オフラインへ切り替わりました。続行前の確認",
    }),
  ).toBeHidden()
  await expect(mainNavigation(page)).toBeVisible()
})

test("2タブの片側承認は他方の進行中 shell を解除せず origin の次回起動へ反映する", async ({
  context,
  page,
}) => {
  const peer = await context.newPage()
  try {
    await Promise.all([loadOnlineGate(page), loadOnlineGate(peer)])
    await Promise.all([
      waitForServiceWorkerControl(page),
      waitForServiceWorkerControl(peer),
    ])

    await context.setOffline(true)
    await Promise.all([
      expectOfflineAcknowledgement(page),
      expectOfflineAcknowledgement(peer),
    ])

    await acknowledgeOfflineRisk(page)
    await expect(mainNavigation(page)).toBeVisible()
    await expectOfflineAcknowledgement(peer)
    await expect(peer.getByRole("navigation")).toBeHidden()

    await peer.reload({ waitUntil: "domcontentloaded" })
    await expect(mainNavigation(peer)).toBeVisible()
    await expect(
      peer.getByRole("heading", {
        name: "オフラインへ切り替わりました。続行前の確認",
      }),
    ).toBeHidden()
  } finally {
    await peer.close()
  }
})
