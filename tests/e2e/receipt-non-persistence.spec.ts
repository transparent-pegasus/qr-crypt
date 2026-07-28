import { expect, test, type Page } from "@playwright/test"
import {
  createPqIdentity,
  encryptSignedPq,
  goToOfflinePage,
  loadOnlineGate,
  seedSelfPublicBundle,
  switchToColdOfflineApp,
} from "./helpers"

interface ReceiptMarkers {
  messageIdHex: string
  recipientKemKeyId: string
  ciphertextHash: string
}

interface PersistenceMatch {
  marker: keyof ReceiptMarkers
  location: string
}

interface PersistenceInspection {
  matches: PersistenceMatch[]
  indexedDbStores: string[]
  localStorageKeys: string[]
  cacheKeys: string[]
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

async function inspectPersistentSurfaces(
  page: Page,
  markers: ReceiptMarkers,
): Promise<PersistenceInspection> {
  return page.evaluate(async (needles) => {
    type Marker = keyof typeof needles
    interface Match {
      marker: Marker
      location: string
    }

    const markerEntries = Object.entries(needles) as Array<[Marker, string]>
    const encoder = new TextEncoder()
    const byteNeedles = markerEntries.map(([marker, value]) => ({
      marker,
      utf8: encoder.encode(value),
      raw:
        /^[0-9a-f]+$/u.test(value) && value.length % 2 === 0
          ? Uint8Array.from(
              { length: value.length / 2 },
              (_, index) =>
                Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
            )
          : undefined,
    }))
    const found = new Map<string, Match>()
    const addMatch = (marker: Marker, location: string): void => {
      found.set(`${marker}\n${location}`, { marker, location })
    }
    const containsBytes = (haystack: Uint8Array, needle: Uint8Array): boolean => {
      if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) {
        return false
      }
      outer: for (
        let offset = 0;
        offset <= haystack.byteLength - needle.byteLength;
        offset += 1
      ) {
        for (let index = 0; index < needle.byteLength; index += 1) {
          if (haystack[offset + index] !== needle[index]) continue outer
        }
        return true
      }
      return false
    }
    const inspectString = (value: string, location: string): void => {
      for (const [marker, needle] of markerEntries) {
        if (value.includes(needle)) addMatch(marker, `${location}:text`)
      }
    }
    const inspectBytes = (value: Uint8Array, location: string): void => {
      for (const needle of byteNeedles) {
        if (containsBytes(value, needle.utf8)) {
          addMatch(needle.marker, `${location}:utf8-bytes`)
        }
        if (needle.raw !== undefined && containsBytes(value, needle.raw)) {
          addMatch(needle.marker, `${location}:raw-bytes`)
        }
      }
    }
    const inspectValue = async (
      value: unknown,
      location: string,
      seen: WeakSet<object>,
    ): Promise<void> => {
      if (typeof value === "string") {
        inspectString(value, location)
        return
      }
      if (value instanceof ArrayBuffer) {
        inspectBytes(new Uint8Array(value), location)
        return
      }
      if (ArrayBuffer.isView(value)) {
        inspectBytes(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
          location,
        )
        return
      }
      if (value instanceof Blob) {
        inspectBytes(new Uint8Array(await value.arrayBuffer()), location)
        return
      }
      if (typeof value !== "object" || value === null || seen.has(value)) return
      seen.add(value)
      if (value instanceof Map) {
        let index = 0
        for (const [key, entry] of value.entries()) {
          await inspectValue(key, `${location}.mapKey[${index}]`, seen)
          await inspectValue(entry, `${location}.mapValue[${index}]`, seen)
          index += 1
        }
        return
      }
      if (value instanceof Set) {
        let index = 0
        for (const entry of value.values()) {
          await inspectValue(entry, `${location}.setValue[${index}]`, seen)
          index += 1
        }
        return
      }
      if (Array.isArray(value)) {
        for (const [index, entry] of value.entries()) {
          await inspectValue(entry, `${location}[${index}]`, seen)
        }
        return
      }
      for (const [key, entry] of Object.entries(value)) {
        inspectString(key, `${location}.property`)
        await inspectValue(entry, `${location}.${key}`, seen)
      }
    }
    const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
    const openDatabase = (name: string): Promise<IDBDatabase> =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onerror = () => reject(request.error)
        request.onblocked = () =>
          reject(new Error(`IndexedDB open was blocked: ${name}`))
        request.onsuccess = () => resolve(request.result)
      })

    const indexedDbStores: string[] = []
    const databaseEntries = (await indexedDB.databases())
      .filter(
        (entry): entry is IDBDatabaseInfo & { name: string } =>
          typeof entry.name === "string",
      )
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of databaseEntries) {
      const database = await openDatabase(entry.name)
      try {
        for (const storeName of Array.from(database.objectStoreNames).sort()) {
          const storeLocation = `indexedDB:${entry.name}/${storeName}`
          indexedDbStores.push(`${entry.name}/${storeName}`)
          const transaction = database.transaction(storeName, "readonly")
          const store = transaction.objectStore(storeName)
          const [keys, values] = await Promise.all([
            requestResult(store.getAllKeys()),
            requestResult(store.getAll()),
          ])
          for (const [index, key] of keys.entries()) {
            await inspectValue(
              key,
              `${storeLocation}.keys[${index}]`,
              new WeakSet(),
            )
          }
          for (const [index, value] of values.entries()) {
            await inspectValue(
              value,
              `${storeLocation}.values[${index}]`,
              new WeakSet(),
            )
          }
        }
      } finally {
        database.close()
      }
    }

    const localStorageKeys = Object.keys(localStorage).sort()
    for (const key of localStorageKeys) {
      inspectString(key, `localStorage:${key}:key`)
      inspectString(localStorage.getItem(key) ?? "", `localStorage:${key}:value`)
    }

    const cacheKeys: string[] = []
    for (const cacheName of (await caches.keys()).sort()) {
      inspectString(cacheName, `CacheStorage:${cacheName}:name`)
      const cache = await caches.open(cacheName)
      const requests = await cache.keys()
      for (const request of requests) {
        const requestLocation = `CacheStorage:${cacheName}:${request.method}:${request.url}`
        cacheKeys.push(`${cacheName}:${request.method}:${request.url}`)
        inspectString(request.url, `${requestLocation}:url`)
        inspectString(request.method, `${requestLocation}:method`)
        for (const [name, value] of request.headers.entries()) {
          inspectString(name, `${requestLocation}:request-header-name`)
          inspectString(value, `${requestLocation}:request-header:${name}`)
        }
        const response = await cache.match(request)
        if (response === undefined) {
          throw new Error(`CacheStorage body was unavailable: ${request.url}`)
        }
        for (const [name, value] of response.headers.entries()) {
          inspectString(name, `${requestLocation}:response-header-name`)
          inspectString(value, `${requestLocation}:response-header:${name}`)
        }
        inspectBytes(
          new Uint8Array(await response.clone().arrayBuffer()),
          `${requestLocation}:response-body`,
        )
      }
    }

    return {
      matches: [...found.values()].sort((left, right) =>
        `${left.marker}:${left.location}`.localeCompare(
          `${right.marker}:${right.location}`,
        ),
      ),
      indexedDbStores,
      localStorageKeys,
      cacheKeys: cacheKeys.sort(),
    }
  }, markers)
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
  const beforeDecryption = await inspectPersistentSurfaces(page, markers)
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

  const afterDecryption = await inspectPersistentSurfaces(page, markers)
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
  const afterKeyCleanup = await inspectPersistentSurfaces(page, markers)
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
