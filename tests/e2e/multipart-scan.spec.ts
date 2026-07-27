import { expect as baseExpect, test } from "@playwright/test"
import {
  collectAnimatedFramePayloads,
  createPqIdentity,
  emitInjectedQr,
  goToOfflinePage,
  injectedScanSnapshot,
  installInjectedDecoderStream,
  loadOnlineGate,
  primeInjectedDecoderPrecache,
  switchToOfflineAppInSession,
} from "./helpers"

const expect = baseExpect.configure({ timeout: 30_000 })

test("routes an injected decoder stream through the UI handler and imports a shuffled duplicate-containing public-key bundle after rejecting a mixed transfer", async ({
  context,
  page,
}) => {
  test.setTimeout(150_000)
  await installInjectedDecoderStream(page)
  await loadOnlineGate(page, "/keys")
  await primeInjectedDecoderPrecache(page)
  await switchToOfflineAppInSession(page, context)

  const identityName = "継続スキャンPQ-ID"
  await createPqIdentity(page, identityName)
  await goToOfflinePage(page, "/keys")
  await page.getByRole("button", { name: new RegExp(identityName) }).click()
  let identityDialog = page.getByRole("dialog", { name: identityName })
  await identityDialog
    .getByRole("button", { name: "Public-key bundle QR", exact: true })
    .click()
  let frameDialog = page.getByRole("dialog", {
    name: `${identityName} public-key bundle`,
  })
  let frameRegion = frameDialog.getByRole("region", {
    name: `${identityName} public-key bundle frame display`,
  })
  const frames = await collectAnimatedFramePayloads(frameRegion)
  expect(frames.length).toBeGreaterThan(1)

  await frameDialog
    .getByRole("button", { name: "Back to details", exact: true })
    .click()
  identityDialog = page.getByRole("dialog", { name: identityName })
  await identityDialog
    .getByRole("button", { name: "Public-key bundle QR", exact: true })
    .click()
  frameDialog = page.getByRole("dialog", {
    name: `${identityName} public-key bundle`,
  })
  frameRegion = frameDialog.getByRole("region", {
    name: `${identityName} public-key bundle frame display`,
  })
  const otherFrames = await collectAnimatedFramePayloads(frameRegion)
  expect(otherFrames[0]).not.toBe(frames[0])
  await frameDialog.getByRole("button", { name: "Close", exact: true }).click()

  await goToOfflinePage(page, "/keys")
  await page.getByRole("tab", { name: "Other parties' keys", exact: true }).click()
  await page.getByRole("button", { name: "Import a key", exact: true }).click()
  const scanTrigger = page.getByRole("button", {
    name: "Scan a key QR code",
    exact: true,
  })
  await expect(scanTrigger).toBeEnabled()
  await scanTrigger.click()
  const scanDialog = page.getByRole("dialog", { name: "Scan a key QR code" })
  await expect(scanDialog).toBeVisible()
  await expect(page.getByText("QR codes can be read in any order")).toBeVisible()
  await expect(
    scanDialog.getByRole("button", { name: "Stop camera", exact: true }),
  ).toHaveCount(0)
  await expect(
    scanDialog.getByRole("button", { name: "Discard scan state", exact: true }),
  ).toBeVisible()

  // The first multipart frame locks this run; an otherwise valid single QR is rejected.
  await emitInjectedQr(page, frames[0]!)
  await expect(page.getByText(`Received 1 / ${frames.length}`, { exact: true })).toBeVisible()
  await emitInjectedQr(page, "OCM1:competing-single")
  await expect(
    page.getByText(
      "A multi-frame QR scan is in progress. Scan a single QR code after completion or after discarding the scan state.",
    ),
  ).toBeVisible()
  let snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)).toMatchObject({ active: true, once: false, emissions: 2 })

  // A frame from another transfer must poison this session with FRAME_MISMATCH.
  await emitInjectedQr(page, otherFrames[0]!)
  await expect(
    page.getByText(
      "QR codes from different transfers are mixed together. Discard the scan state and start again.",
    ),
  ).toBeVisible()

  await page.getByRole("button", { name: "Discard scan state" }).click()
  await expect(page.getByRole("button", { name: "Start camera" })).toBeVisible()
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)?.active).toBe(false)
  await page.getByRole("button", { name: "Start camera" }).click()
  await expect(page.getByText("QR codes can be read in any order")).toBeVisible()

  // Restart with the last frame, repeat it, then finish in reverse order.
  const lastIndex = frames.length - 1
  await emitInjectedQr(page, frames[lastIndex]!)
  await expect(page.getByText(`Received 1 / ${frames.length}`, { exact: true })).toBeVisible()
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)).toMatchObject({ active: true, once: false, emissions: 1 })

  await emitInjectedQr(page, frames[lastIndex]!)
  await expect(page.getByText(`Received 1 / ${frames.length}`, { exact: true })).toBeVisible()
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)).toMatchObject({ active: true, once: false, emissions: 2 })

  let received = 1
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    await emitInjectedQr(page, frames[index]!)
    received += 1
    if (received < frames.length) {
      await expect(
        page.getByText(`Received ${received} / ${frames.length}`, { exact: true }),
      ).toBeVisible()
    }
  }

  await expect(scanDialog).not.toBeVisible({ timeout: 30_000 })
  // The add modal switches straight to the fingerprint step, so the scanner's own
  // closed notice is replaced by the confirmation it was announcing.
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)?.active).toBe(false)

  const fingerprintDialog = page.getByRole("dialog", {
    name: "Compare the fingerprint through another channel",
  })
  await expect(fingerprintDialog).toBeVisible()
  await fingerprintDialog
    .getByRole("button", { name: "Save without verification", exact: true })
    .click()
  await expect(fingerprintDialog).not.toBeVisible()
  await expect(page.getByText("Saved without verification")).toBeVisible()
})
