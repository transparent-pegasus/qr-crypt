import { expect, test } from "@playwright/test"
import {
  IDENTITY_COMPARISON,
  IDENTITY_DIGEST,
  KEM_COMPARISON,
  SIGNING_COMPARISON,
} from "../fixtures/fingerprints"
import { goToOfflinePage, openOfflineApp } from "./helpers"

test("saved-key confirmation wraps all 64 identity digits at 320px with secondary technical fingerprints", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await openOfflineApp(page, context)
  await page.evaluate(async (identityFingerprint) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("qr-crypt")
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const database = open.result
        const transaction = database.transaction("pqPublicBundles", "readwrite")
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.objectStore("pqPublicBundles").put({
          recordId: "RRRRRRRRRRRRRRRRRRRRRR",
          identityId: "IIIIIIIIIIIIIIIIIIIIII",
          name: "Comparison fixture",
          identityFingerprint,
          trust: "unverified",
          kem: {
            algorithm: "ML-KEM-1024",
            keyId: "KKKKKKKKKKKKKKKKKKKKKK",
            publicKey: new Uint8Array(1568).fill(1),
            fingerprint: "7".repeat(64),
          },
          signing: {
            algorithm: "ML-DSA-87",
            keyId: "SSSSSSSSSSSSSSSSSSSSSS",
            publicKey: new Uint8Array(2592).fill(2),
            fingerprint: "8".repeat(64),
          },
          bundleCreatedAt: 1_700_000_000_000,
          importedAt: 1_700_000_000_001,
        })
      }
    })
  }, IDENTITY_DIGEST)
  await goToOfflinePage(page, "/keys")
  await page.getByRole("tab", { name: "Other parties' keys" }).click()
  await page.getByRole("button", { name: /Unverified/ }).click()
  let dialog = page.getByRole("dialog")
  await dialog
    .getByRole("button", { name: /Verify.*fingerprint|Confirm.*fingerprint/i })
    .click()
  dialog = page.getByRole("dialog")
  const identity = dialog.getByText(IDENTITY_COMPARISON, { exact: false })
  await expect(identity).toBeVisible()
  await expect(dialog.getByRole("checkbox")).toHaveAccessibleName(/64/)
  // Visibility precedes the end of the dialog's opening animation.
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished),
    )
  })
  const dialogBounds = await dialog.boundingBox()
  expect(dialogBounds).not.toBeNull()
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(320)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const layout = await identity.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = [...range.getClientRects()]
    const comparison = element.getBoundingClientRect()
    return {
      lineCount: new Set(lines.map((line) => Math.round(line.top))).size,
      clipped: lines.some(
        (line) => line.left < comparison.left - 1 || line.right > comparison.right + 1 ||
          line.top < comparison.top - 1 || line.bottom > comparison.bottom + 1,
      ),
      pageOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      elementOverflow: element.scrollWidth > element.clientWidth,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      fontWeight: Number.parseFloat(getComputedStyle(element).fontWeight),
      color: getComputedStyle(element).color,
    }
  })
  expect(layout.lineCount).toBeGreaterThan(1)
  expect(layout.clipped).toBe(false)
  expect(layout.pageOverflow).toBe(false)
  expect(layout.elementOverflow).toBe(false)
  const supplementalDisclosure = dialog.getByText(
    "Supplemental KEM and signing fingerprints",
    { exact: true },
  )
  await expect(supplementalDisclosure).toBeVisible()
  await supplementalDisclosure.click()
  for (const text of [KEM_COMPARISON, SIGNING_COMPARISON]) {
    const supplemental = dialog.getByText(text, { exact: false })
    await expect(supplemental).toBeVisible()
    const style = await supplemental.evaluate((element) => ({
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      fontWeight: Number.parseFloat(getComputedStyle(element).fontWeight),
      color: getComputedStyle(element).color,
    }))
    expect(
      layout.fontSize > style.fontSize ||
        layout.fontWeight > style.fontWeight ||
        layout.color !== style.color,
    ).toBe(true)
  }
})
