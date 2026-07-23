import { expect as baseExpect, test } from "@playwright/test"
import {
  collectAnimatedFramePayloads,
  createPqIdentity,
  emitInjectedQr,
  encryptSignedPq,
  injectedScanSnapshot,
  installInjectedDecoderStream,
  loadOnlineGate,
  primeInjectedDecoderPrecache,
  seedSelfPublicBundle,
  switchToOfflineAppInSession,
} from "./helpers"

const expect = baseExpect.configure({ timeout: 30_000 })

test("注入 decoder stream を同じ UI handler へ流し、混在拒否後も順不同・重複から完成して復号する", async ({
  context,
  page,
}) => {
  test.setTimeout(150_000)
  await installInjectedDecoderStream(page)
  await loadOnlineGate(page, "/keys")
  await primeInjectedDecoderPrecache(page)
  await switchToOfflineAppInSession(page, context)

  const identityName = "継続スキャンPQ-ID"
  const plaintext = "順不同の複数QRを継続読取して署名検証まで完了する日本語本文"
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  const first = await encryptSignedPq(page, { identityName, plaintext })
  const frameRegion = first.result.getByRole("region", {
    name: "暗号文フレーム表示",
  })
  const frames = await collectAnimatedFramePayloads(frameRegion)
  expect(frames.length).toBeGreaterThan(1)

  const secondPlaintext = "別transferIdを作るための二つ目の署名付き本文"
  await page.getByLabel("平文", { exact: true }).fill(secondPlaintext)
  await page.getByRole("button", { name: "暗号化する", exact: true }).click()
  await expect
    .poll(() => first.result.locator("p").first().innerText(), { timeout: 45_000 })
    .not.toBe(first.payload)
  const otherFrames = await collectAnimatedFramePayloads(frameRegion)
  expect(otherFrames[0]).not.toBe(frames[0])

  await page.getByRole("tab", { name: "復号", exact: true }).click()
  const scanTrigger = page.getByRole("button", {
    name: "暗号文QRを読み取る",
    exact: true,
  })
  await expect(scanTrigger).toBeEnabled()
  await scanTrigger.click()
  const scanDialog = page.getByRole("dialog", { name: "暗号文QRを読み取る" })
  await expect(scanDialog).toBeVisible()
  await expect(page.getByText("QRコードを順不同で読み取れます")).toBeVisible()

  // The first multipart frame locks this run; an otherwise valid single QR is rejected.
  await emitInjectedQr(page, frames[0]!)
  await expect(page.getByText(`受信 1 / ${frames.length}`, { exact: true })).toBeVisible()
  await emitInjectedQr(page, "OCM1:competing-single")
  await expect(
    page.getByText("複数QR読取中です。単発QRは読取完了または破棄後に。"),
  ).toBeVisible()
  let snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)).toMatchObject({ active: true, once: false, emissions: 2 })

  // A frame from another transfer must poison this session with FRAME_MISMATCH.
  await emitInjectedQr(page, otherFrames[0]!)
  await expect(
    page.getByText(
      "異なる転送のQRコードが混在しています。読み取り状態を破棄してやり直してください。",
    ),
  ).toBeVisible()

  await page.getByRole("button", { name: "読取状態を破棄" }).click()
  await expect(page.getByRole("button", { name: "カメラを起動" })).toBeVisible()
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)?.active).toBe(false)
  await page.getByRole("button", { name: "カメラを起動" }).click()
  await expect(page.getByText("QRコードを順不同で読み取れます")).toBeVisible()

  // Restart with the last frame, repeat it, then finish in reverse order.
  const lastIndex = frames.length - 1
  await emitInjectedQr(page, frames[lastIndex]!)
  await expect(page.getByText(`受信 1 / ${frames.length}`, { exact: true })).toBeVisible()
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)).toMatchObject({ active: true, once: false, emissions: 1 })

  await emitInjectedQr(page, frames[lastIndex]!)
  await expect(page.getByText(`受信 1 / ${frames.length}`, { exact: true })).toBeVisible()
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)).toMatchObject({ active: true, once: false, emissions: 2 })

  let received = 1
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    await emitInjectedQr(page, frames[index]!)
    received += 1
    if (received < frames.length) {
      await expect(
        page.getByText(`受信 ${received} / ${frames.length}`, { exact: true }),
      ).toBeVisible()
    }
  }

  await expect(scanDialog).not.toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByText(
      "複数QRの全フレームSHA-256整合性を確認し、取り込みました。",
    ),
  ).toBeVisible()
  snapshot = await injectedScanSnapshot(page)
  expect(snapshot.at(-1)?.active).toBe(false)

  const decrypt = page.getByRole("button", { name: "復号する", exact: true })
  await expect(decrypt).toBeEnabled()
  await decrypt.click()
  await expect(page.getByText("署名はこの鍵に対して有効です")).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.getByText(plaintext, { exact: true })).toBeVisible()
})
