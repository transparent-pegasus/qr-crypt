import { expect, test } from "@playwright/test"
import { META_UNSUPPORTED_DIRECTIVES } from "../../scripts/csp-from-headers.mjs"
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
  const navigation = await page.goto("/keys", { waitUntil: "domcontentloaded" })
  const servedCsp = navigation?.headers()["content-security-policy"]
  expect(servedCsp, "the origin must serve a Content-Security-Policy header").toBeTruthy()

  const directives = new Map(
    (servedCsp ?? "")
      .split(";")
      .map((directive) => directive.trim())
      .filter((directive) => directive !== "")
      .map((directive) => {
        const tokens = directive.split(/\s+/)
        return [tokens[0]!, tokens.slice(1)] as const
      }),
  )
  expect(directives.get("default-src")).toEqual(["'self'"])
  expect(directives.get("connect-src")).toEqual(["'self'"])
  expect(directives.get("object-src")).toEqual(["'none'"])
  expect(directives.get("base-uri")).toEqual(["'none'"])
  expect(directives.get("form-action")).toEqual(["'none'"])
  expect(directives.get("frame-ancestors")).toEqual(["'none'"])
  expect(directives.get("worker-src")).toEqual(["'self'", "blob:"])
  expect(directives.get("script-src")).toContain("'wasm-unsafe-eval'")
  expect(directives.get("script-src")).not.toContain("'unsafe-eval'")

  // The self-hosted release ZIP is served by hosts that ignore _headers, so the
  // built page must carry the same policy as a meta tag, minus the directives a
  // meta CSP cannot express.
  const metaCsp = await page.getAttribute(
    'meta[http-equiv="Content-Security-Policy"]',
    "content",
  )
  expect(metaCsp, "the built index.html must carry a meta CSP fallback").toBeTruthy()
  const expectedMeta = (servedCsp ?? "")
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "")
    .filter(
      (directive) =>
        !META_UNSUPPORTED_DIRECTIVES.includes(
          directive.split(/\s+/)[0]?.toLowerCase() ?? "",
        ),
    )
    .join("; ")
  expect(metaCsp).toBe(expectedMeta)
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
