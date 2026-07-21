import { expect, test } from "@playwright/test"
import { createSymmetricKey, encryptWithStoredKey, openOfflineApp } from "./helpers"

test("暗号フローは同一オリジンに限定され秘密をログや localStorage に残さない", async ({
  context,
  page,
}) => {
  const requestUrls: string[] = []
  const consoleMessages: string[] = []
  page.on("request", (request) => requestUrls.push(request.url()))
  page.on("console", (message) => consoleMessages.push(message.text()))

  const keyName = "セキュリティ確認鍵"
  const plaintext = "絶対にログへ出してはいけない日本語平文-SECURITY-E2E"
  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, keyName)

  const keyMaterial = await page.evaluate(async () => {
    const records = await new Promise<Array<{ symmetricKey?: CryptoKey }>>(
      (resolve, reject) => {
        const openRequest = indexedDB.open("qrypt")
        openRequest.onerror = () => reject(openRequest.error)
        openRequest.onsuccess = () => {
          const database = openRequest.result
          const getRequest = database.transaction("keys").objectStore("keys").getAll()
          getRequest.onerror = () => reject(getRequest.error)
          getRequest.onsuccess = () => {
            database.close()
            resolve(getRequest.result as Array<{ symmetricKey?: CryptoKey }>)
          }
        }
      },
    )
    const key = records.find((record) => record.symmetricKey)?.symmetricKey
    if (key === undefined) throw new Error("Stored symmetric CryptoKey was not found")
    const bytes = new Uint8Array(await crypto.subtle.exportKey("raw", key))
    return {
      hex: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
      base64: btoa(String.fromCharCode(...bytes)),
    }
  })

  const { payload } = await encryptWithStoredKey(page, { keyName, plaintext })

  expect(requestUrls.length).toBeGreaterThan(0)
  const appOrigin = new URL(page.url()).origin
  for (const url of requestUrls) {
    expect(new URL(url).origin, `external request: ${url}`).toBe(appOrigin)
  }

  const output = consoleMessages.join("\n")
  for (const secret of [plaintext, payload, keyMaterial.hex, keyMaterial.base64]) {
    expect(output).not.toContain(secret)
  }

  const localStorageKeys = await page.evaluate(() =>
    Object.keys(window.localStorage).sort(),
  )
  expect(localStorageKeys.every((key) => key === "oc-theme")).toBe(true)
})
