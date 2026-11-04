import { execFile, spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep, win32 } from "node:path"
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

function createHelperObservation(
  redact: (value: string) => string,
  privatePaths: readonly string[],
  helperHost: { selected: string; executable: string; sha256: string },
) {
  const started = performance.now()
  const now = () => performance.now() - started
  let observationFailures = 0
  const passive = (observe: () => void) => {
    try {
      observe()
    } catch {
      observationFailures++
    }
  }
  const text = (value: string, limit = 1_024) => {
    let redacted = "<redaction-failed>"
    passive(() => {
      redacted = redact(
        value
          .replace(/(-EncodedCommand\s+)[A-Za-z0-9+/=]+/gi, "$1<encoded-command-omitted>")
          .replace(/[A-Za-z0-9+/_=-]{200,}/g, "<long-base64-omitted>"),
      )
      for (const path of privatePaths) {
        if (!path) continue
        for (const variant of [
          path,
          path.replaceAll("\\", "/"),
          path.replaceAll("/", "\\"),
          JSON.stringify(path).slice(1, -1),
        ]) {
          redacted = redacted.replace(
            new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
            "<private-path>",
          )
        }
      }
    })
    const bytes = Buffer.from(redacted)
    let end = Math.min(limit, bytes.length)
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
    return { text: bytes.toString("utf8", 0, end), omittedUtf8Bytes: bytes.length - end }
  }
  const read = (value: unknown, key: string): unknown => {
    let field: unknown = null
    passive(() => {
      if (value !== null && typeof value === "object")
        field = (value as Record<string, unknown>)[key]
    })
    return field
  }
  const fields = (error: unknown, limit: number) => {
    let omittedUtf8Bytes = Number(read(error, "omittedUtf8Bytes")) || 0
    const primitive = (key: string) => {
      const value = read(error, key)
      if (key === "killed" || key === "timedOut")
        return typeof value === "boolean" ? value : null
      if (typeof value === "string") {
        const bounded = text(value, limit)
        omittedUtf8Bytes += bounded.omittedUtf8Bytes
        return bounded.text
      }
      return (key === "code" || key === "errno") &&
        typeof value === "number" &&
        Number.isFinite(value)
        ? value
        : null
    }
    const result = {
      name: primitive("name"),
      message: primitive("message"),
      code: primitive("code"),
      errno: primitive("errno"),
      syscall: primitive("syscall"),
      signal: primitive("signal"),
      killed: primitive("killed"),
      timedOut: primitive("timedOut"),
    }
    if (error === null || typeof error !== "object") {
      const bounded = text(String(error), limit)
      result.message = bounded.text
      omittedUtf8Bytes += bounded.omittedUtf8Bytes
    }
    return { ...result, omittedUtf8Bytes }
  }
  const errorFields = (error: unknown, limit = 1_024) => {
    const cause = read(error, "cause")
    return {
      ...fields(error, limit),
      cause: cause == null ? null : fields(cause, limit),
      omittedCauses:
        Number(read(error, "omittedCauses")) || (read(cause, "cause") == null ? 0 : 1),
    }
  }
  type Failure = { phase: string; error: ReturnType<typeof errorFields> }
  type Stage =
    | "before-execute"
    | "after-execute"
    | "execute-threw"
    | "spawn"
    | "error"
    | "exit"
    | "close"
    | "stdin-end-called"
    | "stdin-end-callback"
    | "stdin-finish"
    | "stdin-error"
    | "stdout-first-data"
    | "stderr-first-data"
    | "promise-fulfilled"
    | "promise-rejected"
    | "parse-success"
    | "parse-failed"
  interface Invocation {
    sequence: number
    action: string
    beforeExecuteMs: number
    afterExecuteMs: number | null
    pid: number | null
    events: { stage: Stage; atMs: number }[]
    observedEvents: Partial<Record<Stage, number>>
    droppedEvents: number
    failure: Failure | null
    spawnError: ReturnType<typeof errorFields> | null
    stdinError: ReturnType<typeof errorFields> | null
    stdout: { bytes: number; text: string; omittedUtf8Bytes: number }
    stderr: { bytes: number; text: string; omittedUtf8Bytes: number }
  }
  const invocations: Invocation[] = []
  const helpers = new Map<Invocation, ChildProcess>()
  let omittedInvocations = 0
  let firstFixtureFailure: {
    atMs: number
    error: ReturnType<typeof errorFields>
  } | null = null
  const cleanup: {
    outcome: string
    startedMs: number | null
    finishedMs: number | null
    error: ReturnType<typeof errorFields> | null
  } = { outcome: "not-started", startedMs: null, finishedMs: null, error: null }
  const relay: {
    afterSpawnMs: number | null
    spawnMs: number | null
    error: { atMs: number; error: ReturnType<typeof errorFields> } | null
    exit: { atMs: number; code: number | null; signal: string | null } | null
    closeMs: number | null
  } = { afterSpawnMs: null, spawnMs: null, error: null, exit: null, closeMs: null }
  const state = (child: ChildProcess | undefined) => ({
    pid: child?.pid ?? null,
    exitCode: child?.exitCode ?? null,
    signalCode: child?.signalCode ?? null,
    killed: child?.killed ?? null,
  })
  const note = (record: Invocation | undefined, stage: Stage) =>
    passive(() => {
      if (!record) return
      const atMs = now()
      record.observedEvents[stage] ??= atMs
      if (record.events.length < 24) record.events.push({ stage, atMs })
      else record.droppedEvents++
    })
  return {
    begin(action: string) {
      let record: Invocation | undefined
      passive(() => {
        if (invocations.length === 2) {
          omittedInvocations++
          return
        }
        record = {
          sequence: invocations.length + 1,
          action: text(action).text,
          beforeExecuteMs: now(),
          afterExecuteMs: null,
          pid: null,
          events: [],
          observedEvents: {},
          droppedEvents: 0,
          failure: null,
          spawnError: null,
          stdinError: null,
          stdout: { bytes: 0, text: "", omittedUtf8Bytes: 0 },
          stderr: { bytes: 0, text: "", omittedUtf8Bytes: 0 },
        }
        invocations.push(record)
        note(record, "before-execute")
      })
      return record
    },
    note,
    returned(record: Invocation | undefined, helper: ChildProcess) {
      passive(() => {
        if (!record) return
        record.afterExecuteMs = now()
        record.pid = helper.pid ?? null
        helpers.set(record, helper)
        note(record, "after-execute")
        helper.once("spawn", () => note(record, "spawn"))
        helper.once("error", (error) => {
          note(record, "error")
          passive(() => (record.spawnError = errorFields(error)))
        })
        helper.once("exit", () => note(record, "exit"))
        helper.once("close", () => note(record, "close"))
        for (const stream of ["stdout", "stderr"] as const) {
          helper[stream]?.on("data", (chunk: string) =>
            passive(() => {
              if (record[stream].bytes === 0) note(record, `${stream}-first-data`)
              record[stream].bytes += Buffer.byteLength(chunk)
            }),
          )
        }
        helper.stdin?.once("finish", () => note(record, "stdin-finish"))
        helper.stdin?.on("error", (error) => {
          note(record, "stdin-error")
          passive(() => (record.stdinError ??= errorFields(error)))
        })
      })
    },
    stdinCallback(record: Invocation | undefined, error?: Error | null) {
      note(record, "stdin-end-callback")
      passive(() => {
        if (record && error) record.stdinError ??= errorFields(error)
      })
    },
    fulfilled(record: Invocation | undefined, stdout: string, stderr: string) {
      note(record, "promise-fulfilled")
      passive(() => {
        if (!record) return
        // The diagnostic control reads only token/terminate output, never clipboard data.
        if (record.action !== "token" && record.action !== "terminate") return
        Object.assign(record.stdout, text(stdout))
        Object.assign(record.stderr, text(stderr))
      })
    },
    parsed: (record: Invocation | undefined) => note(record, "parse-success"),
    failed(record: Invocation | undefined, phase: string, error: unknown) {
      note(
        record,
        phase === "parse"
          ? "parse-failed"
          : phase === "execute-call"
            ? "execute-threw"
            : "promise-rejected",
      )
      passive(() => {
        if (!record) return
        record.failure ??= { phase, error: errorFields(error) }
        if (phase !== "execution") return
        for (const stream of ["stdout", "stderr"] as const) {
          const value = read(error, stream)
          if (
            typeof value === "string" &&
            (record.action === "token" || record.action === "terminate")
          )
            Object.assign(record[stream], text(value))
        }
      })
    },
    watchRelay(child: ChildProcess) {
      passive(() => {
        relay.afterSpawnMs = now()
        child.once("spawn", () => passive(() => (relay.spawnMs = now())))
        child.once("error", (error) =>
          passive(() => (relay.error = { atMs: now(), error: errorFields(error) })),
        )
        child.once("exit", (code, signal) =>
          passive(() => (relay.exit = { atMs: now(), code, signal })),
        )
        child.once("close", () => passive(() => (relay.closeMs = now())))
      })
    },
    fixtureFailed(error: unknown) {
      passive(() => (firstFixtureFailure ??= { atMs: now(), error: errorFields(error) }))
    },
    cleanupStarted() {
      passive(() => {
        cleanup.startedMs = now()
        cleanup.outcome = "pending"
      })
    },
    cleanupFinished(succeeded: boolean, error?: unknown) {
      passive(() => {
        cleanup.finishedMs = now()
        cleanup.outcome = succeeded ? "succeeded" : "failed"
        if (!succeeded) cleanup.error = errorFields(error)
      })
    },
    serialize(identity: Record<string, string | number>, child: ChildProcess) {
      const metadata = {
        schemaVersion: 1,
        acceptance: false,
        identity,
        helper: {
          selectedExecutable: text(helperHost.selected).text,
          executable: text(helperHost.executable).text,
          executableSha256: helperHost.sha256,
          arguments: [
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-EncodedCommand",
            "<encoded-command-omitted>",
          ],
          options: { timeout: 15_000, windowsHide: true },
        },
        clock: "monotonic milliseconds since observer creation",
        streamBytes: "bytes of existing execFile UTF-8 decoding, not raw pipe bytes",
        limits: {
          invocations: 2,
          events: 24,
          textUtf8Bytes: 1_024,
          serializedBytes: 32_768,
        },
      }
      const records = invocations.map((record) => ({
        ...record,
        helperState: state(helpers.get(record)),
      }))
      const receipt = {
        ...metadata,
        serializedAtMs: now(),
        observationFailures,
        observationFailure: (observationFailures
          ? { kind: "collector-error", attemptedBytes: null }
          : null) as { kind: string; attemptedBytes: number | null } | null,
        omittedInvocations,
        firstFixtureFailure,
        cleanup,
        relay: { ...relay, pid: child.pid ?? null, state: state(child) },
        invocations: records,
      }
      try {
        const body = Buffer.from(JSON.stringify(receipt))
        if (body.length <= 32_768) return body
        receipt.observationFailure = {
          kind: "serialized-overflow",
          attemptedBytes: body.length,
        }
      } catch {
        receipt.observationFailure = { kind: "serialization-error", attemptedBytes: null }
      }
      // Keep typed first causes if escaped JSON or serialization exceeds the detail budget.
      return Buffer.from(
        JSON.stringify({
          ...metadata,
          observationFailures,
          observationFailure: receipt.observationFailure,
          omittedInvocations,
          omittedInvocationDetails: records.length,
          firstFixtureFailure: firstFixtureFailure && {
            atMs: firstFixtureFailure.atMs,
            error: errorFields(firstFixtureFailure.error, 64),
          },
          cleanup: {
            ...cleanup,
            error: cleanup.error && errorFields(cleanup.error, 64),
          },
          relay: {
            ...receipt.relay,
            error: relay.error && {
              atMs: relay.error.atMs,
              error: errorFields(relay.error.error, 64),
            },
          },
          invocations: records.map((record) => ({
            sequence: record.sequence,
            action: text(record.action, 64).text,
            beforeExecuteMs: record.beforeExecuteMs,
            afterExecuteMs: record.afterExecuteMs,
            observedEvents: record.observedEvents,
            helperState: record.helperState,
            failure: record.failure && {
              phase: record.failure.phase,
              error: errorFields(record.failure.error, 64),
            },
            omittedEvents: record.events.length + record.droppedEvents,
            omittedStdoutBytes: record.stdout.bytes,
            omittedStderrBytes: record.stderr.bytes,
          })),
        }),
      )
    },
  }
}

interface ProcessIdentity {
  processId: number
  startedAt: number
  executable: string
  integrity: { rid: number; elevated: boolean }
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
  integrity: ProcessIdentity["integrity"]
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
    const selectedPwsh = process.env.NATIVE_RELAY_PWSH
    if (
      !selectedPwsh ||
      !/^[a-z]:[\\/]/i.test(selectedPwsh) ||
      win32.basename(selectedPwsh).toLowerCase() !== "pwsh.exe"
    )
      throw new Error(
        "NATIVE_RELAY_SETUP: NATIVE_RELAY_PWSH must select an absolute existing pwsh.exe",
      )
    const helperExecutable = await existingExecutable(selectedPwsh)
    if (
      !/^[a-z]:[\\/]/i.test(helperExecutable) ||
      win32.basename(helperExecutable).toLowerCase() !== "pwsh.exe"
    )
      throw new Error("NATIVE_RELAY_SETUP: selected helper must resolve to pwsh.exe")
    const helperExecutableSha256 = digest(await readFile(helperExecutable))
    const launcherTool = JSON.parse(
      await readFile(".tmp/native-relay-evidence/launcher/tool.json", "utf8"),
    ) as { source?: unknown; pwsh?: unknown; pwsh_sha256?: unknown }
    if (
      launcherTool.source !== sourceHead ||
      typeof launcherTool.pwsh !== "string" ||
      !/^[a-z]:[\\/]/i.test(launcherTool.pwsh) ||
      win32.basename(launcherTool.pwsh).toLowerCase() !== "pwsh.exe" ||
      (await existingExecutable(launcherTool.pwsh)).toLowerCase() !==
        helperExecutable.toLowerCase() ||
      launcherTool.pwsh_sha256 !== helperExecutableSha256
    )
      throw new Error(
        "NATIVE_RELAY_SETUP: selected helper must match launcher/tool.json source, resolved path and SHA256",
      )
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
    const redact = (value: string) => redactEvidence(value, storage, executable)
    const helperObservation = createHelperObservation(
      redact,
      [
        storage,
        executable,
        process.cwd(),
        process.env.USERPROFILE ?? "",
        process.env.HOME ?? "",
      ],
      {
        selected: selectedPwsh,
        executable: helperExecutable,
        sha256: helperExecutableSha256,
      },
    )
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
    helperObservation.watchRelay(child)
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
    let processIdentity: ProcessIdentity | undefined
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
    const windows = async <T>(
      action: string,
      extra: Record<string, unknown> = {},
    ): Promise<T> => {
      const invocation = helperObservation.begin(action)
      let pending: Promise<{ stdout: string; stderr: string }> & { child: ChildProcess }
      try {
        pending = execute(
          helperExecutable,
          ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodedScript],
          { timeout: 15_000, windowsHide: true },
        )
      } catch (error) {
        helperObservation.failed(invocation, "execute-call", error)
        throw error
      }
      helperObservation.returned(invocation, pending.child)
      pending.child.stdin?.on("error", () => undefined)
      helperObservation.note(invocation, "stdin-end-called")
      pending.child.stdin?.end(
        JSON.stringify({
          action,
          processId: child.pid,
          executable,
          spawnedAfter,
          startedAt: identity?.startedAt ?? processIdentity?.startedAt ?? null,
          windowHandle: identity?.windowHandle ?? null,
          profile,
          port,
          ...extra,
        }),
        (error?: Error | null) => helperObservation.stdinCallback(invocation, error),
      )
      let phase = "execution"
      try {
        const { stdout, stderr } = await pending
        helperObservation.fulfilled(invocation, stdout, stderr)
        phase = "parse"
        const result = JSON.parse(stdout.replace(/^\uFEFF/, "").trim()) as T
        helperObservation.parsed(invocation)
        return result
      } catch (error) {
        helperObservation.failed(invocation, phase, error)
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
      processIdentity = await windows<ProcessIdentity>("token")
      if (
        processIdentity?.processId !== child.pid ||
        !Number.isSafeInteger(processIdentity.startedAt) ||
        processIdentity.startedAt < spawnedAfter ||
        processIdentity.executable?.toLowerCase() !== executable.toLowerCase() ||
        !Number.isSafeInteger(processIdentity.integrity?.rid) ||
        typeof processIdentity.integrity?.elevated !== "boolean"
      )
        throw new Error("NATIVE_RELAY_SETUP: invalid owned token observation")
      if (processIdentity.integrity.rid !== 8192 || processIdentity.integrity.elevated)
        throw new Error(
          "NATIVE_RELAY_INTEGRITY: expected rid=8192 elevated=false; measured rid=" +
            processIdentity.integrity.rid +
            " elevated=" +
            processIdentity.integrity.elevated,
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
            noDefaults: true,
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
        integrity: processIdentity.integrity,
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
    } catch (error) {
      helperObservation.fixtureFailed(error)
      throw error
    } finally {
      helperObservation.cleanupStarted()
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
        cleanup = {
          ownedTreeExited: true,
          requestedStorageRemoved: true,
          profileRemoved: identity?.cdpOwned === true,
        }
        helperObservation.cleanupFinished(true)
      } catch (error) {
        helperObservation.cleanupFinished(false, error)
        cleanup = { error: redact(String(error)) }
        cleanupFailure = error
      } finally {
        try {
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
                    process: processIdentity && {
                      ...processIdentity,
                      executable: redact(processIdentity.executable),
                    },
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
        } finally {
          try {
            await testInfo.attach("native-helper-observation.json", {
              body: helperObservation.serialize(
                {
                  sourceHead,
                  expectedBuildSha: input.buildSha,
                  exeSha256,
                  aubeLockSha256: locks.aube,
                  cargoLockSha256: locks.cargo,
                  helperSha256: digest(Buffer.from(script)),
                  helperUtf8Bytes: Buffer.byteLength(script),
                  encodedChars: encodedScript.length,
                },
                child,
              ),
              contentType: "application/json",
            })
          } catch {
            console.error(
              "NATIVE_HELPER_OBSERVATION: attachment failed; acceptance=false",
            )
          }
        }
      }
    }
    if (cleanupFailure) throw cleanupFailure
  },
  page: async ({ native }, provide) => provide(native.page),
  context: async ({ native }, provide) => provide(native.context),
})

export { expect }
