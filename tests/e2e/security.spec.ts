import { expect, test } from "@playwright/test"
import {
  createSymmetricKey,
  encryptWithStoredKey,
  loadOnlineGate,
  rawQrArtifacts,
  switchToOfflineApp,
} from "./helpers"

test("the cryptographic flow sends nothing externally, leaves no secrets or message artifacts, and preserves CSP", async ({
  context,
  page,
}) => {
  const requestUrls: string[] = []
  const consoleMessages: string[] = []
  page.on("request", (request) => requestUrls.push(request.url()))
  page.on("console", (message) => consoleMessages.push(message.text()))

  await loadOnlineGate(page, "/keys")
  const deployedHeaders = await page.evaluate(async () => {
    const response = await fetch("/_headers", { cache: "no-store" })
    if (!response.ok) throw new Error(`_headers: ${response.status}`)
    return response.text()
  })
  expect(deployedHeaders).toContain("default-src 'self'")
  expect(deployedHeaders).toContain("script-src 'self'")
  expect(deployedHeaders).toContain("connect-src 'self'")
  expect(deployedHeaders).toContain("worker-src 'self' blob:")
  expect(deployedHeaders).toContain("object-src 'none'")
  expect(deployedHeaders).not.toContain("unsafe-eval")
  expect(deployedHeaders).not.toContain("wasm-unsafe-eval")
  await switchToOfflineApp(page, context)

  const keyName = "セキュリティ確認鍵"
  const plaintext = "絶対にログへ出してはいけない日本語平文-SECURITY-E2E"
  await createSymmetricKey(page, keyName)
  const keyMaterial = await page.evaluate(async () => {
    const records = await new Promise<Array<{ symmetricKey?: CryptoKey }>>(
      (resolve, reject) => {
        const open = indexedDB.open("qr-crypt")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const get = database.transaction("keys").objectStore("keys").getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            database.close()
            resolve(get.result as Array<{ symmetricKey?: CryptoKey }>)
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
  const artifacts = await rawQrArtifacts(page)
  expect(artifacts).toHaveLength(0)
  expect(
    artifacts.filter(
      (artifact) =>
        artifact.kind === "ciphertext" ||
        artifact.payload?.startsWith("OCM1:") ||
        artifact.payload?.startsWith("OCM2:") ||
        artifact.payload?.startsWith("OCF2:"),
    ),
  ).toHaveLength(0)

  const appOrigin = new URL(page.url()).origin
  const externalRequests = requestUrls.filter((url) => {
    const parsed = new URL(url)
    return parsed.protocol.startsWith("http") && parsed.origin !== appOrigin
  })
  expect(externalRequests).toEqual([])

  const output = consoleMessages.join("\n")
  for (const secret of [plaintext, payload, keyMaterial.hex, keyMaterial.base64]) {
    expect(output).not.toContain(secret)
  }
  const localStorageEntries = await page.evaluate(() =>
    Object.entries(window.localStorage).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
  expect(
    localStorageEntries.every(
      ([key]) => key === "oc-lang" || key === "oc-theme",
    ),
  ).toBe(true)
  const localStorageValues = Object.fromEntries(localStorageEntries)
  expect(localStorageValues["oc-lang"]).toMatch(/^(?:en|ja)$/)
  expect(localStorageValues["oc-theme"]).toMatch(/^(?:light|dark|system)$/)
  for (const [, value] of localStorageEntries) {
    for (const secret of [plaintext, payload, keyMaterial.hex, keyMaterial.base64]) {
      expect(value).not.toContain(secret)
    }
  }
})

test("pending acknowledgement localStorage permits only the theme and the non-sensitive marker value 1", async ({
  page,
}) => {
  await loadOnlineGate(page)
  const entries = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(window.localStorage).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  )

  expect(entries).toEqual({
    "oc-offline-ack-pending": "1",
    "oc-lang": "en",
    "oc-theme": "system",
  })
})
