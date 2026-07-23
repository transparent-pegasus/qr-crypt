import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test"
import { PNG } from "pngjs"
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library"

export const AES_ALGORITHM_LABEL = "共通鍵 AES-256-GCM"
export const PQ_ALGORITHM_LABEL = /^ポスト量子 ML-KEM-768 \+ AES-256-GCM$/
export const SIGNED_PQ_ALGORITHM_LABEL = /署名付きポスト量子/

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function expectOnlineGate(page: Page): Promise<void> {
  await expect(page.getByText("オンラインではPWAの導入のみ利用できます")).toBeVisible()
  await expect(page.getByRole("img", { name: /アプリアイコン/ })).toBeVisible()
  await expect(page.getByText("PWAインストール状態")).toBeVisible()
  await expect(page.getByText("オフライン利用準備状態")).toBeVisible()
  await expect(
    page.getByText(
      "機内モードなどでオフラインに切り替えるとオフライン機能を利用できます。切替時にリスク確認が表示されます。オフライン化は端末の安全性を証明しません",
    ),
  ).toBeVisible()
  await expect(page.getByText("オンライン", { exact: true })).toBeVisible()
  await expect(page.getByRole("navigation")).toBeHidden()
}

export async function expectOfflineAcknowledgement(page: Page): Promise<void> {
  const shell = page.getByRole("main", {
    name: "オフラインへ切り替わりました。続行前の確認",
  })
  await expect(shell).toBeVisible()
  await expect(
    shell.getByText(/完全に安全にメッセージの暗号化を行う方法はありません/),
  ).toBeVisible()
  await expect(
    shell.getByText(/完全な安全を本アプリが保証するものではありません/),
  ).toBeVisible()
  await expect(
    shell.getByText(/端末の安全性を検証・回復するものではありません/),
  ).toBeVisible()
  await expect(shell.getByText(/完全に安全です/)).toHaveCount(0)
  await expect(
    shell.getByRole("checkbox", {
      name: "上記を理解した上で、リスクを受け入れてこの端末で続行します",
    }),
  ).not.toBeChecked()
  await expect(
    shell.getByRole("button", {
      name: "リスクを理解してオフライン機能を表示",
    }),
  ).toBeDisabled()
  await expect(mainNavigation(page)).toBeHidden()
  await expect(page.getByLabel("平文", { exact: true })).toBeHidden()
}

export async function acknowledgeOfflineRisk(page: Page): Promise<void> {
  await page
    .getByRole("checkbox", {
      name: "上記を理解した上で、リスクを受け入れてこの端末で続行します",
    })
    .check()
  await page
    .getByRole("button", {
      name: "リスクを理解してオフライン機能を表示",
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
  await expect(page.getByText("オンラインではPWAの導入のみ利用できます")).toBeHidden()
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
      name: "オフラインへ切り替わりました。続行前の確認",
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
    "/encrypt": "暗号化",
    "/keys": "鍵",
    "/saved": "保存済み",
    "/settings": "設定",
  } as const
  await mainNavigation(page)
    .getByRole("link", { name: new RegExp(`^${labels[path]}`) })
    .click()
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}$`))
}

export async function createSymmetricKey(page: Page, name: string): Promise<void> {
  await goToOfflinePage(page, "/keys")
  await page.getByRole("tab", { name: "共通鍵", exact: true }).click()
  await page.getByLabel("共通鍵名", { exact: true }).fill(name)
  await page.getByRole("button", { name: "共通鍵を作成", exact: true }).click()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
}

export async function createPqIdentity(page: Page, name: string): Promise<void> {
  await goToOfflinePage(page, "/keys")
  await page.getByRole("tab", { name: "ポスト量子ID", exact: true }).click()
  await page.getByLabel("ポスト量子ID名", { exact: true }).fill(name)
  await page.getByRole("button", { name: "balanced IDを作成", exact: true }).click()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.getByText("KEM ML-KEM-768", { exact: true })).toBeVisible()
  await expect(page.getByText("Signing ML-DSA-65", { exact: true })).toBeVisible()
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
        const open = indexedDB.open("qrypt")
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
              trust: "unverified",
              bundleCreatedAt: identity.createdAt,
              importedAt: Math.max(Date.now(), identity.createdAt),
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
  await chooseOption(page, "暗号化方式", args.algorithmLabel ?? AES_ALGORITHM_LABEL)
  await chooseOption(page, "使用鍵", args.keyName)
  await page.getByLabel("平文", { exact: true }).fill(args.plaintext)
  await page.getByRole("button", { name: "暗号化する", exact: true }).click()

  const result = page.getByRole("region", { name: "暗号結果" })
  await expect(result).toBeVisible()
  await expect(result.getByRole("img", { name: "暗号文QRの画像" })).toBeVisible()
  const payload = (await result.locator("p").first().innerText()).trim()
  expect(payload).toMatch(/^OCM1:/)
  return { payload }
}

export async function encryptSignedPq(
  page: Page,
  args: { identityName: string; plaintext: string },
): Promise<{ payload: string; result: Locator }> {
  await goToOfflinePage(page, "/encrypt")
  await chooseOption(page, "暗号化方式", SIGNED_PQ_ALGORITHM_LABEL)
  await chooseOption(page, "受信者のML-KEM公開鍵", /^(確認済み|未確認): /)
  await chooseOption(page, "自分のML-DSA署名ID", args.identityName)
  await page.getByLabel("平文", { exact: true }).fill(args.plaintext)
  await page.getByRole("button", { name: "暗号化する", exact: true }).click()
  const result = page.getByRole("region", { name: "暗号結果" })
  await expect(result.getByText("暗号化が完了しました")).toBeVisible({
    timeout: 45_000,
  })
  const payload = (await result.locator("p").first().innerText()).trim()
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
        const open = indexedDB.open("qrypt")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          if (!database.objectStoreNames.contains("qrArtifacts")) {
            database.close()
            resolve([])
            return
          }
          const request = database
            .transaction("qrArtifacts")
            .objectStore("qrArtifacts")
            .getAll()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            database.close()
            resolve(
              (request.result as Array<{ kind?: unknown; payload?: unknown }>).map(
                (record) => ({
                  ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
                  ...(typeof record.payload === "string"
                    ? { payload: record.payload }
                    : {}),
                }),
              ),
            )
          }
        }
      }),
  )
}

export async function rawStoreCount(page: Page, storeName: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("qrypt")
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
    const storageKey = "__qrypt_e2e_worker_observations"
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
        sessionStorage.getItem("__qrypt_e2e_worker_observations") ?? "[]",
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
      __qryptE2eScans?: ScanEntry[]
      __qryptE2eDecoder?: (
        video: HTMLVideoElement,
        onText: (payload: string) => void,
        onError: (error: unknown) => void,
        options?: { once?: boolean },
      ) => Promise<ScanEntry>
      __qryptE2eEmit?: (payload: string) => void
      __qryptE2eScanSnapshot?: () => Array<{
        active: boolean
        once: boolean
        emissions: number
      }>
    }
    const target = window as DecoderWindow
    const scans: ScanEntry[] = []
    target.__qryptE2eScans = scans
    target.__qryptE2eDecoder = async (_video, onText, _onError, options) => {
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
    target.__qryptE2eEmit = (payload) => {
      const entry = [...scans].reverse().find((candidate) => candidate.active)
      if (entry === undefined) throw new Error("No active injected QR decoder")
      entry.emit(payload)
    }
    target.__qryptE2eScanSnapshot = () =>
      scans.map(({ active, once, emissions }) => ({ active, once, emissions }))
  })

  await page.route("**/assets/index-*.js", async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const startQrScanPattern =
      /async function [$\w]+\(([$\w]+),([$\w]+),([$\w]+),([$\w]+)\)\{(?=let [$\w]+=new [$\w]+,[$\w]+=[$\w]+\?\.once\?\?!0,[$\w]+=!1,[$\w]+=!1)/g
    const matches = [...source.matchAll(startQrScanPattern)]
    if (matches.length !== 1) {
      throw new Error("Production scanner bundle marker was not found")
    }
    const [marker, video, onText, onError, options] = matches[0]!
    const injected = `${marker}if(globalThis.__qryptE2eDecoder){return await globalThis.__qryptE2eDecoder(${video},${onText},${onError},${options})}`
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
        if (!source.includes("__qryptE2eDecoder")) {
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
    const emit = (window as Window & { __qryptE2eEmit?: (payload: string) => void })
      .__qryptE2eEmit
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
        __qryptE2eScanSnapshot?: () => Array<{
          active: boolean
          once: boolean
          emissions: number
        }>
      }
    ).__qryptE2eScanSnapshot
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
  if (estimatedVersion < 1 || estimatedVersion > 40) {
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
  const pause = scope.getByRole("button", { name: "一時停止" })
  if (await pause.isVisible()) await pause.click()
  const counter = scope.getByText(/^\d+ \/ \d+$/).last()
  await expect(counter).toBeVisible()
  const initial = (await counter.innerText()).match(/^(\d+) \/ (\d+)$/)
  if (initial === null) throw new Error("Animated QR frame counter is invalid")
  const total = Number(initial[2])
  const payloads = new Map<number, string>()
  const image = scope.locator('img[alt$="の画像"]').first()

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
    await scope.getByRole("button", { name: "次のフレーム" }).click()
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

export function mainNavigation(page: Page) {
  return page.getByRole("navigation", { name: "メインナビゲーション" })
}
