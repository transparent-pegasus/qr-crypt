import { execFile, spawn, type ChildProcess } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { lstat, readFile, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { promisify } from "node:util"
import {
  remainingMs,
  withPreparedRoot,
  plainOwnedPath,
  type InventoryFile,
} from "./download-candidate"

const execute = promisify(execFile)
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
export interface Inventory {
  files: (InventoryFile & { name: string })[]
  complete: boolean
  no_reparse: boolean
}
export interface DownloadIo {
  startedAt: number
  work(cap: number): number
  run<T>(operation: () => Promise<T>, cap: number, cleanup?: boolean): Promise<T>
  inventory(cleanup?: boolean): Promise<Inventory>
  retainChild(child: ChildProcess, executable: string, spawnedAfter: number): void
  captureMembers(): Promise<void>
  confirmDrained(): Promise<void>
}
type Attach = (name: string, value: unknown) => Promise<void>

export function createOwnedDownloadParent(
  create: () => string,
  retain: (parent: string) => void,
  checkDeadline: () => void,
): void {
  checkDeadline()
  const parent = create()
  retain(parent)
  checkDeadline()
}

export async function prepareAndUse(
  host: string,
  sourceHead: string,
  startedAt: number,
  candidate: (root: string, io: DownloadIo) => Promise<void>,
  attach: Attach,
): Promise<void> {
  const work = (cap: number) =>
    remainingMs(startedAt, performance.now(), cap, "work", null)
  const bounded = async <T>(
    operation: () => Promise<T>,
    cap: number,
    cleanup = false,
  ): Promise<T> => {
    const ms = remainingMs(
      startedAt,
      performance.now(),
      cap,
      cleanup ? "cleanup" : "work",
      null,
    )
    const end = performance.now() + ms
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const value = await Promise.race([
        operation(),
        new Promise<never>((_, fail) => {
          timer = setTimeout(
            () => fail(new Error("Common native observation deadline expired")),
            ms,
          )
        }),
      ])
      if (performance.now() >= end)
        throw new Error("Common native observation deadline expired after IO")
      return value
    } finally {
      clearTimeout(timer)
    }
  }
  const runEvidence = process.env.NATIVE_RELAY_RUN_EVIDENCE
  if (!runEvidence || !isAbsolute(runEvidence) || !plainOwnedPath(resolve(runEvidence)))
    throw new Error("An absolute owned download evidence directory is required")
  const evidenceDirectory = await bounded(() => realpath(runEvidence), 5000)
  if (
    evidenceDirectory !== resolve(runEvidence) ||
    !(await bounded(() => lstat(evidenceDirectory), 5000)).isDirectory()
  )
    throw new Error("Canonical download evidence directory required")
  const evidence = resolve(evidenceDirectory, "prepare")
  const identityPath = resolve(
    ".tmp/native-relay-evidence/download-profile/identity.json",
  )
  const identity = JSON.parse(
    await bounded(() => readFile(identityPath, "utf8"), 5000),
  ) as {
    source: string
    prepared: boolean
    helper_executable: string
    helper_executable_sha256: string
    input_manifest_sha256: string
    original: { cargo_lock_sha256: string; aube_lock_sha256: string }
    powerShell: { executable: string; sha256: string }
  }
  const snapshotBytes = await bounded(
    () => readFile(resolve(".tmp/native-relay-evidence/download-profile/inputs.json")),
    5000,
  )
  const snapshot = JSON.parse(snapshotBytes.toString()) as {
    source: string
    files: { path: string; sha256: string; bytes: number }[]
  }
  const helper = await bounded(() => realpath(identity.helper_executable), 5000)
  if (
    identity.prepared !== true ||
    identity.source !== sourceHead ||
    snapshot.source !== sourceHead ||
    identity.input_manifest_sha256 !== sha(snapshotBytes) ||
    identity.powerShell.executable !== host ||
    sha(await bounded(() => readFile(host), 5000)) !== identity.powerShell.sha256 ||
    sha(await bounded(() => readFile("native/desktop/Cargo.lock"), 5000)) !==
      identity.original.cargo_lock_sha256 ||
    sha(await bounded(() => readFile("aube-lock.yaml"), 5000)) !==
      identity.original.aube_lock_sha256 ||
    helper !==
      resolve("native/desktop/target/release/native-relay-download-profile.exe") ||
    !(await bounded(() => lstat(helper), 5000)).isFile() ||
    sha(await bounded(() => readFile(helper), 5000)) !== identity.helper_executable_sha256
  )
    throw new Error("Source-bound preparation helper identity mismatch")
  const paths = new Set<string>()
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0)
    throw new Error("Preparation input manifest is empty")
  for (const file of snapshot.files) {
    if (
      !/^(?:tests\/e2e-native-relay\/[^\\]+|native\/desktop\/[^\\]+|package\.json|aube-lock\.yaml|mise\.toml)$/.test(
        file.path,
      ) ||
      file.path.split("/").some((part) => part === ".." || part === "." || part === "") ||
      paths.has(file.path) ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      throw new Error("Unexpected source snapshot path")
    paths.add(file.path)
    const bytes = await bounded(() => readFile(resolve(file.path)), 5000)
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
      throw new Error("Preparation source changed: " + file.path)
  }
  const script = await bounded(
    () => readFile(new URL("./download-storage.ps1", import.meta.url), "utf8"),
    5000,
  )
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const temporaryDirectory = await bounded(() => realpath(tmpdir()), 5000)
  const nonce = randomBytes(16).toString("hex")
  const prepareStarted = performance.now()
  const allowance = Math.floor(
    remainingMs(startedAt, prepareStarted, 45000, "work", prepareStarted),
  )
  const prepareDeadline = prepareStarted + allowance
  let allocatedParent: string | undefined
  let parentError: unknown = null
  const allocationDeadline = performance.now() + work(5000)
  try {
    createOwnedDownloadParent(
      () => mkdtempSync(join(temporaryDirectory, "qr-native-download-")),
      (created) => {
        allocatedParent = created
        // Retain ownership even when the later evidence attachment has no budget left.
        try {
          writeFileSync(
            resolve(evidenceDirectory, "native-download-parent.json"),
            JSON.stringify({ source: sourceHead, parent: created, phase: "allocated" }) +
              "\n",
            { flag: "wx" },
          )
        } catch (error) {
          throw new Error("Cannot record owned download parent: " + created, {
            cause: error,
          })
        }
      },
      () => {
        work(1)
        if (performance.now() >= allocationDeadline)
          throw new Error("Owned parent creation exceeded its deadline")
      },
    )
  } catch (error) {
    parentError = error
  }
  if (allocatedParent === undefined) throw parentError
  const parent = allocatedParent
  let transferredRoot: string | undefined
  let prepareChild: ChildProcess | undefined
  let prepareClosed = false
  let prepareExit: { code: number | null; signal: NodeJS.Signals | null } | undefined
  let prepareError: unknown = null
  let receiptBytes = 0
  let outputOverflow = false
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let candidateChild: ChildProcess | undefined
  let candidateClosed = false
  let candidateProcess:
    { pid: number; executable: string; spawnedAfter: number } | undefined
  let candidateStarted = false
  let drainage = false
  let memberFailure: unknown = null
  let members: unknown[] | undefined
  const operations: unknown[] = []
  let removal = { rootRemoved: false, parentRemoved: false }
  const storage = async <T>(
    action: string,
    cleanup = false,
    root = transferredRoot,
  ): Promise<T> => {
    const cap = remainingMs(
      startedAt,
      performance.now(),
      15000,
      cleanup ? "cleanup" : "work",
      candidateStarted ? null : prepareStarted,
    )
    const budget = Math.min(
      cap,
      candidateStarted ? cap : prepareDeadline - performance.now(),
    )
    if (budget <= 0) throw new Error("Preparation storage deadline expired")
    const pending = execute(
      host,
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeout: Math.max(1, Math.floor(budget)), maxBuffer: 32768, windowsHide: true },
    )
    pending.child.stdin?.on("error", () => undefined)
    pending.child.stdin?.end(
      JSON.stringify({
        action,
        parent,
        root: root ?? null,
        budget,
        ...candidateProcess,
        members,
      }),
    )
    try {
      const { stdout, stderr } = await pending
      remainingMs(
        startedAt,
        performance.now(),
        1,
        cleanup ? "cleanup" : "work",
        candidateStarted ? null : prepareStarted,
      )
      if (!candidateStarted && performance.now() >= prepareDeadline)
        throw new Error("Preparation storage deadline expired after IO")
      if (stderr !== "")
        throw new Error("Storage observer wrote stderr: " + stderr.slice(0, 1024))
      const value = JSON.parse(stdout) as T
      operations.push({
        action,
        root: root ?? null,
        value,
        atMs: performance.now() - startedAt,
      })
      return value
    } catch (error) {
      operations.push({
        action,
        error: String(error).slice(0, 1024),
        atMs: performance.now() - startedAt,
      })
      throw error
    }
  }
  const io: DownloadIo = {
    startedAt,
    work,
    run: bounded,
    inventory: (cleanup = false) => storage<Inventory>("inventory", cleanup),
    retainChild: (child, executable, spawnedAfter) => {
      candidateChild = child
      candidateClosed = false
      child.once("close", () => {
        candidateClosed = true
      })
      if (child.pid !== undefined)
        candidateProcess = { pid: child.pid, executable, spawnedAfter }
    },
    captureMembers: async () => {
      try {
        members = (await storage<{ members: unknown[] }>("members", true)).members
      } catch (error) {
        memberFailure = error
      }
    },
    confirmDrained: async () => {
      if (memberFailure !== null) throw memberFailure
      if (candidateChild && !candidateClosed) {
        await bounded(
          () => new Promise<void>((done) => candidateChild!.once("close", () => done())),
          5000,
          true,
        )
      }
      if (
        !candidateClosed ||
        !candidateChild ||
        (candidateChild.exitCode === null && candidateChild.signalCode === null) ||
        !members
      )
        throw new Error("Candidate final exit/EOF or process inventory is unproved")
      const result = await storage<{ drained: boolean }>("drained", true)
      if (result.drained !== true)
        throw new Error("Candidate process drainage is unproved")
      drainage = true
    },
  }
  if (parentError === null) {
    try {
      await storage("parent")
    } catch (error) {
      parentError = error
    }
  }
  const answer = await withPreparedRoot(
    { nonce, parent, elapsedCapMs: allowance },
    prepareDeadline,
    {
      start: () => {
        if (parentError) throw parentError
        if (allowance <= 10000 || prepareDeadline - performance.now() <= 10000)
          throw new Error("Insufficient caller work for bounded preparation and cleanup")
        // Pass only the remaining absolute allowance; process launch cannot restart the caller deadline.
        const childBudget = Math.floor(prepareDeadline - performance.now())
        prepareChild = spawn(helper, ["prepare", evidence, parent, nonce], {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, NDL0_PREPARE_BUDGET_MS: String(childBudget) },
        })
        const capture = (target: Buffer[], chunk: Buffer) => {
          const retain = Math.min(chunk.length, Math.max(0, 32768 - receiptBytes))
          if (retain > 0) target.push(Buffer.from(chunk.subarray(0, retain)))
          receiptBytes = Math.min(32769, receiptBytes + chunk.length)
          if (receiptBytes > 32768) outputOverflow = true
        }
        prepareChild.stdout!.on("data", (chunk: Buffer) => capture(stdout, chunk))
        prepareChild.stderr!.on("data", (chunk: Buffer) => capture(stderr, chunk))
        prepareChild.on("error", (error) => {
          prepareError = error
        })
        prepareChild.once("close", (code, signal) => {
          prepareClosed = true
          prepareExit = { code, signal }
        })
        return prepareChild
      },
      validate: async (root) => {
        transferredRoot = root
        await storage("validate")
        if (performance.now() >= prepareDeadline)
          throw new Error("Preparation validation exceeded absolute deadline")
      },
      candidate: async (root) => {
        candidateStarted = true
        await candidate(root, io)
      },
      drain: async () => {
        if (
          prepareChild &&
          (!prepareClosed ||
            prepareExit?.code !== 0 ||
            prepareExit.signal !== null ||
            prepareError ||
            outputOverflow ||
            !transferredRoot)
        ) {
          if (
            !prepareClosed &&
            prepareChild.exitCode === null &&
            prepareChild.signalCode === null
          )
            prepareChild.kill()
          throw new Error("Preparation jobs/EOF drainage unproved; storage retained")
        }
        if (candidateChild && !drainage)
          throw new Error("Candidate drainage unproved; storage retained")
      },
      // Independently repeat containment validation even if validate or partial setup failed.
      remove: async (root) => {
        removal = await storage("remove", true, root)
        if (
          removal.parentRemoved !== true ||
          removal.rootRemoved !== (root !== undefined)
        )
          throw new Error("Owned storage removal is unproved")
      },
    },
  )
  let evidenceFailure: unknown = null
  try {
    writeFileSync(
      resolve(evidenceDirectory, "native-download-parent-final.json"),
      JSON.stringify({
        source: sourceHead,
        parent,
        transferredRoot,
        candidateStarted,
        drainage,
        rootRemoved: answer.cleanup === null && removal.rootRemoved,
        parentRemoved: answer.cleanup === null && removal.parentRemoved,
        primary:
          parentError === null && answer.primary === null
            ? null
            : String(parentError ?? answer.primary).slice(0, 2048),
        cleanup: answer.cleanup === null ? null : String(answer.cleanup).slice(0, 2048),
      }) + "\n",
      { flag: "wx" },
    )
  } catch (error) {
    evidenceFailure = error
  }
  try {
    await bounded(
      () =>
        attach("native-download-prepare.json", {
          source: sourceHead,
          helper,
          helperSha256: identity.helper_executable_sha256,
          parent,
          nonce,
          startedAt,
          prepareStarted,
          prepareDeadline,
          allowance,
          elapsedMs: performance.now() - startedAt,
          pid: prepareChild?.pid,
          exit: prepareExit,
          closed: prepareClosed,
          error: prepareError === null ? null : String(prepareError).slice(0, 1024),
          stdoutHex: Buffer.concat(stdout).toString("hex"),
          stderrHex: Buffer.concat(stderr).toString("hex"),
          outputOverflow,
          transferredRoot,
          rootRemoved: answer.cleanup === null && removal.rootRemoved,
          parentRemoved: answer.cleanup === null && removal.parentRemoved,
          candidateStarted,
          drainage,
          members,
          operations,
          primary:
            parentError === null && answer.primary === null
              ? null
              : String(parentError ?? answer.primary).slice(0, 2048),
          cleanup: answer.cleanup === null ? null : String(answer.cleanup).slice(0, 2048),
        }),
      5000,
      true,
    )
  } catch (error) {
    evidenceFailure ??= error
  }
  if (parentError !== null) throw parentError
  if (answer.primary !== null) throw answer.primary
  if (answer.cleanup !== null) throw answer.cleanup
  if (evidenceFailure !== null) throw evidenceFailure
}
