import { expect, test, type Page } from "@playwright/test"
import {
  createPqIdentity,
  encryptSignedPq,
  goToOfflinePage,
  loadOnlineGate,
  seedSelfPublicBundle,
  switchToColdOfflineApp,
} from "./helpers"
import {
  inspectPersistentSurfaces,
  type PersistenceNeedle,
} from "./persistence-inspector"

interface ReceiptMarkers {
  messageIdHex: string
  recipientKemKeyId: string
  ciphertextHash: string
}

function receiptPersistenceNeedles(
  markers: ReceiptMarkers,
): PersistenceNeedle[] {
  return Object.entries(markers).flatMap(([marker, value]) => {
    const needles: PersistenceNeedle[] = [{ marker, text: value }]
    if (/^[0-9a-f]+$/u.test(value) && value.length % 2 === 0) {
      needles.push({
        marker,
        bytes: Array.from(
          { length: value.length / 2 },
          (_, index) =>
            Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
        ),
      })
    }
    return needles
  })
}

async function installReceiptInputProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface CapturedReceiptInput {
      messageIdHex: string
      recipientKemKeyId: string
    }
    type ProbeWindow = Window & {
      __receiptInputProbe?: CapturedReceiptInput
    }
    type WorkerRequest = {
      operation?: unknown
      payload?: {
        messageId?: unknown
        recipientKemKeyId?: unknown
      }
    }

    const NativeWorker = window.Worker
    class ReceiptInputProbeWorker extends NativeWorker {
      override postMessage(message: unknown, transfer: Transferable[]): void
      override postMessage(message: unknown, options?: StructuredSerializeOptions): void
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const request =
          typeof message === "object" && message !== null
            ? (message as WorkerRequest)
            : undefined
        if (
          request?.operation === "encryptPqMessage" &&
          request.payload?.messageId instanceof Uint8Array &&
          typeof request.payload.recipientKemKeyId === "string"
        ) {
          ;(window as ProbeWindow).__receiptInputProbe = {
            messageIdHex: Array.from(request.payload.messageId, (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(""),
            recipientKemKeyId: request.payload.recipientKemKeyId,
          }
        }
        if (Array.isArray(transferOrOptions)) {
          super.postMessage(message, transferOrOptions)
        } else {
          super.postMessage(message, transferOrOptions)
        }
      }
    }

    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: ReceiptInputProbeWorker,
    })
  })
}

async function receiptMarkers(page: Page, payload: string): Promise<ReceiptMarkers> {
  const captured = await page.evaluate(() => {
    const value = (
      window as Window & {
        __receiptInputProbe?: {
          messageIdHex: string
          recipientKemKeyId: string
        }
      }
    ).__receiptInputProbe
    if (value === undefined) {
      throw new Error("The PQ encryption Worker request was not captured")
    }
    return value
  })
  const ciphertextHash = await page.evaluate(async (value) => {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    )
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    )
  }, payload)
  return { ...captured, ciphertextHash }
}

async function clearLegitimatePqKeyRows(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("qr-crypt")
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(
            ["pqIdentities", "pqPublicBundles"],
            "readwrite",
          )
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.objectStore("pqIdentities").clear()
          transaction.objectStore("pqPublicBundles").clear()
        }
      }),
  )
}

test("receipts never persist and do not survive a reload", async ({
  baseURL,
  context,
  page,
}) => {
  test.setTimeout(180_000)
  // Take the origin from the Playwright config rather than a literal: a stray server
  // on the default port would otherwise silently test a different build.
  const appOrigin = baseURL ?? "http://localhost:4173"
  await installReceiptInputProbe(page)
  const identityName = "受領票非永続化-ID"
  const plaintext = "受領票を永続化しない実復号-E2E"
  await loadOnlineGate(page, `${appOrigin}/keys`)
  await switchToColdOfflineApp(page, context)
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  const { payload, result: encryptionResult } = await encryptSignedPq(page, {
    identityName,
    plaintext,
  })
  const markers = await receiptMarkers(page, payload)
  const beforeDecryption = await inspectPersistentSurfaces(
    page,
    receiptPersistenceNeedles(markers),
  )
  expect(
    beforeDecryption.matches.filter(
      (match) =>
        match.marker === "messageIdHex" ||
        match.marker === "ciphertextHash",
    ),
  ).toEqual([])
  expect(
    beforeDecryption.matches.some(
      (match) => match.marker === "recipientKemKeyId",
    ),
  ).toBe(true)

  await encryptionResult.getByRole("button", { name: "Close" }).click()
  await goToOfflinePage(page, "/decrypt")
  const payloadInput = page.getByLabel("Ciphertext payload")
  const decrypt = page.getByRole("button", { name: "Decrypt", exact: true })
  await payloadInput.fill(payload)
  await expect(decrypt).toBeEnabled()
  await decrypt.click()
  await expect(page.getByText(plaintext, { exact: true })).toBeVisible({
    timeout: 45_000,
  })

  let decryptionResult = page.getByRole("dialog", {
    name: "Decryption complete",
  })
  await decryptionResult.getByRole("button", { name: "Close" }).click()
  await expect(decryptionResult).toBeHidden()
  await expect(decrypt).toBeEnabled()
  await decrypt.click()
  decryptionResult = page.getByRole("dialog", {
    name: "Decryption complete",
  })
  await expect(
    decryptionResult.getByRole("alert", {
      name: "Already received in this session",
    }),
  ).toBeVisible()
  await expect(
    decryptionResult.getByText(plaintext, { exact: true }),
  ).toHaveCount(0)

  const afterDecryption = await inspectPersistentSurfaces(
    page,
    receiptPersistenceNeedles(markers),
  )
  expect(afterDecryption.matches).toEqual(beforeDecryption.matches)

  await page.reload({ waitUntil: "domcontentloaded" })
  const reloadedPayloadInput = page.getByLabel("Ciphertext payload")
  await expect(reloadedPayloadInput).toBeVisible()
  await reloadedPayloadInput.fill(payload)
  const reloadedDecrypt = page.getByRole("button", {
    name: "Decrypt",
    exact: true,
  })
  await expect(reloadedDecrypt).toBeEnabled()
  await reloadedDecrypt.click()
  await expect(page.getByText(plaintext, { exact: true })).toBeVisible({
    timeout: 45_000,
  })
  await expect(
    page.getByRole("alert", {
      name: "Already received in this session",
    }),
  ).toHaveCount(0)

  // The recipient ID is legitimate key metadata before decryption. Remove only
  // those two known key rows after the reload check; any receipt persistence in
  // any store remains present and must still be found by the recursive scan.
  await clearLegitimatePqKeyRows(page)
  const afterKeyCleanup = await inspectPersistentSurfaces(
    page,
    receiptPersistenceNeedles(markers),
  )
  expect(afterKeyCleanup.indexedDbStores).toEqual(
    expect.arrayContaining([
      "qr-crypt/pqIdentities",
      "qr-crypt/pqPublicBundles",
    ]),
  )
  expect(afterKeyCleanup.localStorageKeys.length).toBeGreaterThan(0)
  expect(afterKeyCleanup.cacheKeys.length).toBeGreaterThan(0)
  expect(afterKeyCleanup.matches).toEqual([])
})
