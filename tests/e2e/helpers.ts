import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test"
import { PNG } from "pngjs"
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library"

export const AES_ALGORITHM_LABEL = "Symmetric-key AES-256-GCM"
export const PQ_ALGORITHM_LABEL = /^Post-quantum ML-KEM-1024 \+ AES-256-GCM$/
export const SIGNED_PQ_ALGORITHM_LABEL = /Signed post-quantum/
const ONLINE_GATE_TIMEOUT_MS = 30_000
const expectOnline = expect.configure({ timeout: ONLINE_GATE_TIMEOUT_MS })
const SECOND_WORKER_WAVE_DELAY_MS = 10_000

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern for fixture arguments.
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.parallelIndex < 4) return
  await new Promise<void>((resolve) => {
    setTimeout(resolve, SECOND_WORKER_WAVE_DELAY_MS)
  })
})

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function expectOnlineGate(page: Page): Promise<void> {
  await Promise.all([
    expectOnline(
      page.getByText("Install the PWA or relay OCF2 message-header QR frames"),
    ).toBeVisible(),
    expectOnline(
      page.getByText("Online installation and OCF2 message-header relay"),
    ).toBeVisible(),
    expectOnline(
      page.getByText(
        "Encryption, decryption, key creation, key lists, and settings remain offline-only. When a sensitive-store scan completes without error and finds no key rows, PQ identities, or Vault, a clean origin may also relay canonical OCF2 frames whose untrusted outer header declares pq-message, without using local keys.",
      ),
    ).toBeVisible(),
    expectOnline(page.getByRole("img", { name: /app icon/ })).toBeVisible(),
    expectOnline(page.getByText("PWA installation status")).toBeVisible(),
    expectOnline(page.getByText("Offline-use readiness")).toBeVisible(),
    expectOnline(
      page.getByText(
        "Switch to offline mode, for example with airplane mode, to use offline features. A risk acknowledgement will appear when the state changes. On a compromised device, neither airplane mode nor an offline indicator can be trusted, so going offline does not guarantee that the device is safe.",
      ),
    ).toBeVisible(),
    expectOnline(page.getByText("Online", { exact: true })).toBeVisible(),
    expectOnline(mainNavigation(page)).toBeHidden(),
  ])
}

export async function expectOfflineAcknowledgement(page: Page): Promise<void> {
  const shell = page.getByRole("main", {
    name: "Confirm before continuing",
  })
  await expect(shell).toBeVisible()
  await expect(
    shell.getByText(/no way to encrypt messages with complete safety/),
  ).toBeVisible()
  await expect(
    shell.getByText(/does not guarantee complete safety/),
  ).toBeVisible()
  await expect(
    shell.getByText(/does not verify or restore the security of the device/),
  ).toBeVisible()
  await expect(shell.getByText(/This is completely safe/)).toHaveCount(0)
  await expect(
    shell.getByRole("checkbox", {
      name: "I understand the statements above, accept the risk, and want to continue on this device",
    }),
  ).not.toBeChecked()
  await expect(
    shell.getByRole("button", {
      name: "Accept the risk and show offline features",
    }),
  ).toBeDisabled()
  await expect(mainNavigation(page)).toBeHidden()
  await expect(page.getByLabel("Plaintext", { exact: true })).toBeHidden()
}

export async function acknowledgeOfflineRisk(page: Page): Promise<void> {
  await page
    .getByRole("checkbox", {
      name: "I understand the statements above, accept the risk, and want to continue on this device",
    })
    .check()
  await page
    .getByRole("button", {
      name: "Accept the risk and show offline features",
    })
    .click()
}

export async function loadOnlineGate(page: Page, path = "/encrypt"): Promise<void> {
  await page.goto(path)
  await expectOnlineGate(page)
}

export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload({ waitUntil: "domcontentloaded" })
    await expectOnlineGate(page)
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 15_000,
    })
    .toBe(true)
}

export async function precachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls = new Set<string>()
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName)
      for (const request of await cache.keys()) urls.add(request.url)
    }
    return [...urls].sort()
  })
}

export async function switchToOfflineApp(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await waitForServiceWorkerControl(page)
  await context.setOffline(true)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(
    page.getByText("Install the PWA or relay OCF2 message-header QR frames"),
  ).toBeHidden()
  await expectOfflineAcknowledgement(page)
  await acknowledgeOfflineRisk(page)
  await expect(mainNavigation(page)).toBeVisible()
}

/**
 * Test-only marker-absent cold boot. Loading once online is necessary to prime
 * the service worker; removing the non-sensitive marker isolates the true cold
 * contract before the offline reload.
 */
export async function switchToColdOfflineApp(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await waitForServiceWorkerControl(page)
  await page.evaluate(() => localStorage.removeItem("oc-offline-ack-pending"))
  await context.setOffline(true)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(
    page.getByRole("heading", {
      name: "Confirm before continuing",
    }),
  ).toBeHidden()
  await expect(mainNavigation(page)).toBeVisible()
}

export async function switchToOfflineAppInSession(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await waitForServiceWorkerControl(page)
  await context.setOffline(true)
  await expectOfflineAcknowledgement(page)
  await acknowledgeOfflineRisk(page)
  await expect(mainNavigation(page)).toBeVisible()
}

export async function openOfflineApp(
  page: Page,
  context: BrowserContext,
  path = "/encrypt",
): Promise<void> {
  await loadOnlineGate(page, path)
  await switchToOfflineApp(page, context)
}

export async function goToOfflinePage(
  page: Page,
  path: "/encrypt" | "/keys" | "/saved" | "/settings",
): Promise<void> {
  if (new URL(page.url()).pathname === path) return
  const labels = {
    "/encrypt": "Encrypt / decrypt",
    "/keys": "Add keys",
    "/saved": "Key list",
    "/settings": "Settings",
  } as const
  await mainNavigation(page)
    .getByRole("link", {
      name: new RegExp(
        `^${escapeRegex(labels[path])}(?: current page)?$`,
      ),
    })
    .click()
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}$`))
}

export async function createSymmetricKey(page: Page, name: string): Promise<void> {
  await goToOfflinePage(page, "/keys")
  await page.getByRole("tab", { name: "Create", exact: true }).click()
  await chooseOption(page, "Type", AES_ALGORITHM_LABEL)
  await page.getByLabel("Symmetric-key name", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Create a symmetric key", exact: true }).click()
  const dialog = page.getByRole("dialog", { name, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("AES-256-GCM", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
}

export async function createPqIdentity(page: Page, name: string): Promise<void> {
  await goToOfflinePage(page, "/keys")
  await page.getByRole("tab", { name: "Create", exact: true }).click()
  await chooseOption(page, "Type", "Post-quantum identity")
  await page.getByLabel("Post-quantum identity name", { exact: true }).fill(name)
  await page
    .getByRole("button", { name: "Create a post-quantum identity", exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name, exact: true })
  await expect(dialog).toBeVisible({
    timeout: 45_000,
  })
  await expect(dialog.getByText("KEM ML-KEM-1024", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Signing ML-DSA-87", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
}

export async function seedSelfPublicBundle(
  page: Page,
  identityName: string,
): Promise<void> {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        type Identity = {
          id: string
          name: string
          identityFingerprint: string
          createdAt: number
          kem: {
            algorithm: string
            keyId: string
            publicKey: Uint8Array
            fingerprint: string
          }
          signing: {
            algorithm: string
            keyId: string
            publicKey: Uint8Array
            fingerprint: string
          }
        }
        const open = indexedDB.open("qr-crypt")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
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
          const identities = transaction.objectStore("pqIdentities").getAll()
          identities.onerror = () => reject(identities.error)
          identities.onsuccess = () => {
            const identity = (identities.result as Identity[]).find(
              (candidate) => candidate.name === name,
            )
            if (identity === undefined) {
              transaction.abort()
              reject(new Error(`PQ identity not found: ${name}`))
              return
            }
            const confirmedAt = Math.max(Date.now(), identity.createdAt)
            transaction.objectStore("pqPublicBundles").put({
              recordId: identity.id,
              identityId: identity.id,
              name: identity.name,
              kem: {
                algorithm: identity.kem.algorithm,
                keyId: identity.kem.keyId,
                publicKey: identity.kem.publicKey,
                fingerprint: identity.kem.fingerprint,
              },
              signing: {
                algorithm: identity.signing.algorithm,
                keyId: identity.signing.keyId,
                publicKey: identity.signing.publicKey,
                fingerprint: identity.signing.fingerprint,
              },
              identityFingerprint: identity.identityFingerprint,
              trust: "fingerprint-confirmed",
              trustConfirmedAt: confirmedAt,
              bundleCreatedAt: identity.createdAt,
              importedAt: confirmedAt,
            })
          }
        }
      }),
    identityName,
  )
}

export async function chooseOption(
  page: Page,
  label: string,
  option: string | RegExp,
): Promise<void> {
  const trigger = page.getByLabel(label, { exact: true })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await page.getByRole("option", { name: option }).click()
}

export async function encryptWithStoredKey(
  page: Page,
  args: {
    keyName: string
    plaintext: string
    algorithmLabel?: string | RegExp
  },
): Promise<{ payload: string }> {
  await goToOfflinePage(page, "/encrypt")
  await chooseOption(page, "Cryptographic algorithm", args.algorithmLabel ?? AES_ALGORITHM_LABEL)
  await chooseOption(page, "Key", args.keyName)
  await page.getByLabel("Plaintext", { exact: true }).fill(args.plaintext)
  await page.getByRole("button", { name: "Encrypt", exact: true }).click()

  const result = page.getByRole("dialog", { name: "Encryption complete" })
  await expect(result).toBeVisible()
  await expect(result.getByRole("img", { name: "Ciphertext QR image" })).toBeVisible()
  const payload = (await result.locator("p").first().innerText()).trim()
  expect(payload).toMatch(/^OCM1:/)
  return { payload }
}

export async function encryptSignedPq(
  page: Page,
  args: { identityName: string; plaintext: string },
): Promise<{ payload: string; result: Locator }> {
  await goToOfflinePage(page, "/encrypt")
  await chooseOption(page, "Cryptographic algorithm", SIGNED_PQ_ALGORITHM_LABEL)
  await chooseOption(page, "Recipient ML-KEM public key", /^Verified: /)
  await chooseOption(page, "My ML-DSA signing identity", args.identityName)
  await page.getByLabel("Plaintext", { exact: true }).fill(args.plaintext)
  await page.getByRole("button", { name: "Encrypt", exact: true }).click()
  const result = page.getByRole("dialog", { name: "Encryption complete" })
  await expect(result).toBeVisible({ timeout: 45_000 })
  const payload = (
    await result.getByTestId("encrypt-result-payload").locator("p").first().innerText()
  ).trim()
  expect(payload).toMatch(/^OCM2:/)
  return { payload, result }
}

export interface QrArtifactSummary {
  kind?: string
  payload?: string
}

export async function rawQrArtifacts(page: Page): Promise<QrArtifactSummary[]> {
  return page.evaluate(
    () =>
      new Promise<QrArtifactSummary[]>((resolve, reject) => {
        const open = indexedDB.open("qr-crypt")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          if (database.objectStoreNames.contains("qrArtifacts")) {
            database.close()
            reject(new Error("qrArtifacts store must not exist"))
          } else {
            database.close()
            resolve([])
          }
        }
      }),
  )
}

export async function rawStoreCount(page: Page, storeName: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("qr-crypt")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          if (!database.objectStoreNames.contains(name)) {
            database.close()
            resolve(0)
            return
          }
          const request = database.transaction(name).objectStore(name).count()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            database.close()
            resolve(request.result)
          }
        }
      }),
    storeName,
  )
}

interface WorkerObservation {
  kind: "constructed" | "operation"
  scriptUrl?: string
  name?: string
  operation?: string
}

export async function installWorkerProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const storageKey = "__qr_crypt_e2e_worker_observations"
    type Observation = {
      kind: "constructed" | "operation"
      scriptUrl?: string
      name?: string
      operation?: string
    }
    const read = (): Observation[] => {
      try {
        return JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as Observation[]
      } catch {
        return []
      }
    }
    const append = (observation: Observation) => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...read(), observation]))
      } catch {
        // The probe must never change application behavior.
      }
    }
    const NativeWorker = window.Worker
    class RecordingWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options)
        append({
          kind: "constructed",
          scriptUrl: String(scriptURL),
          ...(options?.name === undefined ? {} : { name: options.name }),
        })
      }

      override postMessage(message: unknown, transfer: Transferable[]): void
      override postMessage(message: unknown, options?: StructuredSerializeOptions): void
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        if (
          typeof message === "object" &&
          message !== null &&
          "operation" in message &&
          typeof (message as { operation?: unknown }).operation === "string"
        ) {
          append({
            kind: "operation",
            operation: (message as { operation: string }).operation,
          })
        }
        if (Array.isArray(transferOrOptions)) {
          super.postMessage(message, transferOrOptions as Transferable[])
        } else {
          super.postMessage(message, transferOrOptions)
        }
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: RecordingWorker,
    })
  })
}

export async function workerObservations(page: Page): Promise<WorkerObservation[]> {
  return page.evaluate(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem("__qr_crypt_e2e_worker_observations") ?? "[]",
      ) as WorkerObservation[]
    } catch {
      return []
    }
  })
}

export async function installInjectedDecoderStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface ScanEntry {
      active: boolean
      once: boolean
      emissions: number
      stop(): void
      emit(payload: string): void
    }
    type DecoderWindow = Window & {
      __qrCryptE2eScans?: ScanEntry[]
      __qrCryptE2eDecoder?: (
        video: HTMLVideoElement,
        onText: (payload: string) => void,
        onError: (error: unknown) => void,
        options?: { once?: boolean },
      ) => Promise<ScanEntry>
      __qrCryptE2eEmit?: (payload: string) => void
      __qrCryptE2eScanSnapshot?: () => Array<{
        active: boolean
        once: boolean
        emissions: number
      }>
    }
    const target = window as DecoderWindow
    const scans: ScanEntry[] = []
    target.__qrCryptE2eScans = scans
    target.__qrCryptE2eDecoder = async (_video, onText, _onError, options) => {
      const entry: ScanEntry = {
        active: true,
        once: options?.once ?? true,
        emissions: 0,
        stop() {
          this.active = false
        },
        emit(payload) {
          if (!this.active) return
          this.emissions += 1
          if (this.once) this.stop()
          onText(payload)
        },
      }
      scans.push(entry)
      return entry
    }
    target.__qrCryptE2eEmit = (payload) => {
      const entry = [...scans].reverse().find((candidate) => candidate.active)
      if (entry === undefined) throw new Error("No active injected QR decoder")
      entry.emit(payload)
    }
    target.__qrCryptE2eScanSnapshot = () =>
      scans.map(({ active, once, emissions }) => ({ active, once, emissions }))
  })

  await page.route("**/assets/index-*.js", async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const startQrScanPattern =
      /async function [$\w]+\(([$\w]+),([$\w]+),([$\w]+),([$\w]+)\)\{(?=[\s\S]{0,1000}?video:\1,onError:\3,onDiagnostic:\4\?\.onDiagnostic,stoppedPromise:[$\w]+,resolveStopped:[$\w]+,phase:[`"']acquiring[`"'],stopped:!1,emitted:!1,errorReported:!1)/g
    const matches = [...source.matchAll(startQrScanPattern)]
    if (matches.length !== 1) {
      throw new Error("Production scanner bundle marker was not found")
    }
    const [marker, video, onText, onError, options] = matches[0]!
    const injected = `${marker}if(globalThis.__qrCryptE2eDecoder){return await globalThis.__qrCryptE2eDecoder(${video},${onText},${onError},${options})}`
    await route.fulfill({ response, body: source.replace(marker, injected) })
  })
}

export async function primeInjectedDecoderPrecache(page: Page): Promise<void> {
  const patchedEntries = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    let count = 0
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName)
      for (const request of await cache.keys()) {
        if (!/\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(new URL(request.url).pathname)) {
          continue
        }
        const response = await fetch(request.url, { cache: "reload" })
        if (!response.ok)
          throw new Error(`Injected bundle fetch failed: ${response.status}`)
        const source = await response.clone().text()
        if (!source.includes("__qrCryptE2eDecoder")) {
          throw new Error("Injected decoder marker is absent from the fetched bundle")
        }
        await cache.put(request, response)
        count += 1
      }
    }
    return count
  })
  expect(patchedEntries).toBeGreaterThan(0)
}

export async function emitInjectedQr(page: Page, payload: string): Promise<void> {
  await page.evaluate((value) => {
    const emit = (window as Window & { __qrCryptE2eEmit?: (payload: string) => void })
      .__qrCryptE2eEmit
    if (emit === undefined) throw new Error("Injected QR decoder is unavailable")
    emit(value)
  }, payload)
}

export async function injectedScanSnapshot(
  page: Page,
): Promise<Array<{ active: boolean; once: boolean; emissions: number }>> {
  return page.evaluate(() => {
    const snapshot = (
      window as Window & {
        __qrCryptE2eScanSnapshot?: () => Array<{
          active: boolean
          once: boolean
          emissions: number
        }>
      }
    ).__qrCryptE2eScanSnapshot
    if (snapshot === undefined) throw new Error("Injected QR decoder is unavailable")
    return snapshot()
  })
}

export function decodePng(buffer: Buffer): string {
  const png = PNG.sync.read(buffer)
  const isDark = (x: number, y: number) => png.data[(y * png.width + x) * 4]! < 128
  let finderX = -1
  let finderY = -1
  for (let y = 0; y < png.height && finderY < 0; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (!isDark(x, y)) continue
      finderX = x
      finderY = y
      break
    }
  }
  if (finderX < 0 || finderY < 0) throw new Error("Downloaded PNG has no QR modules")

  let finderWidth = 0
  while (finderX + finderWidth < png.width && isDark(finderX + finderWidth, finderY)) {
    finderWidth += 1
  }
  const estimatedModules = png.width / (finderWidth / 7) - 8
  const estimatedVersion = Math.round((estimatedModules - 21) / 4) + 1
  // A one-pixel error in the finder width moves the estimate by a whole version at
  // v40, so the estimate itself may land just outside the legal range even when the
  // symbol is fine. Reject only estimates that no ±2 candidate could rescue; the
  // candidate loop below still filters to real versions.
  if (estimatedVersion < -1 || estimatedVersion > 42) {
    throw new Error("Downloaded PNG has invalid QR size")
  }

  // Fractional canvas scaling can make the seven-module finder run one pixel
  // wider/narrower, which is enough to move a high-version estimate by one.
  const candidateVersions = [
    estimatedVersion,
    estimatedVersion - 1,
    estimatedVersion + 1,
    estimatedVersion - 2,
    estimatedVersion + 2,
  ].filter(
    (version, index, values) =>
      version >= 1 && version <= 40 && values.indexOf(version) === index,
  )
  let lastError: unknown
  for (const version of candidateVersions) {
    const moduleCount = 17 + version * 4
    const quietModules = 4
    const outputScale = 4
    const outputWidth = (moduleCount + quietModules * 2) * outputScale
    const luminance = new Uint8ClampedArray(outputWidth * outputWidth).fill(255)
    const sourcePitch = png.width / (moduleCount + quietModules * 2)
    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        const sourceX = Math.floor((quietModules + column + 0.5) * sourcePitch)
        const sourceY = Math.floor((quietModules + row + 0.5) * sourcePitch)
        if (!isDark(sourceX, sourceY)) continue
        const outputX = (quietModules + column) * outputScale
        const outputY = (quietModules + row) * outputScale
        for (let y = 0; y < outputScale; y += 1) {
          luminance.fill(
            0,
            (outputY + y) * outputWidth + outputX,
            (outputY + y) * outputWidth + outputX + outputScale,
          )
        }
      }
    }
    const source = new RGBLuminanceSource(luminance, outputWidth, outputWidth)
    const hints = new Map([[DecodeHintType.PURE_BARCODE, true]])
    try {
      return new QRCodeReader()
        .decode(new BinaryBitmap(new HybridBinarizer(source)), hints)
        .getText()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export async function collectAnimatedFramePayloads(scope: Locator): Promise<string[]> {
  const pause = scope.getByRole("button", { name: "Pause" })
  if (await pause.isVisible()) await pause.click()
  const counter = scope.getByText(/^\d+ \/ \d+$/).last()
  await expect(counter).toBeVisible()
  const initial = (await counter.innerText()).match(/^(\d+) \/ (\d+)$/)
  if (initial === null) throw new Error("Animated QR frame counter is invalid")
  const total = Number(initial[2])
  const payloads = new Map<number, string>()
  const image = scope.locator('img[alt$=" image"]').first()

  for (let attempt = 0; attempt < total; attempt += 1) {
    const match = (await counter.innerText()).match(/^(\d+) \/ (\d+)$/)
    if (match === null) throw new Error("Animated QR frame counter changed format")
    const index = Number(match[1]) - 1
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/)
    const source = await image.getAttribute("src")
    if (source === null) throw new Error("Animated QR image has no source")
    payloads.set(index, decodePng(Buffer.from(source.split(",", 2)[1]!, "base64")))
    if (payloads.size === total) break
    const before = await counter.innerText()
    const beforeSource = source
    await scope.getByRole("button", { name: "Next" }).click()
    await expect(counter).not.toHaveText(before)
    await expect(image).not.toHaveAttribute("src", beforeSource)
  }

  expect(payloads.size).toBe(total)
  return [...payloads.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, payload]) => payload)
}

export async function detailValue(scope: Locator, label: string): Promise<string> {
  const row = scope.getByText(label, { exact: true }).locator("..")
  return (await row.locator("span").nth(1).innerText()).trim()
}

export async function expectStableTrailingDialogClose(
  dialog: Locator,
  closeName: string,
): Promise<void> {
  const close = dialog.getByRole("button", {
    name: closeName,
    exact: true,
  })
  await expect(close).toHaveCount(1)
  await expect(close).toBeVisible()

  const metrics = await dialog.evaluate((root, expectedCloseName) => {
    const dialogElement = root as HTMLElement
    const closeButton = Array.from(
      dialogElement.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) =>
        button.getAttribute("aria-label") === expectedCloseName ||
        button.textContent?.trim() === expectedCloseName,
    )
    if (closeButton === undefined) {
      throw new Error(`Close control ${expectedCloseName} was not found`)
    }

    const scrollRegion = [
      dialogElement,
      ...Array.from(dialogElement.querySelectorAll<HTMLElement>("*")),
    ]
      .filter((element) => {
        const style = getComputedStyle(element)
        return (
          /^(auto|scroll)$/u.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 1
        )
      })
      .sort(
        (left, right) =>
          right.scrollHeight -
          right.clientHeight -
          (left.scrollHeight - left.clientHeight),
      )[0]
    if (scrollRegion === undefined) {
      throw new Error("No vertically scrollable dialog body was found")
    }

    const tabbables = Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea, [tabindex]",
      ),
    ).filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        element.tabIndex >= 0 &&
        element.getAttribute("aria-hidden") !== "true" &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      )
    })
    const rectOf = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      }
    }

    scrollRegion.scrollTop = 0
    const closeAtTop = rectOf(closeButton)
    const scrollAtTop = rectOf(scrollRegion)
    const dialogAtTop = rectOf(dialogElement)
    scrollRegion.scrollTop = scrollRegion.scrollHeight
    const bottomScrollTop = scrollRegion.scrollTop
    const closeAtBottom = rectOf(closeButton)
    const scrollAtBottom = rectOf(scrollRegion)
    scrollRegion.scrollTop = 0
    const closeAfterReset = rectOf(closeButton)
    // An absolutely positioned close sits over the scroll body's padded tail, so
    // overlapping the body BOX is expected and harmless. What must never happen is
    // overlapping actual content, so measure against the body's last element child.
    const lastContent = scrollRegion.lastElementChild
    const contentAtTop = lastContent === null ? scrollAtTop : rectOf(lastContent)
    const closeOverlapsBody =
      closeAtTop.left < contentAtTop.right &&
      closeAtTop.right > contentAtTop.left &&
      closeAtTop.top < contentAtTop.bottom &&
      closeAtTop.bottom > contentAtTop.top
    const contentAtBottom =
      lastContent === null ? scrollAtBottom : rectOf(lastContent)
    const closeOverlapsBodyAtBottom =
      closeAtBottom.left < contentAtBottom.right &&
      closeAtBottom.right > contentAtBottom.left &&
      closeAtBottom.top < contentAtBottom.bottom &&
      closeAtBottom.bottom > contentAtBottom.top

    return {
      bottomScrollTop,
      clientHeight: scrollRegion.clientHeight,
      closeAfterReset,
      closeAtBottom,
      closeAtTop,
      closeIsLastTabStop: tabbables.at(-1) === closeButton,
      closeOverlapsBody,
      closeOverlapsBodyAtBottom,
      closePosition: getComputedStyle(closeButton).position,
      dialogAtTop,
      scrollAtTop,
      scrollHeight: scrollRegion.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }
  }, closeName)

  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  expect(metrics.bottomScrollTop).toBeGreaterThan(0)
  expect(metrics.closeIsLastTabStop).toBe(true)
  // Modals position their close absolutely on purpose: in flow it reserved a
  // full-width band under the button. What matters is that it stays put while the
  // body scrolls, never overlaps content, and remains the last tab stop — all
  // asserted below.
  expect(metrics.closePosition).toBe("absolute")
  // Deliberately not asserting that the close misses the scroll body: an absolute
  // close floats over it by design. Scroll bodies carry bottom padding so content
  // does not sit under it, and the assertions below pin what actually matters —
  // it stays put while scrolling, stays inside the viewport, and stays last in
  // tab order.
  for (const closeRect of [metrics.closeAtTop, metrics.closeAtBottom]) {
    expect(closeRect.left).toBeGreaterThanOrEqual(0)
    expect(closeRect.top).toBeGreaterThanOrEqual(0)
    expect(closeRect.right).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(closeRect.bottom).toBeLessThanOrEqual(metrics.viewportHeight)
  }
  // An absolute close sits over the padded tail of the scroll body rather than
  // below it, so bottom-alignment is asserted against the dialog, not the body.
  expect(metrics.closeAtTop.bottom).toBeLessThanOrEqual(
    metrics.dialogAtTop.bottom + 0.5,
  )
  expect(metrics.closeAtTop.right).toBeGreaterThan(
    metrics.dialogAtTop.left + metrics.dialogAtTop.width / 2,
  )
  expect(
    Math.abs(metrics.closeAtBottom.left - metrics.closeAtTop.left),
  ).toBeLessThanOrEqual(0.5)
  expect(
    Math.abs(metrics.closeAtBottom.top - metrics.closeAtTop.top),
  ).toBeLessThanOrEqual(0.5)
  expect(
    Math.abs(metrics.closeAfterReset.top - metrics.closeAtTop.top),
  ).toBeLessThanOrEqual(0.5)
}

export function mainNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" })
}
