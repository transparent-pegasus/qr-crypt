import type { ChildProcess } from "node:child_process"
import { performance } from "node:perf_hooks"
import { setImmediate as nextTurn } from "node:timers/promises"

export type ReadyExpected = { nonce: string; parent: string; elapsedCapMs: number }
const noncePattern = /^[0-9a-f]{32}$/
// eslint-disable-next-line no-control-regex -- Reject raw controls at the receipt/evidence boundary.
const controlPattern = /[\u0000-\u001f\u007f-\u009f]/u
const payloadSha256 = "a3a596f7874dc6f3b8f4fa9bc6bb1a3f432cabf218f141bcea59ed590baff67f"

export function plainOwnedPath(value: string): boolean {
  return (
    /^[A-Za-z]:\\/.test(value) &&
    Buffer.byteLength(value) <= 1024 &&
    value
      .slice(3)
      .split("\\")
      .every((part) => {
        const stem = part.split(".")[0]!
        return (
          part.length > 0 &&
          !/[. ]$/.test(part) &&
          !controlPattern.test(part) &&
          !/[/:"<>|?*~]/.test(part) &&
          !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(stem)
        )
      })
  )
}

export function parseReadyReceipt(
  stdout: Buffer,
  stderr: Buffer,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  expected: ReadyExpected & { pid: number },
): string {
  if (
    !noncePattern.test(expected.nonce) ||
    !Number.isSafeInteger(expected.pid) ||
    expected.pid < 1 ||
    expected.pid > 0xffffffff ||
    !Number.isFinite(expected.elapsedCapMs) ||
    expected.elapsedCapMs <= 0 ||
    expected.elapsedCapMs > 45000 ||
    !plainOwnedPath(expected.parent) ||
    exitCode !== 0 ||
    signal !== null ||
    stderr.length !== 0 ||
    stdout.length > 8192 ||
    [...stdout].some((byte) => byte > 127)
  )
    throw new Error("Preparation identity, status or output boundary failed")
  const match =
    /^NDL0_READY\t1\t([0-9a-f]{32})\t([1-9][0-9]*)\t([0-9a-f]+)\t(0|[1-9][0-9]*)\n$/.exec(
      stdout.toString("ascii"),
    )
  if (
    !match ||
    match[0].length !== stdout.length ||
    match[1] !== expected.nonce ||
    Number(match[2]) !== expected.pid ||
    !Number.isSafeInteger(Number(match[4])) ||
    Number(match[4]) > expected.elapsedCapMs ||
    match[3]!.length % 2 !== 0 ||
    match[3]!.length > 2048
  )
    throw new Error("Preparation receipt framing, PID, nonce or elapsed mismatch")
  const root = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Buffer.from(match[3]!, "hex"),
  )
  const suffix = root.slice(expected.parent.length)
  if (
    !plainOwnedPath(root) ||
    !root.startsWith(expected.parent) ||
    !/^\\qr-crypt-dl0-[0-9a-f]{32}$/.test(suffix)
  )
    throw new Error("Preparation root is not one exact owned child")
  return root
}

export async function withPreparedRoot<T>(
  expected: ReadyExpected,
  prepareDeadlineMs: number,
  io: {
    start(): ChildProcess
    validate(root: string): Promise<void>
    candidate(root: string): Promise<T>
    drain(): Promise<void>
    remove(root: string | undefined): Promise<void>
  },
): Promise<{ value: T | undefined; primary: unknown | null; cleanup: unknown | null }> {
  let root: string | undefined
  let value: T | undefined
  let primary: unknown | null = null
  let cleanup: unknown | null = null
  try {
    if (!Number.isFinite(prepareDeadlineMs) || prepareDeadlineMs <= performance.now())
      throw new Error("Preparation deadline expired before launch")
    const child = io.start()
    const buffers = await new Promise<{
      stdout: Buffer
      stderr: Buffer
      code: number | null
      signal: NodeJS.Signals | null
    }>((done, fail) => {
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let bytes = 0
      let outEnded = false
      let errEnded = false
      let exited = false
      let code: number | null = null
      let signal: NodeJS.Signals | null = null
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) fail(error)
        else
          done({
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
            code,
            signal,
          })
      }
      const timer = setTimeout(
        () => finish(new Error("Preparation final exit/EOF deadline expired")),
        Math.max(1, prepareDeadlineMs - performance.now()),
      )
      const append = (target: Buffer[], chunk: Buffer) => {
        if (settled) return
        bytes += chunk.length
        if (bytes > 32768) {
          finish(new Error("Preparation output overflow"))
          return
        }
        target.push(Buffer.from(chunk))
      }
      child.on("error", finish)
      if (!child.stdout || !child.stderr || child.pid === undefined) {
        // A failed spawn emits its actual error asynchronously.
        if (child.pid !== undefined) finish(new Error("Preparation capture pipes absent"))
        return
      }
      child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk))
      child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk))
      child.stdout.on("error", finish)
      child.stderr.on("error", finish)
      child.stdout.on("end", () => {
        outEnded = true
      })
      child.stderr.on("end", () => {
        errEnded = true
      })
      child.once("exit", (exitCode, exitSignal) => {
        exited = true
        code = exitCode
        signal = exitSignal
      })
      child.once("close", () => {
        if (!exited || !outEnded || !errEnded)
          finish(new Error("Preparation did not finish with normal pipe EOF"))
        else if (performance.now() >= prepareDeadlineMs)
          finish(new Error("Preparation finalization exceeded deadline"))
        else finish()
      })
    })
    await nextTurn()
    if (performance.now() >= prepareDeadlineMs)
      throw new Error("Preparation deadline expired at transfer")
    root = parseReadyReceipt(
      buffers.stdout,
      buffers.stderr,
      buffers.code,
      buffers.signal,
      { ...expected, pid: child.pid! },
    )
    await io.validate(root)
    await io.candidate(root).then((result) => {
      value = result
    })
  } catch (error) {
    primary = error
  }
  try {
    await io.drain()
    await io.remove(root)
  } catch (error) {
    cleanup = error
  }
  return { value, primary, cleanup }
}

export function remainingMs(
  startedAtMs: number,
  nowMs: number,
  capMs: number,
  phase: "work" | "cleanup",
  prepareStartedAtMs: number | null,
): number {
  if (
    ![startedAtMs, nowMs, capMs].every(Number.isFinite) ||
    startedAtMs < 0 ||
    nowMs < startedAtMs ||
    capMs <= 0 ||
    !["work", "cleanup"].includes(phase) ||
    (prepareStartedAtMs !== null &&
      (!Number.isFinite(prepareStartedAtMs) ||
        prepareStartedAtMs < startedAtMs ||
        prepareStartedAtMs > nowMs))
  )
    throw new Error("Invalid monotonic budget")
  let end = startedAtMs + (phase === "work" ? 80000 : 90000)
  if (prepareStartedAtMs !== null)
    end = Math.min(end, startedAtMs + 80000, prepareStartedAtMs + 45000)
  const left = Math.min(capMs, end - nowMs)
  if (left <= 0) throw new Error("Common observation deadline expired")
  return left
}

export type DownloadEvent =
  | {
      method: "Browser.downloadWillBegin"
      atMs: number
      guid: string
      url: string
      frameId: string
      suggestedFilename: string
    }
  | {
      method: "Browser.downloadProgress"
      atMs: number
      guid: string
      state: "inProgress" | "completed" | "canceled"
      receivedBytes: number
      totalBytes: number
    }
export type InventoryFile = {
  contained: boolean
  regular: boolean
  bytes: number
  sha256: string | null
}
export type DownloadObservation = {
  variant: "original" | "mutant"
  blobUrl: string
  clickedAtMs: number
  observedAtMs: number
  events: DownloadEvent[]
  files: InventoryFile[]
  droppedEvents: number
  evidenceError: unknown | null
  inventoryError: unknown | null
}

export function classifyDownload(
  o: DownloadObservation,
): "denied" | "saved" | "unresolved" | "failed" {
  if (
    !["original", "mutant"].includes(o.variant) ||
    ![o.clickedAtMs, o.observedAtMs].every(Number.isFinite) ||
    o.clickedAtMs < 0 ||
    o.observedAtMs - o.clickedAtMs < 1000 ||
    o.droppedEvents !== 0 ||
    o.evidenceError !== null ||
    o.inventoryError !== null ||
    o.events.length > 64 ||
    Buffer.byteLength(JSON.stringify(o.events)) > 32768
  )
    return "failed"
  const states = new Map<
    string,
    { start: number; last: number; terminal: string | null }
  >()
  let lastTime = o.clickedAtMs
  for (const event of o.events) {
    if (
      !Number.isFinite(event.atMs) ||
      event.atMs < lastTime ||
      event.atMs > o.observedAtMs ||
      Object.values(event).some(
        (field) =>
          typeof field === "string" &&
          (Buffer.byteLength(field) > 1024 || controlPattern.test(field)),
      ) ||
      !event.guid
    )
      return "failed"
    lastTime = event.atMs
    if (event.method === "Browser.downloadWillBegin") {
      if (
        states.has(event.guid) ||
        event.url !== o.blobUrl ||
        !event.frameId ||
        event.suggestedFilename !== "native-relay-inert-download.txt"
      )
        return "failed"
      states.set(event.guid, { start: event.atMs, last: event.atMs, terminal: null })
    } else if (event.method === "Browser.downloadProgress") {
      const state = states.get(event.guid)
      if (
        !state ||
        state.terminal !== null ||
        event.atMs < state.last ||
        !["inProgress", "completed", "canceled"].includes(event.state) ||
        ![event.receivedBytes, event.totalBytes].every(
          (v) => Number.isFinite(v) && v >= 0,
        ) ||
        event.receivedBytes > event.totalBytes
      )
        return "failed"
      state.last = event.atMs
      if (event.state !== "inProgress") state.terminal = event.state
    } else return "failed"
  }
  if (states.size === 0) return o.files.length === 0 ? "unresolved" : "failed"
  if (o.variant === "original")
    return o.files.length === 0 &&
      [...states.values()].every(
        (s) => s.terminal === "canceled" && s.last - s.start <= 5000,
      )
      ? "denied"
      : "failed"
  const file = o.files[0]
  return states.size === 1 &&
    [...states.values()].every((s) => s.terminal === "completed") &&
    o.files.length === 1 &&
    file?.contained === true &&
    file.regular === true &&
    file.bytes === 27 &&
    file.sha256 === payloadSha256
    ? "saved"
    : "failed"
}
