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

test("hides functionality and transient plaintext online and leaves it cleared after returning offline", async ({
  context,
  page,
}) => {
  await loadOnlineGate(page)
  await expect(page.getByLabel("Plaintext")).toBeHidden()
  await switchToOfflineApp(page, context)

  const plaintext = page.getByLabel("Plaintext", { exact: true })
  await plaintext.fill("オンライン遷移で即時消去する一時平文")
  await context.setOffline(false)
  await expectOnlineGate(page)
  await expect(plaintext).toBeHidden()

  await context.setOffline(true)
  await expectOfflineAcknowledgement(page)
  await expect(plaintext).toBeHidden()
  await acknowledgeOfflineRisk(page)
  await expect(mainNavigation(page)).toBeVisible()
  await expect(page.getByLabel("Plaintext", { exact: true })).toHaveValue("")
})

test("does not require acknowledgement on a genuine marker-free cold offline boot", async ({
  context,
  page,
}) => {
  await loadOnlineGate(page)
  await switchToColdOfflineApp(page, context)
  await expect(
    page.getByRole("heading", {
      name: "Confirm before continuing",
    }),
  ).toBeHidden()
  await expect(mainNavigation(page)).toBeVisible()
})

test("one tab's acknowledgement does not unlock the other tab's active shell and applies on the origin's next boot", async ({
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
        name: "Confirm before continuing",
      }),
    ).toBeHidden()
  } finally {
    await peer.close()
  }
})
