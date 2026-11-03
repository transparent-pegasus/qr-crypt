import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import {
  existingExecutable,
  mayTerminateChild,
  selectCdpPort,
  validateLaunchInputs,
} from "./launcher"

const execute = promisify(execFile)
export const APP_ORIGIN = "http://tauri.localhost"
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

export function redactEvidence(
  value: string,
  storage: string,
  executable: string,
): string {
  for (const [path, label] of [
    [storage, "<owned-storage>"],
    [executable, "<release-exe>"],
    [process.cwd(), "<checkout>"],
    [process.env.USERPROFILE, "<user-profile>"],
    [process.env.HOME, "<user-profile>"],
  ] as const) {
    if (path) value = value.split(path).join(label)
  }
  return value.replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, "<user-profile>")
}

interface WindowIdentity {
  processId: number
  startedAt: number
  windowHandle: string
  title: string
  windows: { caption: string; version: string; build: string }
  webview2: { fileVersion: string; productVersion: string }
  cdpOwned: boolean
}

interface NativeWindowState {
  minimized: boolean
  visible: boolean
  at: number
  processId: number
  windowHandle: string
}

export interface NativeClipboard {
  text: string
  png: string | null
}

interface ObservedRequest {
  url: string
  method: string
  body: string | null
}

interface AssetResponse {
  path: string
  status: number
  mime: string
  sha256: string
}

export interface DocumentObservation {
  origin: string
  secure: boolean
  heading: string | null
  body: string
  csp: string | null
  referrer: string | null
}

export async function observeDocument(page: Page): Promise<DocumentObservation> {
  return page.evaluate(() => ({
    origin: location.origin,
    secure: isSecureContext,
    heading: document.querySelector("h1")?.textContent?.trim() ?? null,
    body: document.body.innerText,
    csp:
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content") ?? null,
    referrer:
      document.querySelector('meta[name="referrer"]')?.getAttribute("content") ?? null,
  }))
}

type InstrumentedWindow = Window &
  typeof globalThis & {
    __nativeRegistrations: string[]
    __nativeVisibility: { state: string; at: number }[]
  }

export interface NativeRelay {
  page: Page
  context: BrowserContext
  buildSha: string
  version: string
  initial: DocumentObservation
  requests: ObservedRequest[]
  downloads: string
  minimize(): Promise<NativeWindowState>
  hide(): Promise<NativeWindowState>
  restore(): Promise<NativeWindowState>
  seedClipboard(text: string): Promise<NativeClipboard>
  readClipboard(): Promise<NativeClipboard>
  assertBundleTraffic(requireWasm?: boolean): Promise<void>
}

export const test = base.extend<{ native: NativeRelay }>({
  native: async ({ playwright }, provide, testInfo) => {
    const sourceHead = (
      await execute("git", ["rev-parse", "HEAD"], { timeout: 5_000 })
    ).stdout.trim()
    const input = validateLaunchInputs(
      process.platform,
      process.env.NATIVE_RELAY_EXE,
      process.env.VITE_BUILD_SHA,
      sourceHead,
    )
    const executable = await existingExecutable(input.executable)
    const root = resolve("dist-relay")
    const assetHashes = new Map<string, string>()
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const path = join(entry.parentPath, entry.name)
      assetHashes.set(
        "/" + relative(root, path).split(sep).join("/"),
        digest(await readFile(path)),
      )
    }
    expect(
      assetHashes.has("/index.html"),
      "build dist-relay from this checkout before Cargo",
    ).toBe(true)
    const scripts = await Promise.all(
      [...assetHashes.keys()]
        .filter((path) => path.endsWith(".js"))
        .map((path) => readFile(join(root, path.slice(1)), "utf8")),
    )
    expect(
      scripts.some((script) => script.includes(input.buildSha)),
      "dist-relay must embed the complete expected source SHA",
    ).toBe(true)
    const version = (
      JSON.parse(await readFile("package.json", "utf8")) as { version: string }
    ).version
    const locks = {
      aube: digest(await readFile("aube-lock.yaml")),
      cargo: digest(await readFile("native/desktop/Cargo.lock")),
    }
    const exeSha256 = digest(await readFile(executable))
    const script = await readFile(new URL("./windows.ps1", import.meta.url), "utf8")
    const encodedScript = Buffer.from(script, "utf16le").toString("base64")
    const storage = await mkdtemp(join(await realpath(tmpdir()), "qr-native-relay-"))
    const profile = join(storage, "profile")
    const downloads = join(storage, "downloads")
    await mkdir(downloads)
    const port = await selectCdpPort()
    const spawnedAfter = Date.now() - 2_000
    const child = spawn(executable, [], {
      shell: false,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
          "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + port,
      },
    })
    let output = ""
    const recordOutput = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-32_768)
    }
    child.stdout.on("data", recordOutput)
    child.stderr.on("data", recordOutput)
    let spawnError: Error | undefined
    child.on("error", (error) => {
      spawnError = error
    })
    let browser: Browser | undefined
    let identity: WindowIdentity | undefined
    let runtime: unknown
    let cleanupFailure: unknown
    let cleanup: unknown
    const requests: ObservedRequest[] = []
    const responses: AssetResponse[] = []
    const responseTasks: Promise<void>[] = []
    const responseErrors: string[] = []
    const pageErrors: string[] = []
    const observations: unknown[] = []
    const redact = (value: string) => redactEvidence(value, storage, executable)
    const windows = async <T>(
      action: string,
      extra: Record<string, unknown> = {},
    ): Promise<T> => {
      const pending = execute(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodedScript],
        { timeout: 15_000, windowsHide: true },
      )
      pending.child.stdin?.on("error", () => undefined)
      pending.child.stdin?.end(
        JSON.stringify({
          action,
          processId: child.pid,
          executable,
          spawnedAfter,
          startedAt: identity?.startedAt ?? null,
          windowHandle: identity?.windowHandle ?? null,
          profile,
          port,
          ...extra,
        }),
      )
      try {
        const { stdout } = await pending
        return JSON.parse(stdout.replace(/^\uFEFF/, "").trim()) as T
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { stderr?: string }
        throw new Error(
          "Native PowerShell " +
            action +
            " failed: " +
            redact(failure.stderr || failure.code || failure.message),
          { cause: error },
        )
      }
    }
    try {
      if (child.pid === undefined)
        throw new Error(
          "NATIVE_RELAY_SETUP: executable did not start: " +
            redact(String(spawnError ?? "no child PID") + "\n" + output),
        )
      const startupDeadline = Date.now() + 45_000
      let lastError: unknown
      while (Date.now() < startupDeadline) {
        if (spawnError || child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            "NATIVE_RELAY_SETUP: child failed: " +
              redact(
                String(
                  spawnError ?? "exit " + child.exitCode + " signal " + child.signalCode,
                ) +
                  "\n" +
                  output,
              ),
          )
        }
        try {
          identity = await windows<WindowIdentity>("inspect")
          browser = await playwright.chromium.connectOverCDP("http://127.0.0.1:" + port, {
            timeout: 2_000,
          })
          break
        } catch (error) {
          lastError = error
          if (
            /mismatch|does not belong|unique owned profile|loopback-only/.test(
              String(error),
            )
          )
            throw error
          await new Promise((done) => setTimeout(done, 200))
        }
      }
      if (!browser || !identity)
        throw new Error(
          "NATIVE_RELAY_SETUP: bounded startup failed: " +
            redact(String(lastError) + "\n" + output),
        )
      expect(identity.processId).toBe(child.pid)
      expect(identity.cdpOwned).toBe(true)
      expect(browser.contexts()).toHaveLength(1)
      const context = browser.contexts()[0]!
      const page =
        context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 5_000 }))
      expect(context.pages()).toHaveLength(1)
      page.on("pageerror", (error) => pageErrors.push(redact(error.message)))
      context.on("request", (request) =>
        requests.push({
          url: request.url(),
          method: request.method(),
          body: request.postData(),
        }),
      )
      context.on("response", (response) => {
        const url = new URL(response.url())
        // Tauri owns document bootstrapping; check its CSP/identity separately and hash the loaded asset bytes.
        if (
          url.origin !== APP_ORIGIN ||
          url.pathname === "/" ||
          url.pathname === "/index.html"
        )
          return
        responseTasks.push(
          (async () => {
            try {
              responses.push({
                path: url.pathname,
                status: response.status(),
                mime: response.headers()["content-type"] ?? "",
                sha256: digest(await response.body()),
              })
            } catch (error) {
              responseErrors.push(redact(String(error)))
            }
          })(),
        )
      })
      await windows("restore")
      await expect(page.locator("h1")).toHaveText(/^QR Crypt (?:Relay|リレー)$/)
      const initial = await observeDocument(page)
      observations.push({ phase: "initial-real-window", document: initial })
      runtime = {
        browser: browser.version(),
        ...(await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
        }))),
      }
      await context.addInitScript(() => {
        const target = window as InstrumentedWindow
        target.__nativeRegistrations = []
        target.__nativeVisibility = []
        document.addEventListener("visibilitychange", () =>
          target.__nativeVisibility.push({
            state: document.visibilityState,
            at: Date.now(),
          }),
        )
        if (navigator.serviceWorker) {
          const register = navigator.serviceWorker.register.bind(navigator.serviceWorker)
          navigator.serviceWorker.register = (...args) => {
            target.__nativeRegistrations.push(String(args[0]))
            return register(...args)
          }
        }
      })
      await page.evaluate(() => localStorage.setItem("oc-lang", "en"))
      const session = await context.newCDPSession(page)
      await session.send("Network.enable")
      await session.send("Network.setCacheDisabled", { cacheDisabled: true })
      await session.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
      })
      await page.reload({ waitUntil: "load" })
      await expect(
        page.getByRole("heading", { level: 1, name: "QR Crypt Relay", exact: true }),
      ).toBeVisible()
      const ownedWindow = identity
      const changeWindow = async (action: "minimize" | "hide" | "restore") => {
        const result = await windows<NativeWindowState>(action)
        observations.push({ phase: "OS-" + action, result })
        expect(result.windowHandle).toBe(ownedWindow.windowHandle)
        expect(result.processId).toBe(ownedWindow.processId)
        expect(result).toMatchObject({
          minimized: action === "minimize",
          visible: action !== "hide",
        })
        await expect
          .poll(
            async () => {
              const state = await page.evaluate(() => document.visibilityState)
              observations.push({ phase: "DOM-" + action, state, at: Date.now() })
              return state
            },
            {
              message:
                action === "hide"
                  ? "NATIVE_RELAY_HIDE_DOM: owned non-minimized hidden HWND must make the document hidden"
                  : "Native " + action + " must reach document visibility",
            },
          )
          .toBe(action === "restore" ? "visible" : "hidden")
        return result
      }
      await provide({
        page,
        context,
        initial,
        version,
        buildSha: input.buildSha,
        requests,
        downloads,
        minimize: () => changeWindow("minimize"),
        hide: () => changeWindow("hide"),
        restore: () => changeWindow("restore"),
        seedClipboard: (text) => windows<NativeClipboard>("seedClipboard", { text }),
        readClipboard: () => windows<NativeClipboard>("readClipboard"),
        assertBundleTraffic: async (requireWasm = false) => {
          await Promise.all(responseTasks)
          expect(responseErrors).toEqual([])
          expect(requests.length).toBeGreaterThan(0)
          for (const request of requests) {
            const url = new URL(request.url)
            expect(url.origin, request.url).toBe(APP_ORIGIN)
            expect(request.method, request.url).toBe("GET")
            expect(request.body, request.url).toBeNull()
            expect(url.search, request.url).toBe("")
            expect(url.username + url.password + url.port, request.url).toBe("")
            expect(
              url.pathname === "/" || assetHashes.has(url.pathname),
              request.url,
            ).toBe(true)
            expect([
              "/manifest.webmanifest",
              "/reachability-sentinel.txt",
              "/sw.js",
            ]).not.toContain(url.pathname)
          }
          expect(responses.some((response) => response.path.endsWith(".js"))).toBe(true)
          if (requireWasm)
            expect(responses.some((response) => response.path.endsWith(".wasm"))).toBe(
              true,
            )
          for (const response of responses) {
            expect(response.status, response.path).toBe(200)
            expect(response.sha256, response.path).toBe(assetHashes.get(response.path))
            if (response.path.endsWith(".wasm"))
              expect(response.mime).toMatch(/^application\/wasm(?:;|$)/)
            if (response.path.endsWith(".js"))
              expect(response.mime).toMatch(/^(?:text|application)\/javascript(?:;|$)/)
            if (response.path.endsWith(".css"))
              expect(response.mime).toMatch(/^text\/css(?:;|$)/)
          }
          expect(
            await page.evaluate(
              () => (window as InstrumentedWindow).__nativeRegistrations,
            ),
          ).toEqual([])
          expect(
            await page.evaluate(async () =>
              navigator.serviceWorker
                ? (await navigator.serviceWorker.getRegistrations()).length
                : 0,
            ),
          ).toBe(0)
        },
      })
      observations.push({
        phase: "final",
        document: await observeDocument(page),
        visibility: await page.evaluate(
          () => (window as InstrumentedWindow).__nativeVisibility,
        ),
      })
    } finally {
      try {
        if (child.pid !== undefined && mayTerminateChild(child, child.pid))
          await windows("terminate")
        if (
          child.exitCode === null &&
          child.signalCode === null &&
          child.pid !== undefined
        ) {
          await new Promise<void>((done, fail) => {
            const timeout = setTimeout(
              () => fail(new Error("Owned native process did not exit")),
              10_000,
            )
            child.once("exit", () => {
              clearTimeout(timeout)
              done()
            })
          })
        }
        if (browser) {
          let timeout: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              browser.close(),
              new Promise<never>((_, fail) => {
                timeout = setTimeout(
                  () => fail(new Error("Owned CDP connection did not close")),
                  5_000,
                )
              }),
            ])
          } finally {
            clearTimeout(timeout)
          }
        }
        await rm(storage, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 300,
        })
        cleanup = { ownedTreeExited: true, profileRemoved: true }
      } catch (error) {
        cleanup = { error: redact(String(error)) }
        cleanupFailure = error
      } finally {
        await testInfo.attach("native-candidate.json", {
          body: Buffer.from(
            redact(
              JSON.stringify(
                {
                  sourceHead,
                  expectedBuildSha: input.buildSha,
                  version,
                  exeSha256,
                  locks,
                  window: identity,
                  runtime,
                  assets: Object.fromEntries(assetHashes),
                  observations,
                  requests,
                  responses,
                  responseErrors,
                  pageErrors,
                  childOutput: redact(output),
                  childExit: { code: child.exitCode, signal: child.signalCode },
                  cleanup,
                },
                null,
                2,
              ),
            ),
          ),
          contentType: "application/json",
        })
      }
    }
    if (cleanupFailure) throw cleanupFailure
  },
  page: async ({ native }, provide) => provide(native.page),
  context: async ({ native }, provide) => provide(native.context),
})

export { expect }
