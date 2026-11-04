import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { setImmediate as nextTurn } from "node:timers/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const implementation = new URL("../download-candidate.ts", import.meta.url)
assert.ok(
  existsSync(implementation),
  "MISSING_INTERFACE_RED: download-candidate.ts is absent on unchanged e111/f0; this is not the Windows runtime RED",
)
const { parseReadyReceipt, withPreparedRoot, remainingMs, classifyDownload } =
  await import(implementation.href)
for (const fn of [parseReadyReceipt, withPreparedRoot, remainingMs, classifyDownload])
  assert.equal(typeof fn, "function", "the frozen caller contract must be exported")

const nonce = "0123456789abcdef0123456789abcdef"
const rootNonce = "fedcba9876543210fedcba9876543210"
const parent = "D:\\owned\\download-parent"
const root = parent + "\\qr-crypt-dl0-" + rootNonce
const rootHex = Buffer.from(root).toString("hex")
const expected = { nonce, pid: 4242, parent, elapsedCapMs: 45_000 }

// Fixtures encode records; they do not parse or decide acceptance.
function record(overrides = {}) {
  const fields = {
    tag: "NDL0_READY",
    version: "1",
    nonce,
    pid: "4242",
    hex: rootHex,
    elapsed: "6194",
    ...overrides,
  }
  return Buffer.from(Object.values(fields).join("\t") + "\n")
}
function parse(
  stdout = record(),
  stderr = Buffer.alloc(0),
  exit = 0,
  signal = null,
  want = expected,
) {
  return parseReadyReceipt(stdout, stderr, exit, signal, want)
}
test("receipt accepts one exact successful record and returns the raw root", () => {
  assert.equal(parse(), root)
  assert.equal(parse(record({ elapsed: "0" })), root)
  assert.equal(parse(record({ elapsed: "45000" })), root)
  assert.equal(
    parse(record({ pid: "4294967295" }), Buffer.alloc(0), 0, null, {
      ...expected,
      pid: 4294967295,
    }),
    root,
  )
  const unicodeParent = "D:\\owned\\測定"
  const unicodeRoot = unicodeParent + "\\qr-crypt-dl0-" + rootNonce
  assert.equal(
    parse(
      record({ hex: Buffer.from(unicodeRoot).toString("hex") }),
      Buffer.alloc(0),
      0,
      null,
      { ...expected, parent: unicodeParent },
    ),
    unicodeRoot,
  )
})
test("receipt enforces the decoded UTF8 byte cap inclusively", () => {
  const longParent =
    "D:\\owned-root" + ("\\" + "a".repeat(180)).repeat(4) + "\\" + "b".repeat(240)
  const exact = longParent + "\\qr-crypt-dl0-" + rootNonce
  assert.equal(Buffer.byteLength(exact), 1024)
  assert.equal(
    parse(record({ hex: Buffer.from(exact).toString("hex") }), Buffer.alloc(0), 0, null, {
      ...expected,
      parent: longParent,
    }),
    exact,
  )
  const tooLongParent = longParent + "b"
  assert.throws(() =>
    parse(
      record({
        hex: Buffer.from(tooLongParent + "\\qr-crypt-dl0-" + rootNonce).toString("hex"),
      }),
      Buffer.alloc(0),
      0,
      null,
      { ...expected, parent: tooLongParent },
    ),
  )
})
const invalidFields = [
  ["tag", "NDL0"],
  ["version", "01"],
  ["version", "2"],
  ["nonce", "1123456789abcdef0123456789abcdef"],
  ["nonce", nonce.toUpperCase()],
  ["nonce", nonce.slice(1)],
  ["nonce", "g".repeat(32)],
  ...[
    "0",
    "04242",
    "+4242",
    "-1",
    "4242.0",
    "4.242e3",
    " 4242",
    "4242 ",
    "4294967296",
    "",
  ].map((v) => ["pid", v]),
  ["pid", "4243"],
  ...["-1", "+1", "01", "1.0", "1e3", " 1", "1 ", "45001", "9007199254740993", ""].map(
    (v) => ["elapsed", v],
  ),
  ...[
    "",
    "0",
    "zz",
    rootHex.toUpperCase(),
    "c0af",
    "eda080",
    "f4908080",
    "ff",
    "e282",
    "00",
    "0a",
    "09",
    "7f",
  ].map((v) => ["hex", v]),
]
for (const [field, value] of invalidFields)
  test("receipt rejects invalid " + field + " " + JSON.stringify(value), () =>
    assert.throws(() => parse(record({ [field]: value }))),
  )
const invalidRoots = [
  parent,
  parent + "\\downloads",
  root + "\\profile",
  parent + "-sibling\\qr-crypt-dl0-" + rootNonce,
  parent + "\\qr-crypt-dl0-" + rootNonce.toUpperCase(),
  parent + "\\qr-crypt-dl0-" + rootNonce.slice(1),
  parent + "\\qr-crypt-dl0-" + "g".repeat(32),
  root + "\\",
  root + ".",
  root + " ",
  root + ":stream",
  "owned\\qr-crypt-dl0-" + rootNonce,
  "D:owned\\qr-crypt-dl0-" + rootNonce,
  "\\owned\\qr-crypt-dl0-" + rootNonce,
  "\\\\server\\share\\qr-crypt-dl0-" + rootNonce,
  "\\\\?\\D:\\owned\\download-parent\\qr-crypt-dl0-" + rootNonce,
  "\\\\.\\D:\\owned\\download-parent\\qr-crypt-dl0-" + rootNonce,
  "\\??\\D:\\owned\\download-parent\\qr-crypt-dl0-" + rootNonce,
  root.replace("D:", "d:"),
  root.replace("owned", "OWNED"),
  root.replaceAll("\\", "/"),
  root.replace("\\owned", "/owned"),
  root.replace("\\download-parent", "\\.\\download-parent"),
  root.replace("\\download-parent", "\\alias\\..\\download-parent"),
  root.replace("\\download-parent", "\\download-parent. "),
  root.replace("\\download-parent", "\\DOWNLO~1"),
  root.replace("\\download-parent", "\\CON"),
  root.replace("\\download-parent", "\\nul.txt"),
  root.replace("\\download-parent", "\\LPT1"),
  root.replace("\\owned", "\\\\owned"),
  root.replace("\\owned", "\\own\u0000ed"),
  root.replace("\\owned", "\\own\u0085ed"),
]
for (const value of invalidRoots)
  test("receipt rejects foreign or ambiguous root " + JSON.stringify(value), () =>
    assert.throws(() => parse(record({ hex: Buffer.from(value).toString("hex") }))),
  )
for (const badParent of [
  "D:\\owned\\CON",
  "D:\\owned\\nul.txt",
  "D:\\owned\\LPT1",
  "D:\\owned\\alias.",
  "D:\\owned\\DOWNLO~1",
  "D:\\owned\\.",
  "D:\\owned\\..",
  "D:\\owned\\",
  "\\\\server\\share",
  "\\\\?\\D:\\owned",
])
  test(
    "receipt rejects ambiguous spelling even when expected parent matches " +
      JSON.stringify(badParent),
    () =>
      assert.throws(() =>
        parse(
          record({
            hex: Buffer.from(badParent + "\\qr-crypt-dl0-" + rootNonce).toString("hex"),
          }),
          Buffer.alloc(0),
          0,
          null,
          { ...expected, parent: badParent },
        ),
      ),
  )
const malformedRecords = [
  ["missing", Buffer.alloc(0)],
  ["duplicate", Buffer.concat([record(), record()])],
  ["extra field", Buffer.from(record().toString().trimEnd() + "\textra\n")],
  ["extra record", Buffer.concat([record(), Buffer.from("extra\n")])],
  ["extra blank", Buffer.concat([record(), Buffer.from("\n")])],
  ["truncated", record().subarray(0, -1)],
  ["trailing bytes", Buffer.concat([record(), Buffer.from("tail")])],
  ["CRLF", Buffer.from(record().toString().replace("\n", "\r\n"))],
  ["BOM", Buffer.concat([Buffer.from([239, 187, 191]), record()])],
  ["raw nonASCII", Buffer.concat([Buffer.from([255]), record()])],
  ["record cap", Buffer.alloc(8193, 65)],
  ["stdout cap", Buffer.alloc(32769, 65)],
]
for (const [name, bytes] of malformedRecords)
  test("receipt rejects " + name, () => assert.throws(() => parse(bytes)))
for (const [exit, signal] of [
  [1, null],
  [-1, null],
  [null, null],
  [null, "SIGTERM"],
  [0, "SIGTERM"],
  [undefined, null],
  [0, undefined],
])
  test(
    "receipt rejects unsuccessful or unknown status " +
      String(exit) +
      "/" +
      String(signal),
    () =>
      assert.throws(() =>
        parseReadyReceipt(record(), Buffer.alloc(0), exit, signal, expected),
      ),
  )
for (const bytes of [Buffer.from(" "), Buffer.from([0]), Buffer.alloc(32769, 65)])
  test("receipt rejects any stderr including " + bytes.length + " bytes", () =>
    assert.throws(() => parse(record(), bytes)),
  )
for (const want of [
  { ...expected, nonce: "bad" },
  { ...expected, pid: 0 },
  { ...expected, pid: NaN },
  { ...expected, elapsedCapMs: 0 },
  { ...expected, elapsedCapMs: NaN },
  { ...expected, elapsedCapMs: 45001 },
])
  test("receipt rejects an invalid expected boundary " + JSON.stringify(want), () =>
    assert.throws(() => parse(record(), Buffer.alloc(0), 0, null, want)),
  )

// This real inert child waits for stdin after readiness; it does not emulate Windows jobs.
const childProgram = [
  'const { spawn } = require("node:child_process");',
  "const [mode, nonce, hex] = process.argv.slice(1);",
  'const ready = Buffer.from(["NDL0_READY", "1", mode === "wrongnonce" ? "f".repeat(32) : nonce, String(process.pid + (mode === "wrongpid" ? 1 : 0)), hex, "1"].join("\\t") + "\\n");',
  "setTimeout(() => process.exit(2), 2500).unref();",
  'if (mode === "pre-root-failure" || mode === "set-read-failure") {',
  '  process.stderr.write(mode + "\\n"); process.exitCode = 1;',
  "} else {",
  '  if (mode === "split") { process.stdout.write(ready.subarray(0, 17)); setTimeout(() => process.stdout.write(ready.subarray(17)), 20); }',
  '  else if (mode === "stdout-eof") process.stdout.end(ready);',
  "  else process.stdout.write(ready);",
  '  process.stdin.once("data", () => {',
  '    if (mode === "exit-before-eof") spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { stdio: ["ignore", process.stdout, process.stderr] });',
  '    if (mode === "late-stderr") process.stderr.write("late failure\\n");',
  '    if (mode === "extra") process.stdout.write(ready);',
  '    if (mode === "tail") process.stdout.write("truncated");',
  '    if (mode === "overflow") process.stdout.write(Buffer.alloc(32769, 65));',
  '    if (mode === "stderr-overflow") process.stderr.write(Buffer.alloc(32769, 65));',
  '    if (mode === "signal") process.kill(process.pid, "SIGTERM");',
  '    process.stdin.destroy(); process.exitCode = mode === "exit1" ? 1 : 0;',
  "  });",
  "}",
].join("\n")
function start(mode = "success", hex = rootHex) {
  return spawn(process.execPath, ["-e", childProgram, mode, nonce, hex], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  })
}
async function owned(t, withRoot = true) {
  const dir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "owned-"))
  const ownedRoot = join(dir, "owned-root")
  if (withRoot) {
    await mkdir(ownedRoot)
    await writeFile(join(ownedRoot, "retained.txt"), "owned evidence")
  }
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, ownedRoot }
}
function boundary(child, storage, overrides = {}) {
  const calls = []
  let closed = false
  const close = new Promise((done) =>
    child.once("close", () => {
      closed = true
      done()
    }),
  )
  child.stdin?.on("error", () => {})
  const io = {
    start: () => child,
    validate: async (value) => {
      calls.push(["validate", value])
      assert.equal(value, root)
    },
    candidate: async (value) => {
      calls.push(["candidate", value])
      assert.equal(value, root)
      await writeFile(join(storage.ownedRoot, "candidate.txt"), "candidate complete")
      return "candidate complete"
    },
    drain: async () => {
      calls.push(["drain"])
      if (!closed) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
        await close
      }
    },
    remove: async (value) => {
      calls.push(["remove", value])
      if (value !== undefined) {
        assert.equal(value, root)
        await rm(storage.ownedRoot, { recursive: true })
      }
      await rmdir(storage.dir)
    },
    ...overrides,
  }
  const result = withPreparedRoot(
    { nonce, parent, elapsedCapMs: 2000 },
    performance.now() + 2000,
    io,
  )
  return { calls, result }
}
async function finish(child, result) {
  child.stdin.end("finish\n")
  return await result
}

for (const mode of ["success", "stdout-eof", "split"])
  test(
    "acquisition waits for successful exit and complete streams: " + mode,
    async (t) => {
      const storage = await owned(t)
      const child = start(mode)
      const data = once(child.stdout, "data")
      const { calls, result } = boundary(child, storage)
      let settled = false
      void result.then(() => {
        settled = true
      })
      await data
      await nextTurn()
      assert.equal(settled, false)
      assert.deepEqual(calls, [])
      assert.deepEqual(await finish(child, result), {
        value: "candidate complete",
        primary: null,
        cleanup: null,
      })
      assert.deepEqual(calls, [
        ["validate", root],
        ["candidate", root],
        ["drain"],
        ["remove", root],
      ])
      assert.equal(existsSync(storage.dir), false)
    },
  )
test("parent exit0 with an inherited pipe still open does not transfer ownership", async (t) => {
  const storage = await owned(t)
  const child = start("exit-before-eof")
  const data = once(child.stdout, "data")
  const exited = once(child, "exit")
  const { calls, result } = boundary(child, storage)
  await data
  child.stdin.end("finish\n")
  await exited
  assert.deepEqual(calls, [])
  assert.deepEqual(await result, {
    value: "candidate complete",
    primary: null,
    cleanup: null,
  })
})
for (const mode of [
  "exit1",
  "signal",
  "late-stderr",
  "extra",
  "tail",
  "overflow",
  "stderr-overflow",
  "wrongnonce",
  "wrongpid",
])
  test("readiness finalization failure never runs a candidate: " + mode, async (t) => {
    const storage = await owned(t)
    const child = start(mode)
    const data = once(child.stdout, "data")
    const { calls, result } = boundary(child, storage)
    await data
    const answer = await finish(child, result)
    assert(answer.primary instanceof Error)
    assert.equal(answer.value, undefined)
    assert.equal(answer.cleanup.code, "ENOTEMPTY")
    assert.deepEqual(calls, [["drain"], ["remove", undefined]])
    assert.equal(
      await readFile(join(storage.ownedRoot, "retained.txt"), "utf8"),
      "owned evidence",
    )
  })
test("real stdout stream error prevents transfer and preserves its primary error", async (t) => {
  const storage = await owned(t)
  const child = start()
  const data = once(child.stdout, "data")
  const { calls, result } = boundary(child, storage)
  await data
  const primary = new Error("stdout read failed")
  child.stdout.destroy(primary)
  const answer = await result
  assert.equal(answer.primary, primary)
  assert.equal(answer.cleanup.code, "ENOTEMPTY")
  assert.deepEqual(calls, [["drain"], ["remove", undefined]])
})
for (const mode of ["pre-root-failure", "set-read-failure"])
  test(
    "before-handoff failure removes only the caller's exclusive empty parent: " + mode,
    async (t) => {
      const storage = await owned(t, false)
      const { calls, result } = boundary(start(mode), storage)
      const answer = await result
      assert(answer.primary instanceof Error)
      assert.equal(answer.cleanup, null)
      assert.deepEqual(calls, [["drain"], ["remove", undefined]])
      assert.equal(existsSync(storage.dir), false)
    },
  )
test("spawn failure before root creation still removes the owned empty parent", async (t) => {
  const storage = await owned(t, false)
  const child = spawn(join(storage.dir, "absent-executable"), [], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  const { calls, result } = boundary(child, storage)
  const answer = await result
  assert.equal(answer.primary.code, "ENOENT")
  assert.equal(answer.cleanup, null)
  assert.deepEqual(calls, [["drain"], ["remove", undefined]])
})
test("a foreign receipt path reaches no filesystem callback", async (t) => {
  const storage = await owned(t, false)
  const foreign = "D:\\foreign\\qr-crypt-dl0-" + rootNonce
  const child = start("success", Buffer.from(foreign).toString("hex"))
  const data = once(child.stdout, "data")
  const { calls, result } = boundary(child, storage)
  await data
  const answer = await finish(child, result)
  assert(answer.primary instanceof Error)
  assert.equal(answer.cleanup, null)
  assert.deepEqual(calls, [["drain"], ["remove", undefined]])
})
for (const cleanupFails of [false, true])
  test(
    "synchronous launcher failure preserves primary and empty-parent cleanup (" +
      cleanupFails +
      ")",
    async (t) => {
      const storage = await owned(t, false)
      const primary = new Error("launcher failed before a helper existed")
      const cleanup = new Error("empty-parent removal failed")
      const calls = []
      const answer = await withPreparedRoot(
        { nonce, parent, elapsedCapMs: 2000 },
        performance.now() + 2000,
        {
          start: () => {
            throw primary
          },
          validate: async () => {
            assert.fail("validation before transfer")
          },
          candidate: async () => {
            assert.fail("candidate before transfer")
          },
          drain: async () => {
            calls.push("drain")
          },
          remove: async (value) => {
            assert.equal(value, undefined)
            calls.push("remove")
            if (cleanupFails) throw cleanup
            await rmdir(storage.dir)
          },
        },
      )
      assert.equal(answer.primary, primary)
      assert.equal(answer.cleanup, cleanupFails ? cleanup : null)
      assert.deepEqual(calls, ["drain", "remove"])
      assert.equal(existsSync(storage.dir), cleanupFails)
    },
  )
for (const stage of ["validate", "candidate"])
  for (const cleanupFails of [false, true])
    test(
      stage + " failure preserves primary and independent cleanup (" + cleanupFails + ")",
      async (t) => {
        const storage = await owned(t)
        const primary = new Error(stage + " failed")
        const cleanup = new Error("owned removal failed")
        const child = start()
        const data = once(child.stdout, "data")
        const { calls, result } = boundary(child, storage, {
          [stage]: async () => {
            if (stage === "candidate")
              await writeFile(
                join(storage.ownedRoot, "candidate-setup.txt"),
                "partial setup",
              )
            throw primary
          },
          ...(cleanupFails
            ? {
                remove: async () => {
                  throw cleanup
                },
              }
            : {}),
        })
        await data
        const answer = await finish(child, result)
        assert.equal(answer.primary, primary)
        assert.equal(answer.cleanup, cleanupFails ? cleanup : null)
        assert.equal(answer.value, undefined)
        assert.equal(existsSync(storage.ownedRoot), cleanupFails)
        if (stage === "validate")
          assert.equal(
            calls.some(([name]) => name === "candidate"),
            false,
          )
      },
    )
test("candidate success with failed removal retains a separate cleanup failure", async (t) => {
  const storage = await owned(t)
  const child = start()
  const data = once(child.stdout, "data")
  const cleanup = new Error("cleanup failed")
  const { result } = boundary(child, storage, {
    remove: async () => {
      throw cleanup
    },
  })
  await data
  assert.deepEqual(await finish(child, result), {
    value: "candidate complete",
    primary: null,
    cleanup,
  })
  assert.equal(
    await readFile(join(storage.ownedRoot, "candidate.txt"), "utf8"),
    "candidate complete",
  )
})
for (const mode of ["success", "exit1"])
  test(
    "unproved drainage retains actual owned files after helper exit: " + mode,
    async (t) => {
      const storage = await owned(t)
      const child = start(mode)
      const data = once(child.stdout, "data")
      const cleanup = new Error("Windows job drainage is not established")
      const { calls, result } = boundary(child, storage, {
        drain: async () => {
          throw cleanup
        },
      })
      await data
      const answer = await finish(child, result)
      assert.equal(answer.cleanup, cleanup)
      assert.equal(
        calls.some(([name]) => name === "remove"),
        false,
      )
      assert.equal(
        await readFile(join(storage.ownedRoot, "retained.txt"), "utf8"),
        "owned evidence",
      )
      if (mode === "exit1") assert(answer.primary instanceof Error)
      else assert.equal(answer.primary, null)
    },
  )
test("expired preparation refuses reuse without restarting its deadline", async (t) => {
  const storage = await owned(t)
  const child = start()
  const cleanup = new Error("drainage unknown after timeout")
  const calls = []
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
  })
  const result = withPreparedRoot(
    { nonce, parent, elapsedCapMs: 1 },
    performance.now() + 1,
    {
      start: () => child,
      validate: async () => {
        calls.push("validate")
      },
      candidate: async () => {
        calls.push("candidate")
      },
      drain: async () => {
        calls.push("drain")
        throw cleanup
      },
      remove: async () => {
        calls.push("remove")
      },
    },
  )
  const answer = await result
  assert(answer.primary instanceof Error)
  assert.equal(answer.cleanup, cleanup)
  assert.deepEqual(calls, ["drain"])
  assert.equal(existsSync(storage.ownedRoot), true)
})

// The original start and the prepare start stay fixed, including through cleanup.
const budgets = [
  [0, 0, 100000, "work", null, 80000],
  [0, 0, 100000, "work", 0, 45000],
  [0, 44999, 15000, "cleanup", 0, 1],
  [0, 0, 100000, "cleanup", null, 90000],
  [0, 79999, 15000, "work", null, 1],
  [0, 79999.5, 15000, "work", null, 0.5],
  [0, 80000, 15000, "cleanup", null, 10000],
  [0, 89999, 15000, "cleanup", null, 1],
  [1000, 1100, 15000, "work", null, 15000],
  [0, 20000, 100000, "work", 20000, 45000],
  [0, 40000, 100000, "work", 20000, 25000],
  [0, 64999, 15000, "cleanup", 20000, 1],
  [0, 60000, 100000, "work", 60000, 20000],
  [0, 79999, 15000, "cleanup", 60000, 1],
]
for (const [started, now, cap, phase, prepared, want] of budgets)
  test("shared budget " + JSON.stringify([started, now, cap, phase, prepared]), () =>
    assert.equal(remainingMs(started, now, cap, phase, prepared), want),
  )
for (const args of [
  [0, 45000, 15000, "cleanup", 0],
  [0, 80000, 15000, "work", null],
  [0, 90000, 15000, "cleanup", null],
  [0, 90001, 15000, "cleanup", null],
  [0, 65000, 15000, "cleanup", 20000],
  [0, 80000, 15000, "cleanup", 60000],
  [100, 99, 1, "work", null],
  [0, NaN, 1, "work", null],
  [0, 0, 0, "work", null],
  [0, 0, Infinity, "work", null],
  [0, 10, 1, "work", 11],
  [0, 10, 1, "work", -1],
])
  test("exhausted or invalid budget " + JSON.stringify(args), () =>
    assert.throws(() => remainingMs(...args)),
  )

const blobUrl = "blob:http://tauri.localhost/1d543cc5-870f-494d-aea8-8dc568856b93"
const file = {
  contained: true,
  regular: true,
  bytes: 27,
  sha256: "a3a596f7874dc6f3b8f4fa9bc6bb1a3f432cabf218f141bcea59ed590baff67f",
}
function begin(guid = "guid-1", atMs = 100) {
  return {
    method: "Browser.downloadWillBegin",
    atMs,
    guid,
    url: blobUrl,
    frameId: "frame-1",
    suggestedFilename: "native-relay-inert-download.txt",
  }
}
function progress(state = "canceled", atMs = 200, guid = "guid-1") {
  return {
    method: "Browser.downloadProgress",
    atMs,
    guid,
    state,
    receivedBytes: state === "completed" ? 27 : 0,
    totalBytes: 27,
  }
}
function classify(overrides = {}) {
  return classifyDownload({
    variant: "original",
    blobUrl,
    clickedAtMs: 0,
    observedAtMs: 6000,
    events: [begin(), progress()],
    files: [],
    droppedEvents: 0,
    evidenceError: null,
    inventoryError: null,
    ...overrides,
  })
}
const outcomes = [
  ["matching same-Blob cancellation", {}, "denied"],
  [
    "inclusive five-second cancellation",
    { events: [begin(), progress("canceled", 5100)] },
    "denied",
  ],
  ["inclusive one-second observation", { observedAtMs: 1000 }, "denied"],
  ["late cancellation", { events: [begin(), progress("canceled", 5101)] }, "failed"],
  ["no events remains unresolved", { events: [] }, "unresolved"],
  [
    "no events in mutant remains unresolved",
    { variant: "mutant", events: [] },
    "unresolved",
  ],
  ["less than one second observed", { observedAtMs: 999 }, "failed"],
  ["started nonterminal GUID", { events: [begin(), progress("inProgress")] }, "failed"],
  ["started without progress", { events: [begin()] }, "failed"],
  ["original completed", { events: [begin(), progress("completed")] }, "failed"],
  [
    "unmatched Blob",
    { events: [{ ...begin(), url: blobUrl + "-foreign" }, progress()] },
    "failed",
  ],
  [
    "unmatched GUID",
    { events: [begin(), progress("canceled", 200, "guid-2")] },
    "failed",
  ],
  ["progress without start", { events: [progress()] }, "failed"],
  ["dropped evidence", { droppedEvents: 1 }, "failed"],
  ["invalid loss counter", { droppedEvents: -1 }, "failed"],
  ["collector error", { evidenceError: new Error("collector failed") }, "failed"],
  ["inventory error", { inventoryError: new Error("inventory incomplete") }, "failed"],
  [
    "silent inventory error",
    { events: [], inventoryError: new Error("inventory inaccessible") },
    "failed",
  ],
  [
    "a partial or unexpected file defeats denial",
    { files: [{ contained: true, regular: true, bytes: 0, sha256: null }] },
    "failed",
  ],
  ["a saved exact file defeats denial", { files: [file] }, "failed"],
  [
    "mutant completion plus independently validated contained payload",
    { variant: "mutant", events: [begin(), progress("completed")], files: [file] },
    "saved",
  ],
  [
    "mutant completion alone",
    { variant: "mutant", events: [begin(), progress("completed")] },
    "failed",
  ],
  ["mutant file alone", { variant: "mutant", events: [], files: [file] }, "failed"],
  ["mutant cancellation", { variant: "mutant", files: [file] }, "failed"],
  [
    "mutant wrong size",
    {
      variant: "mutant",
      events: [begin(), progress("completed")],
      files: [{ ...file, bytes: 26 }],
    },
    "failed",
  ],
  [
    "mutant wrong digest",
    {
      variant: "mutant",
      events: [begin(), progress("completed")],
      files: [{ ...file, sha256: "0".repeat(64) }],
    },
    "failed",
  ],
  [
    "mutant uncontained evidence",
    {
      variant: "mutant",
      events: [begin(), progress("completed")],
      files: [{ ...file, contained: false }],
    },
    "failed",
  ],
  [
    "mutant nonregular entry",
    {
      variant: "mutant",
      events: [begin(), progress("completed")],
      files: [{ ...file, regular: false }],
    },
    "failed",
  ],
  [
    "mutant extra file",
    { variant: "mutant", events: [begin(), progress("completed")], files: [file, file] },
    "failed",
  ],
  [
    "mutant evidence failure",
    {
      variant: "mutant",
      events: [begin(), progress("completed")],
      files: [file],
      evidenceError: new Error("lost"),
    },
    "failed",
  ],
  [
    "mutant inventory failure",
    {
      variant: "mutant",
      events: [begin(), progress("completed")],
      files: [file],
      inventoryError: new Error("finally inventory failed"),
    },
    "failed",
  ],
  [
    "event path is not payload proof",
    {
      variant: "mutant",
      events: [begin(), { ...progress("completed"), filePath: "D:\\foreign\\probe.txt" }],
    },
    "failed",
  ],
  [
    "all matching GUIDs must cancel",
    {
      events: [
        begin(),
        begin("guid-2", 110),
        progress(),
        progress("canceled", 220, "guid-2"),
      ],
    },
    "denied",
  ],
  [
    "one completed GUID defeats all canceled GUIDs",
    {
      events: [
        begin(),
        begin("guid-2", 110),
        progress(),
        progress("completed", 220, "guid-2"),
      ],
    },
    "failed",
  ],
  ["duplicate begin", { events: [begin(), begin(), progress()] }, "failed"],
  [
    "contradictory terminal events",
    { events: [begin(), progress(), progress("completed", 300)] },
    "failed",
  ],
  ["event precedes click", { events: [begin("guid-1", -1), progress()] }, "failed"],
  ["terminal precedes start", { events: [begin(), progress("canceled", 99)] }, "failed"],
  [
    "event follows observation end",
    { events: [begin(), progress("canceled", 6001)] },
    "failed",
  ],
  [
    "missing frame identity",
    { events: [{ ...begin(), frameId: "" }, progress()] },
    "failed",
  ],
  [
    "changed suggested filename",
    { events: [{ ...begin(), suggestedFilename: "different.txt" }, progress()] },
    "failed",
  ],
  ["unknown progress state", { events: [begin(), progress("unknown")] }, "failed"],
  [
    "invalid progress bytes",
    { events: [begin(), { ...progress(), receivedBytes: -1 }] },
    "failed",
  ],
  [
    "nonfinite progress",
    { events: [begin(), { ...progress(), totalBytes: NaN }] },
    "failed",
  ],
  [
    "nonfinite event time",
    { events: [begin(), { ...progress(), atMs: Infinity }] },
    "failed",
  ],
  [
    "field byte cap",
    { events: [{ ...begin(), frameId: "測".repeat(342) }, progress()] },
    "failed",
  ],
  [
    "field control",
    { events: [{ ...begin(), frameId: "frame\u0000" }, progress()] },
    "failed",
  ],
  [
    "event cap inclusive",
    {
      events: [
        begin(),
        ...Array.from({ length: 62 }, (_, i) => progress("inProgress", 101 + i)),
        progress("canceled", 200),
      ],
    },
    "denied",
  ],
  [
    "event overflow",
    {
      events: [
        begin(),
        ...Array.from({ length: 63 }, (_, i) => progress("inProgress", 101 + i)),
        progress("canceled", 200),
      ],
    },
    "failed",
  ],
  [
    "bounded output overflow",
    {
      events: [
        ...Array.from({ length: 20 }, (_, i) => ({
          ...begin("g" + i + "g".repeat(800), i + 1),
          frameId: "f".repeat(1024),
        })),
        ...Array.from({ length: 20 }, (_, i) =>
          progress("canceled", 100 + i, "g" + i + "g".repeat(800)),
        ),
      ],
    },
    "failed",
  ],
]
for (const [name, observation, want] of outcomes)
  test("GUID classification: " + name, () => assert.equal(classify(observation), want))
