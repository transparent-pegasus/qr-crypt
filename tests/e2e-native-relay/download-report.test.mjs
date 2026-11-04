import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"

const moduleUrl = new URL("./download-report.mjs", import.meta.url)
const worktree = fileURLToPath(new URL("../../", import.meta.url))
let validateDownloadReport
before(async () => {
  const checker = await import(moduleUrl.href)
  validateDownloadReport = checker.validateDownloadReport
  assert.equal(typeof validateDownloadReport, "function")
})

const title = "a trusted blob download cannot complete or save a file in owned storage"
const denial =
  'Error: NATIVE_DOWNLOAD_DENIAL: same original denial assertion for every EXE\n\nExpected: "denied"\nReceived: "failed"'
const payloadSha256 = "a3a596f7874dc6f3b8f4fa9bc6bb1a3f432cabf218f141bcea59ed590baff67f"
const parent = "C:\\Temp\\qr-native-download-report-tests"
const root = `${parent}\\qr-crypt-dl0-${"c".repeat(32)}`
const nonce = "b".repeat(32)
const blobUrl = "blob:http://tauri.localhost/11111111-2222-4333-8444-555555555555"
const guid = "66666666-7777-4888-8999-aaaaaaaaaaaa"

function expected(variant = "original") {
  return {
    variant,
    source: "1".repeat(40),
    exeSha256: (variant === "original" ? "2" : "a").repeat(64),
    cargoLockSha256: "3".repeat(64),
    aubeLockSha256: "4".repeat(64),
    helperSha256: "5".repeat(64),
    powerShellSha256: "6".repeat(64),
  }
}

function attachment(name, value) {
  return {
    name,
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(value)).toString("base64"),
  }
}

function observation(variant, phase) {
  const value = {
    phase,
    blobUrl,
    clickedAtMs: 1500,
    observedAtMs: phase === "finally" ? 2800 : 2600,
    events: [
      {
        method: "Browser.downloadWillBegin",
        atMs: 1510,
        guid,
        url: blobUrl,
        frameId: "synthetic-frame",
        suggestedFilename: "native-relay-inert-download.txt",
      },
      {
        method: "Browser.downloadProgress",
        atMs: 1520,
        guid,
        state: "inProgress",
        receivedBytes: 0,
        totalBytes: 27,
      },
      {
        method: "Browser.downloadProgress",
        atMs: 1540,
        guid,
        state: variant === "original" ? "canceled" : "completed",
        receivedBytes: variant === "original" ? 0 : 27,
        totalBytes: 27,
      },
    ],
    droppedEvents: 0,
    evidenceError: null,
    inventoryError: null,
    inventory: {
      complete: true,
      no_reparse: true,
      files:
        variant === "original"
          ? []
          : [
              {
                name: "native-relay-inert-download.txt",
                contained: true,
                regular: true,
                bytes: 27,
                sha256: payloadSha256,
              },
            ],
    },
    originalDenial: variant === "original" ? "denied" : "failed",
    mutantPositive: variant === "original" ? "failed" : "saved",
  }
  assert.ok(value.observedAtMs - value.clickedAtMs >= 1000)
  return value
}

// Shape from Windows attempt 41869381043/job 126711952586 (failed aggregation).
// All identities/storage below are synthetic; the nested leaf deliberately omits suites.
function report(variant = "original") {
  const identity = expected(variant)
  const before = observation(variant, "before-assertion")
  const final = observation(variant, "finally")
  const members = [
    { pid: 200, startedAt: 1700000000000, image: "C:\\build\\qr-crypt-relay.exe" },
  ]
  const candidate = {
    sourceHead: identity.source,
    expectedBuildSha: identity.source,
    version: "0.1.0",
    exeSha256: identity.exeSha256,
    locks: { aube: identity.aubeLockSha256, cargo: identity.cargoLockSha256 },
    powerShell: { executable: "C:\\tools\\pwsh.exe", sha256: identity.powerShellSha256 },
    process: {
      integrity: { rid: 8192, elevated: false },
      executable: "<release-exe>",
      startedAt: members[0].startedAt,
      processId: members[0].pid,
    },
    window: {
      cdpOwned: true,
      processId: members[0].pid,
      startedAt: members[0].startedAt,
      windowHandle: "300",
      title: "QR Crypt Relay",
      windows: { version: "synthetic", caption: "Synthetic Windows", build: "synthetic" },
      webview2: { productVersion: "synthetic", fileVersion: "synthetic" },
    },
    runtime: { browser: "synthetic", userAgent: "synthetic", platform: "Win32" },
    assets: {},
    observations: [],
    requests: [],
    responses: [],
    responseErrors: [],
    pageErrors: [],
    childOutput: "",
    childOutputOverflow: false,
    childExit: { code: 1, signal: null },
    cleanup: {
      ownedTreeExited: true,
      requestedStorageRemoved: false,
      profileRemoved: false,
      storageRemovalDelegated: true,
    },
  }
  const prepare = {
    source: identity.source,
    helper: "C:\\build\\native-relay-download-profile.exe",
    helperSha256: identity.helperSha256,
    parent,
    nonce,
    startedAt: 0,
    prepareStarted: 10,
    prepareDeadline: 45010,
    allowance: 45000,
    elapsedMs: 3000,
    pid: 100,
    exit: { code: 0, signal: null },
    closed: true,
    error: null,
    stdoutHex: Buffer.from(
      `NDL0_READY\t1\t${nonce}\t100\t${Buffer.from(root).toString("hex")}\t1000\n`,
    ).toString("hex"),
    stderrHex: "",
    outputOverflow: false,
    transferredRoot: root,
    rootRemoved: true,
    parentRemoved: true,
    candidateStarted: true,
    drainage: true,
    members,
    operations: [
      { action: "parent", root: null, value: { validated: true }, atMs: 100 },
      { action: "validate", root, value: { validated: true }, atMs: 1100 },
      { action: "inventory", root, value: structuredClone(before.inventory), atMs: 2599 },
      { action: "inventory", root, value: structuredClone(final.inventory), atMs: 2799 },
      {
        action: "members",
        root,
        value: { members: structuredClone(members) },
        atMs: 2850,
      },
      { action: "drained", root, value: { drained: true }, atMs: 2900 },
      {
        action: "remove",
        root,
        value: { rootRemoved: true, parentRemoved: true },
        atMs: 2999,
      },
    ],
    primary: null,
    cleanup: null,
  }
  const result = {
    workerIndex: 0,
    parallelIndex: 0,
    status: variant === "original" ? "passed" : "failed",
    duration: 3000,
    errors: variant === "original" ? [] : [{ message: denial }],
    stdout: [],
    stderr: [],
    retry: 0,
    startTime: "2000-01-01T00:00:00.000Z",
    annotations: [],
    attachments: [
      attachment("native-download-before-assertion.json", before),
      attachment("native-download-finally.json", final),
      attachment("native-download-classifications.json", {
        beforeOriginal: before.originalDenial,
        beforeMutant: before.mutantPositive,
        finalOriginal: final.originalDenial,
        finalMutant: final.mutantPositive,
        primary: variant === "original" ? null : denial,
      }),
      attachment("native-candidate.json", candidate),
      attachment("native-download-prepare.json", prepare),
    ],
  }
  if (variant === "mutant") result.error = { message: denial }
  return {
    suites: [
      {
        title: "policy.spec.ts",
        file: "policy.spec.ts",
        column: 0,
        line: 0,
        specs: [],
        suites: [
          {
            title: "",
            file: "policy.spec.ts",
            line: 165,
            column: 6,
            specs: [
              {
                title,
                ok: variant === "original",
                tags: [],
                tests: [
                  {
                    timeout: 80000,
                    annotations: [],
                    expectedStatus: "passed",
                    projectId: "windows-webview2",
                    projectName: "windows-webview2",
                    results: [result],
                    status: variant === "original" ? "expected" : "unexpected",
                  },
                ],
                id: "synthetic-download-case",
                file: "policy.spec.ts",
                line: 167,
                column: 3,
              },
            ],
          },
        ],
      },
    ],
    errors: [],
    stats: {
      startTime: "2000-01-01T00:00:00.000Z",
      duration: 3100,
      expected: variant === "original" ? 1 : 0,
      skipped: 0,
      unexpected: variant === "original" ? 0 : 1,
      flaky: 0,
    },
  }
}

function target(value) {
  return value.suites[0].suites[0].specs[0]
}

function result(value) {
  return target(value).tests[0].results[0]
}

function editAttachment(value, name, change) {
  const saved = result(value).attachments.find((item) => item.name === name)
  const decoded = JSON.parse(Buffer.from(saved.body, "base64").toString("utf8"))
  change(decoded)
  saved.body = attachment(name, decoded).body
}

function editObservations(value, change) {
  const inventories = []
  for (const name of [
    "native-download-before-assertion.json",
    "native-download-finally.json",
  ]) {
    editAttachment(value, name, (item) => {
      change(item)
      inventories.push(structuredClone(item.inventory))
    })
  }
  editAttachment(value, "native-download-prepare.json", (item) => {
    item.operations
      .filter((operation) => operation.action === "inventory")
      .forEach((op, i) => {
        op.value = inventories[i]
      })
  })
}

function addPassingSpec(value) {
  const sibling = structuredClone(target(value))
  sibling.title = "ordinary passing native case"
  sibling.id = "synthetic-other-case"
  const ordinary = sibling.tests[0].results[0]
  ordinary.status = "passed"
  ordinary.errors = []
  delete ordinary.error
  ordinary.attachments = ordinary.attachments.filter(
    (item) => item.name === "native-candidate.json",
  )
  sibling.tests[0].status = "expected"
  sibling.ok = true
  value.suites[0].specs.push(sibling)
  const candidate = JSON.parse(
    Buffer.from(ordinary.attachments[0].body, "base64").toString("utf8"),
  )
  candidate.cleanup = {
    ownedTreeExited: true,
    requestedStorageRemoved: true,
    profileRemoved: true,
  }
  ordinary.attachments = [attachment("native-candidate.json", candidate)]
  value.stats.expected += 1
  return sibling
}

function rejections(name, cases, variant = "original") {
  describe(name, () => {
    for (const [label, damage] of cases) {
      test(label, () => {
        const value = report(variant)
        damage(value)
        assert.throws(() => validateDownloadReport(value, expected(variant)))
      })
    }
  })
}

test("accepts the nested original with an omitted leaf suites and returns undefined", () => {
  assert.equal(validateDownloadReport(report(), expected()), undefined)
})

test("accepts the isolated mutant failing the original denial assertion", () => {
  assert.equal(validateDownloadReport(report("mutant"), expected("mutant")), undefined)
})

test("accepts other passing specs with ordinary fixture cleanup and matching counts", () => {
  const value = report()
  addPassingSpec(value)
  const sibling = addPassingSpec(value)
  sibling.id = "synthetic-third-case"
  sibling.title = "another ordinary passing case"
  assert.equal(validateDownloadReport(value, expected()), undefined)
})

test("accepts an explicit empty leaf suites and an unrelated diagnostic attachment", () => {
  const value = report()
  value.suites[0].suites[0].suites = []
  result(value).attachments.push({
    name: "diagnostic",
    contentType: "text/plain",
    body: "b2s=",
  })
  assert.equal(validateDownloadReport(value, expected()), undefined)
})

for (const [label, value] of [
  ["null", null],
  ["array", []],
  ["string", "invalid"],
]) {
  test(`rejects a ${label} report`, () => {
    assert.throws(() => validateDownloadReport(value, expected()))
  })
}

rejections("report structure and target selection", [
  [
    "missing root suites",
    (v) => {
      delete v.suites
    },
  ],
  [
    "root suites is null",
    (v) => {
      v.suites = null
    },
  ],
  [
    "root suites is an object",
    (v) => {
      v.suites = {}
    },
  ],
  [
    "nested suites is a string",
    (v) => {
      v.suites[0].suites = "invalid"
    },
  ],
  [
    "present leaf suites is null",
    (v) => {
      v.suites[0].suites[0].suites = null
    },
  ],
  [
    "null suite entry",
    (v) => {
      v.suites.push(null)
    },
  ],
  [
    "missing specs",
    (v) => {
      delete v.suites[0].specs
    },
  ],
  [
    "specs is an object",
    (v) => {
      v.suites[0].specs = {}
    },
  ],
  [
    "null spec entry",
    (v) => {
      v.suites[0].specs.push(null)
    },
  ],
  [
    "missing target",
    (v) => {
      target(v).title = "unrelated case"
    },
  ],
  [
    "near-match title",
    (v) => {
      target(v).title += " suffix"
    },
  ],
  [
    "duplicate target across nested suites",
    (v) => {
      v.suites.push(structuredClone(v.suites[0]))
      v.stats.expected += 1
    },
  ],
  [
    "tests is null",
    (v) => {
      target(v).tests = null
    },
  ],
  [
    "no test in target",
    (v) => {
      target(v).tests = []
    },
  ],
  [
    "null test entry",
    (v) => {
      target(v).tests = [null]
    },
  ],
  [
    "two tests in target",
    (v) => {
      target(v).tests.push(structuredClone(target(v).tests[0]))
      v.stats.expected += 1
    },
  ],
  [
    "results is an object",
    (v) => {
      target(v).tests[0].results = {}
    },
  ],
  [
    "no result",
    (v) => {
      target(v).tests[0].results = []
    },
  ],
  [
    "null result entry",
    (v) => {
      target(v).tests[0].results = [null]
    },
  ],
  [
    "multiple results",
    (v) => {
      target(v).tests[0].results.push(structuredClone(result(v)))
    },
  ],
  [
    "attachments is not an array",
    (v) => {
      result(v).attachments = {}
    },
  ],
  [
    "null attachment",
    (v) => {
      result(v).attachments.push(null)
    },
  ],
  [
    "global errors is malformed",
    (v) => {
      v.errors = {}
    },
  ],
  [
    "global infrastructure error",
    (v) => {
      v.errors.push({ message: "worker failed" })
    },
  ],
  [
    "missing stats",
    (v) => {
      delete v.stats
    },
  ],
  [
    "lying pass count",
    (v) => {
      v.stats.expected = 18
    },
  ],
  [
    "negative pass count",
    (v) => {
      v.stats.expected = -1
    },
  ],
  [
    "string pass count",
    (v) => {
      v.stats.expected = "1"
    },
  ],
  [
    "global skip",
    (v) => {
      v.stats.skipped = 1
    },
  ],
  [
    "global flaky",
    (v) => {
      v.stats.flaky = 1
    },
  ],
  [
    "global unexpected",
    (v) => {
      v.stats.unexpected = 1
    },
  ],
  [
    "target marked not ok",
    (v) => {
      target(v).ok = false
    },
  ],
  [
    "expected-failure annotation",
    (v) => {
      target(v).tests[0].expectedStatus = "failed"
    },
  ],
  [
    "flaky test status",
    (v) => {
      target(v).tests[0].status = "flaky"
    },
  ],
  [
    "retried result",
    (v) => {
      result(v).retry = 1
    },
  ],
  [
    "missing retry",
    (v) => {
      delete result(v).retry
    },
  ],
  ...["skipped", "timedOut", "interrupted", "failed"].map((status) => [
    `original result ${status}`,
    (v) => {
      result(v).status = status
    },
  ]),
  [
    "passing result with an error",
    (v) => {
      result(v).errors.push({ message: denial })
    },
  ],
  [
    "unrelated case failed despite a healthy target",
    (v) => {
      addPassingSpec(v).tests[0].results[0].status = "failed"
    },
  ],
  [
    "unrelated case retried",
    (v) => {
      addPassingSpec(v).tests[0].results[0].retry = 1
    },
  ],
  [
    "unrelated case skipped",
    (v) => {
      addPassingSpec(v).tests[0].status = "skipped"
    },
  ],
])

rejections(
  "mutant is exactly one intended unexpected failure",
  [
    [
      "other passing case",
      (v) => {
        addPassingSpec(v)
      },
    ],
    [
      "wrong failure",
      (v) => {
        result(v).error.message = "CDP connection failed"
        result(v).errors[0].message = "CDP connection failed"
      },
    ],
    [
      "assertion marker only in stack",
      (v) => {
        result(v).error = { message: "infrastructure failure", stack: denial }
        result(v).errors = [structuredClone(result(v).error)]
      },
    ],
    [
      "denial failure mixed with infrastructure error",
      (v) => {
        result(v).errors.push({ message: "cleanup timed out" })
      },
    ],
    [
      "singular error disagrees with errors",
      (v) => {
        result(v).error.message = "other assertion"
      },
    ],
    [
      "no recorded errors",
      (v) => {
        result(v).errors = []
      },
    ],
    [
      "mutant unexpectedly passed",
      (v) => {
        result(v).status = "passed"
      },
    ],
    [
      "mutant marked expected",
      (v) => {
        target(v).tests[0].status = "expected"
      },
    ],
    [
      "mutant marked ok",
      (v) => {
        target(v).ok = true
      },
    ],
    [
      "mutant hidden as expected failure",
      (v) => {
        target(v).tests[0].expectedStatus = "failed"
      },
    ],
    [
      "mutant retry",
      (v) => {
        result(v).retry = 1
      },
    ],
    [
      "mutant missing unexpected count",
      (v) => {
        v.stats.unexpected = 0
      },
    ],
  ],
  "mutant",
)

const attachmentNames = [
  "native-candidate.json",
  "native-download-prepare.json",
  "native-download-before-assertion.json",
  "native-download-finally.json",
  "native-download-classifications.json",
]
rejections(
  "required Buffer JSON attachments",
  attachmentNames.flatMap((name) => [
    [
      `missing ${name}`,
      (v) => {
        result(v).attachments = result(v).attachments.filter((item) => item.name !== name)
      },
    ],
    [
      `duplicate ${name}`,
      (v) => {
        result(v).attachments.push(
          structuredClone(result(v).attachments.find((item) => item.name === name)),
        )
      },
    ],
  ]),
)

rejections("attachment decoding", [
  [
    "path instead of Buffer body",
    (v) => {
      const item = result(v).attachments[0]
      delete item.body
      item.path = "synthetic-observation.json"
    },
  ],
  [
    "serialized Buffer object instead of reporter Base64",
    (v) => {
      result(v).attachments[0].body = { type: "Buffer", data: [123, 125] }
    },
  ],
  [
    "invalid Base64 alphabet around valid JSON",
    (v) => {
      result(v).attachments[0].body += "!"
    },
  ],
  [
    "excess Base64 padding",
    (v) => {
      result(v).attachments[0].body += "===="
    },
  ],
  [
    "empty body",
    (v) => {
      result(v).attachments[0].body = ""
    },
  ],
  [
    "malformed UTF8 within otherwise valid JSON",
    (v) => {
      const json = Buffer.from(result(v).attachments[0].body, "base64")
      result(v).attachments[0].body = Buffer.concat([
        json.subarray(0, -1),
        Buffer.from(',"extra":"'),
        Buffer.from([0xff]),
        Buffer.from('"}'),
      ]).toString("base64")
    },
  ],
  [
    "malformed JSON",
    (v) => {
      result(v).attachments[0].body = Buffer.from("{").toString("base64")
    },
  ],
  [
    "JSON null",
    (v) => {
      result(v).attachments[0].body = attachment("unused", null).body
    },
  ],
  [
    "JSON array",
    (v) => {
      result(v).attachments[0].body = attachment("unused", []).body
    },
  ],
  [
    "wrong content type",
    (v) => {
      result(v).attachments[0].contentType = "text/plain"
    },
  ],
])

describe("independent expected identities", () => {
  for (const variant of ["original", "mutant"]) {
    for (const key of [
      "source",
      "exeSha256",
      "cargoLockSha256",
      "aubeLockSha256",
      "helperSha256",
      "powerShellSha256",
    ]) {
      test(`rejects mismatched externally supplied ${key} for ${variant}`, () => {
        const identity = expected(variant)
        identity[key] = "f".repeat(key === "source" ? 40 : 64)
        assert.throws(() => validateDownloadReport(report(variant), identity))
      })
    }
    test(`does not accept ${variant} evidence under the other variant`, () => {
      const identity = expected(variant)
      identity.variant = variant === "original" ? "mutant" : "original"
      assert.throws(() => validateDownloadReport(report(variant), identity))
    })
  }
  test("rejects an unknown variant", () => {
    assert.throws(() =>
      validateDownloadReport(report(), { ...expected(), variant: "allow" }),
    )
  })
})

const candidateCases = [
  [
    "source HEAD",
    (v) => {
      v.sourceHead = "f".repeat(40)
    },
  ],
  [
    "expected build source",
    (v) => {
      v.expectedBuildSha = "f".repeat(40)
    },
  ],
  [
    "missing selected host",
    (v) => {
      delete v.powerShell
    },
  ],
  [
    "missing host SHA",
    (v) => {
      delete v.powerShell.sha256
    },
  ],
  [
    "High integrity",
    (v) => {
      v.process.integrity.rid = 12288
    },
  ],
  [
    "elevated candidate",
    (v) => {
      v.process.integrity.elevated = true
    },
  ],
  [
    "string elevation",
    (v) => {
      v.process.integrity.elevated = "false"
    },
  ],
  [
    "missing token",
    (v) => {
      delete v.process.integrity
    },
  ],
  [
    "unowned CDP window",
    (v) => {
      v.window.cdpOwned = false
    },
  ],
  [
    "undrained candidate tree",
    (v) => {
      v.cleanup.ownedTreeExited = false
    },
  ],
  [
    "cleanup not delegated",
    (v) => {
      v.cleanup.storageRemovalDelegated = false
    },
  ],
  [
    "missing delegation proof",
    (v) => {
      delete v.cleanup.storageRemovalDelegated
    },
  ],
  [
    "fixture falsely claims profile deletion",
    (v) => {
      v.cleanup.profileRemoved = true
    },
  ],
  [
    "fixture falsely claims storage deletion",
    (v) => {
      v.cleanup.requestedStorageRemoved = true
    },
  ],
  [
    "page error",
    (v) => {
      v.pageErrors.push("synthetic page failure")
    },
  ],
  [
    "response observation error",
    (v) => {
      v.responseErrors.push("synthetic response failure")
    },
  ],
  [
    "child output overflow",
    (v) => {
      v.childOutputOverflow = true
    },
  ],
]
rejections(
  "candidate identity, token and delegated cleanup",
  candidateCases.map(([label, change]) => [
    label,
    (v) => editAttachment(v, "native-candidate.json", change),
  ]),
)

const prepareCases = [
  [
    "source mismatch",
    (v) => {
      v.source = "f".repeat(40)
    },
  ],
  [
    "helper failed",
    (v) => {
      v.exit.code = 1
    },
  ],
  [
    "helper signaled",
    (v) => {
      v.exit.signal = "SIGTERM"
    },
  ],
  [
    "missing helper exit",
    (v) => {
      delete v.exit
    },
  ],
  [
    "no normal pipe EOF",
    (v) => {
      v.closed = false
    },
  ],
  [
    "preparation error",
    (v) => {
      v.error = "synthetic prepare failure"
    },
  ],
  [
    "primary error",
    (v) => {
      v.primary = "synthetic use failure"
    },
  ],
  [
    "cleanup error",
    (v) => {
      v.cleanup = "synthetic cleanup failure"
    },
  ],
  [
    "helper output overflow",
    (v) => {
      v.outputOverflow = true
    },
  ],
  [
    "stderr output",
    (v) => {
      v.stderrHex = Buffer.from("failure").toString("hex")
    },
  ],
  [
    "missing ready receipt",
    (v) => {
      v.stdoutHex = ""
    },
  ],
  [
    "malformed ready receipt",
    (v) => {
      v.stdoutHex = Buffer.from("NDL0_READY\t1\n").toString("hex")
    },
  ],
  [
    "receipt nonce mismatch",
    (v) => {
      v.nonce = "d".repeat(32)
    },
  ],
  [
    "receipt PID mismatch",
    (v) => {
      v.pid += 1
    },
  ],
  [
    "receipt root mismatch",
    (v) => {
      v.transferredRoot = `${parent}\\qr-crypt-dl0-${"d".repeat(32)}`
    },
  ],
  [
    "uncontained parent",
    (v) => {
      v.parent = "C:\\Temp\\another-owned-parent"
    },
  ],
  [
    "candidate never started",
    (v) => {
      v.candidateStarted = false
    },
  ],
  [
    "no candidate drainage",
    (v) => {
      v.drainage = false
    },
  ],
  [
    "root retained",
    (v) => {
      v.rootRemoved = false
    },
  ],
  [
    "parent retained",
    (v) => {
      v.parentRemoved = false
    },
  ],
  [
    "missing final deletion proof",
    (v) => {
      delete v.rootRemoved
    },
  ],
  [
    "inconsistent drainage operation",
    (v) => {
      v.operations[5].value.drained = false
    },
  ],
  [
    "inconsistent removal operation",
    (v) => {
      v.operations[6].value.parentRemoved = false
    },
  ],
]
rejections(
  "preparation finalization and ownership proof",
  prepareCases.map(([label, change]) => [
    label,
    (v) => editAttachment(v, "native-download-prepare.json", change),
  ]),
)

const observationCases = [
  [
    "events is not an array",
    (v) => {
      v.events = {}
    },
  ],
  [
    "null event",
    (v) => {
      v.events.push(null)
    },
  ],
  [
    "silent GUID sequence",
    (v) => {
      v.events = []
    },
  ],
  [
    "begin without terminal",
    (v) => {
      v.events.pop()
    },
  ],
  [
    "terminal without begin",
    (v) => {
      v.events.shift()
    },
  ],
  [
    "terminal belongs to another GUID",
    (v) => {
      v.events[2].guid = "unrelated-guid"
    },
  ],
  [
    "begin belongs to another blob",
    (v) => {
      v.events[0].url += "-other"
    },
  ],
  [
    "events lost",
    (v) => {
      v.droppedEvents = 1
    },
  ],
  [
    "event observation error",
    (v) => {
      v.evidenceError = "CDP disconnected"
    },
  ],
  [
    "inventory error",
    (v) => {
      v.inventoryError = "access denied"
    },
  ],
  [
    "incomplete inventory",
    (v) => {
      v.inventory.complete = false
    },
  ],
  [
    "missing inventory completeness",
    (v) => {
      delete v.inventory.complete
    },
  ],
  [
    "reparse inventory",
    (v) => {
      v.inventory.no_reparse = false
    },
  ],
  [
    "files is not an array",
    (v) => {
      v.inventory.files = {}
    },
  ],
]
for (const variant of ["original", "mutant"]) {
  rejections(
    `${variant} requires real GUID and complete inventory evidence`,
    observationCases.map(([label, change]) => [
      label,
      (v) => editObservations(v, change),
    ]),
    variant,
  )
}

rejections("original denial cannot be a classification string alone", [
  [
    "completed download labeled denied",
    (v) =>
      editObservations(v, (item) => {
        item.events[2].state = "completed"
      }),
  ],
  [
    "owned storage contains a saved file",
    (v) =>
      editObservations(v, (item) => {
        item.inventory.files = observation("mutant", item.phase).inventory.files
      }),
  ],
  [
    "wrong before original classification",
    (v) =>
      editAttachment(v, "native-download-classifications.json", (item) => {
        item.beforeOriginal = "unknown"
      }),
  ],
  [
    "wrong final original classification",
    (v) =>
      editAttachment(v, "native-download-classifications.json", (item) => {
        item.finalOriginal = "failed"
      }),
  ],
  [
    "wrong final mutant classification",
    (v) =>
      editAttachment(v, "native-download-classifications.json", (item) => {
        item.finalMutant = "saved"
      }),
  ],
  [
    "original primary failure",
    (v) =>
      editAttachment(v, "native-download-classifications.json", (item) => {
        item.primary = denial
      }),
  ],
  [
    "snapshot classification disagrees",
    (v) =>
      editObservations(v, (item) => {
        item.originalDenial = "failed"
      }),
  ],
])

rejections(
  "mutant needs real completion and the exact contained 27-byte payload",
  [
    [
      "canceled GUID with a file",
      (v) =>
        editObservations(v, (item) => {
          item.events[2].state = "canceled"
        }),
    ],
    [
      "inProgress GUID with a file",
      (v) =>
        editObservations(v, (item) => {
          item.events[2].state = "inProgress"
        }),
    ],
    [
      "completed GUID without saved payload",
      (v) =>
        editObservations(v, (item) => {
          item.inventory.files = []
        }),
    ],
    ...[
      ["wrong payload hash", "sha256", "f".repeat(64)],
      ["wrong payload length", "bytes", 28],
      ["payload outside root", "contained", false],
      ["payload is not a regular file", "regular", false],
    ].map(([label, key, value]) => [
      label,
      (v) =>
        editObservations(v, (item) => {
          item.inventory.files[0][key] = value
        }),
    ]),
    [
      "wrong before mutant classification",
      (v) =>
        editAttachment(v, "native-download-classifications.json", (item) => {
          item.beforeMutant = "failed"
        }),
    ],
    [
      "wrong final mutant classification",
      (v) =>
        editAttachment(v, "native-download-classifications.json", (item) => {
          item.finalMutant = "failed"
        }),
    ],
    [
      "mutant primary is an infrastructure error",
      (v) =>
        editAttachment(v, "native-download-classifications.json", (item) => {
          item.primary = "CDP connection failed"
        }),
    ],
    [
      "snapshot classification disagrees",
      (v) =>
        editObservations(v, (item) => {
          item.mutantPositive = "failed"
        }),
    ],
  ],
  "mutant",
)

rejections("before and final must agree with the retained observations", [
  [
    "final loses events",
    (v) =>
      editAttachment(v, "native-download-finally.json", (item) => {
        item.events = []
      }),
  ],
  [
    "final silently switches GUID",
    (v) =>
      editAttachment(v, "native-download-finally.json", (item) => {
        item.events.forEach((event) => {
          event.guid = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
        })
      }),
  ],
  [
    "final silently switches blob",
    (v) =>
      editAttachment(v, "native-download-finally.json", (item) => {
        item.blobUrl += "-other"
        item.events[0].url = item.blobUrl
      }),
  ],
  [
    "final claims the wrong phase",
    (v) =>
      editAttachment(v, "native-download-finally.json", (item) => {
        item.phase = "before-assertion"
      }),
  ],
  [
    "final precedes before snapshot",
    (v) =>
      editAttachment(v, "native-download-finally.json", (item) => {
        item.observedAtMs = 2550
      }),
  ],
  [
    "inventory operation disagrees with snapshot",
    (v) =>
      editAttachment(v, "native-download-prepare.json", (item) => {
        item.operations[3].value.complete = false
      }),
  ],
])

for (const variant of ["original", "mutant"]) {
  rejections(
    `${variant} requires complete before and final classifications`,
    [
      [
        "missing before classifications",
        (v) =>
          editAttachment(v, "native-download-classifications.json", (item) => {
            delete item.beforeOriginal
            delete item.beforeMutant
          }),
      ],
      [
        "missing final classifications",
        (v) =>
          editAttachment(v, "native-download-classifications.json", (item) => {
            delete item.finalOriginal
            delete item.finalMutant
          }),
      ],
    ],
    variant,
  )
}

async function savedInputs(t, value, identity) {
  const scratch = join(worktree, ".tmp/download-harness-tests")
  await mkdir(scratch, { recursive: true })
  const directory = await mkdtemp(join(scratch, "report-cli-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const reportPath = join(directory, "report.json")
  const expectedPath = join(directory, "expected.json")
  await writeFile(reportPath, JSON.stringify(value))
  await writeFile(expectedPath, JSON.stringify(identity))
  return { directory, reportPath, expectedPath }
}

function runNode(args) {
  const child = spawnSync("mise", ["exec", "--", "aube", "node", ...args], {
    cwd: worktree,
    encoding: "utf8",
    timeout: 30000,
  })
  assert.equal(child.error, undefined, child.error?.message)
  assert.equal(child.signal, null, child.stderr)
  assert.equal(typeof child.status, "number")
  return child
}

test("import has no CLI side effects even with report-like argv", async (t) => {
  const { directory } = await savedInputs(t, {}, {})
  const probe = join(directory, "import-only.mjs")
  await writeFile(
    probe,
    `await import(${JSON.stringify(moduleUrl.href)}); process.stdout.write("imported\\n")\n`,
  )
  const child = runNode([
    probe,
    join(directory, "absent-report.json"),
    join(directory, "absent-expected.json"),
  ])
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout, "imported\n")
  assert.equal(child.stderr, "")
})

for (const variant of ["original", "mutant"]) {
  test(`actual CLI accepts the saved healthy ${variant} report`, async (t) => {
    const { reportPath, expectedPath } = await savedInputs(
      t,
      report(variant),
      expected(variant),
    )
    const child = runNode([fileURLToPath(moduleUrl), reportPath, expectedPath])
    assert.equal(child.status, 0, child.stderr)
  })

  test(`actual CLI rejects the saved damaged ${variant} report`, async (t) => {
    const value = report(variant)
    editAttachment(value, "native-download-prepare.json", (item) => {
      item.rootRemoved = false
    })
    const { reportPath, expectedPath } = await savedInputs(t, value, expected(variant))
    const child = runNode([fileURLToPath(moduleUrl), reportPath, expectedPath])
    assert.notEqual(child.status, 0, child.stdout)
  })
}

for (const damagedFile of ["reportPath", "expectedPath"]) {
  test(`actual CLI rejects malformed JSON in ${damagedFile}`, async (t) => {
    const inputs = await savedInputs(t, report(), expected())
    await writeFile(inputs[damagedFile], "{")
    const child = runNode([
      fileURLToPath(moduleUrl),
      inputs.reportPath,
      inputs.expectedPath,
    ])
    assert.notEqual(child.status, 0, child.stdout)
  })
}
