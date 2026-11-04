import assert from "node:assert/strict"
import test from "node:test"
import { classifyDownload } from "./download-candidate.ts"

const invalidIdentifiers = [
  ["boolean true", true],
  ["number 17", 17],
  ["object", { id: "synthetic" }],
  ["array", []],
  ["boolean false", false],
  ["number zero", 0],
  ["null", null],
  ["empty string", ""],
  ["oversize string", "x".repeat(1025)],
  ["oversize UTF-8 string", "é".repeat(513)],
  ["C0 control", "opaque\u0000id"],
  ["C1 control", "opaque\u0085id"],
]

for (const [variant, state, expected, files] of [
  ["original", "canceled", "denied", []],
  [
    "mutant",
    "completed",
    "saved",
    [
      {
        contained: true,
        regular: true,
        bytes: 27,
        sha256: "a3a596f7874dc6f3b8f4fa9bc6bb1a3f432cabf218f141bcea59ed590baff67f",
      },
    ],
  ],
]) {
  const observation = {
    variant,
    blobUrl: "blob:http://tauri.localhost/synthetic-download",
    clickedAtMs: 1000,
    observedAtMs: 7000,
    events: [
      {
        method: "Browser.downloadWillBegin",
        atMs: 1100,
        guid: "opaque-download:17",
        url: "blob:http://tauri.localhost/synthetic-download",
        frameId: "opaque-frame:top",
        suggestedFilename: "native-relay-inert-download.txt",
      },
      {
        method: "Browser.downloadProgress",
        atMs: 1200,
        guid: "opaque-download:17",
        state,
        receivedBytes: variant === "original" ? 0 : 27,
        totalBytes: 27,
      },
    ],
    files,
    droppedEvents: 0,
    evidenceError: null,
    inventoryError: null,
  }

  test(`${variant} accepts valid opaque string identifiers`, () => {
    assert.equal(classifyDownload(observation), expected)
  })

  for (const field of ["guid", "frameId"]) {
    for (const [label, value] of invalidIdentifiers) {
      test(`${variant} rejects ${label} ${field}`, () => {
        const malformed = structuredClone(observation)
        malformed.events[0][field] = value
        if (field === "guid") malformed.events[1].guid = value
        assert.equal(classifyDownload(malformed), "failed")
      })
    }
  }
}
