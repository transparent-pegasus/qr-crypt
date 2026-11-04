import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"
import { classifyDownload, parseReadyReceipt } from "./download-candidate.ts"

const title = "a trusted blob download cannot complete or save a file in owned storage"
const denial =
  "Error: NATIVE_DOWNLOAD_DENIAL: same original denial assertion for every EXE"
const object = (value) => {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value))
  return value
}
const array = (value) => {
  assert.ok(Array.isArray(value))
  return value
}
const empty = (value) => assert.equal(array(value).length, 0)
const time = (value) => assert.ok(Number.isFinite(value) && value >= 0)
const intendedFailure = (message) => {
  assert.equal(typeof message, "string")
  const lines = stripVTControlCharacters(message).replaceAll("\r\n", "\n").split("\n")
  assert.equal(lines[0], denial)
  for (const [field, value] of [
    ["Expected", '"denied"'],
    ["Received", '"failed"'],
  ])
    assert.deepEqual(
      lines
        .filter((line) => line.startsWith(field + ":"))
        .map((line) => line.slice(field.length + 1).trim()),
      [value],
    )
}

function attachment(result, name) {
  const matches = array(result.attachments).filter((item) => object(item).name === name)
  assert.equal(matches.length, 1, `Required attachment: ${name}`)
  const item = matches[0]
  assert.equal(item.contentType, "application/json")
  assert.equal(typeof item.body, "string")
  assert.ok(item.body.length > 0 && item.body.length <= 1024 * 1024)
  const bytes = Buffer.from(item.body, "base64")
  assert.equal(bytes.toString("base64"), item.body, `Canonical Base64: ${name}`)
  return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
}

function candidateEvidence(result, expected, delegated) {
  const candidate = attachment(result, "native-candidate.json")
  assert.equal(candidate.sourceHead, expected.source)
  assert.equal(candidate.expectedBuildSha, expected.source)
  assert.equal(candidate.exeSha256, expected.exeSha256)
  assert.equal(candidate.locks.cargo, expected.cargoLockSha256)
  assert.equal(candidate.locks.aube, expected.aubeLockSha256)
  assert.equal(candidate.powerShell.sha256, expected.powerShellSha256)
  assert.deepEqual(candidate.process.integrity, { rid: 8192, elevated: false })
  assert.ok(
    Number.isSafeInteger(candidate.process.processId) && candidate.process.processId > 0,
  )
  time(candidate.process.startedAt)
  assert.equal(candidate.window.cdpOwned, true)
  assert.equal(candidate.window.processId, candidate.process.processId)
  assert.equal(candidate.window.startedAt, candidate.process.startedAt)
  empty(candidate.pageErrors)
  empty(candidate.responseErrors)
  assert.equal(candidate.childOutputOverflow, false)
  assert.ok(
    Number.isInteger(candidate.childExit.code) ||
      typeof candidate.childExit.signal === "string",
  )
  assert.equal(candidate.cleanup.ownedTreeExited, true)
  assert.equal(candidate.cleanup.requestedStorageRemoved, !delegated)
  assert.equal(candidate.cleanup.profileRemoved, !delegated)
  if (delegated) assert.equal(candidate.cleanup.storageRemovalDelegated, true)
  else assert.ok(candidate.cleanup.storageRemovalDelegated !== true)
  return candidate
}

function observationEvidence(value, phase, variant) {
  assert.equal(value.phase, phase)
  assert.equal(typeof value.blobUrl, "string")
  assert.ok(value.blobUrl.startsWith("blob:http://tauri.localhost/"))
  const inventory = object(value.inventory)
  assert.equal(inventory.complete, true)
  assert.equal(inventory.no_reparse, true)
  assert.ok(array(inventory.files).length <= 4096)
  assert.ok(Buffer.byteLength(JSON.stringify(inventory)) <= 32768)
  for (const file of inventory.files) object(file)
  for (const event of array(value.events)) object(event)
  const classify = (variant) =>
    classifyDownload({ ...value, variant, files: inventory.files })
  const original = classify("original")
  const mutant = classify("mutant")
  assert.equal(original, variant === "original" ? "denied" : "failed")
  assert.equal(mutant, variant === "mutant" ? "saved" : "failed")
  assert.equal(value.originalDenial, original)
  assert.equal(value.mutantPositive, mutant)
  if (variant === "mutant")
    assert.equal(inventory.files[0].name, "native-relay-inert-download.txt")
  return { original, mutant }
}

export function validateDownloadReport(report, expected) {
  object(expected)
  assert.ok(["original", "mutant"].includes(expected.variant))
  for (const key of [
    "source",
    "exeSha256",
    "cargoLockSha256",
    "aubeLockSha256",
    "helperSha256",
    "powerShellSha256",
  ])
    assert.ok(
      typeof expected[key] === "string" &&
        new RegExp(`^[0-9a-f]{${key === "source" ? 40 : 64}}$`).test(expected[key]),
    )
  object(report)
  empty(report.errors)
  const specs = []
  function visit(suites) {
    for (const suite of array(suites)) {
      object(suite)
      for (const spec of array(suite.specs)) specs.push(object(spec))
      if (Object.hasOwn(suite, "suites")) visit(suite.suites)
    }
  }
  visit(report.suites)
  const targets = specs.filter((spec) => spec.title === title)
  assert.equal(targets.length, 1, "Exactly one download case is required")
  const target = targets[0]
  const mutant = expected.variant === "mutant"
  if (mutant) assert.equal(specs.length, 1)
  for (const spec of specs) {
    const failing = mutant && spec === target
    assert.equal(spec.ok, !failing)
    assert.equal(array(spec.tests).length, 1)
    const test = object(spec.tests[0])
    assert.equal(test.expectedStatus, "passed")
    assert.equal(test.status, failing ? "unexpected" : "expected")
    assert.equal(array(test.results).length, 1)
    const result = object(test.results[0])
    assert.equal(result.retry, 0)
    assert.equal(result.status, failing ? "failed" : "passed")
    for (const item of array(result.attachments)) object(item)
    if (failing) {
      assert.equal(array(result.errors).length, 1)
      intendedFailure(result.errors[0].message)
      intendedFailure(result.error.message)
    } else {
      empty(result.errors)
      assert.ok(result.error === undefined)
    }
    if (
      spec !== target &&
      result.attachments.some((item) => item.name === "native-candidate.json")
    )
      candidateEvidence(result, expected, false)
  }
  object(report.stats)
  assert.equal(report.stats.expected, mutant ? 0 : specs.length)
  assert.equal(report.stats.unexpected, mutant ? 1 : 0)
  assert.equal(report.stats.skipped, 0)
  assert.equal(report.stats.flaky, 0)
  const result = target.tests[0].results[0]
  const candidate = candidateEvidence(result, expected, true)
  const prepare = attachment(result, "native-download-prepare.json")
  const before = attachment(result, "native-download-before-assertion.json")
  const final = attachment(result, "native-download-finally.json")
  const classifications = attachment(result, "native-download-classifications.json")
  const beforeClass = observationEvidence(before, "before-assertion", expected.variant)
  const finalClass = observationEvidence(final, "finally", expected.variant)
  assert.equal(final.blobUrl, before.blobUrl)
  assert.equal(final.clickedAtMs, before.clickedAtMs)
  assert.ok(final.observedAtMs >= before.observedAtMs)
  assert.deepEqual(final.events.slice(0, before.events.length), before.events)
  assert.equal(classifications.beforeOriginal, beforeClass.original)
  assert.equal(classifications.beforeMutant, beforeClass.mutant)
  assert.equal(classifications.finalOriginal, finalClass.original)
  assert.equal(classifications.finalMutant, finalClass.mutant)
  if (mutant) intendedFailure(classifications.primary)
  else assert.equal(classifications.primary, null)
  assert.equal(prepare.source, expected.source)
  assert.equal(prepare.helperSha256, expected.helperSha256)
  for (const key of [
    "closed",
    "rootRemoved",
    "parentRemoved",
    "candidateStarted",
    "drainage",
  ])
    assert.equal(prepare[key], true, key)
  for (const key of ["error", "primary", "cleanup"]) assert.equal(prepare[key], null, key)
  assert.equal(prepare.outputOverflow, false)
  assert.equal(prepare.exit.code, 0)
  assert.equal(prepare.exit.signal, null)
  assert.equal(prepare.stderrHex, "")
  assert.ok(
    typeof prepare.stdoutHex === "string" && /^(?:[0-9a-f]{2})+$/.test(prepare.stdoutHex),
  )
  for (const key of [
    "startedAt",
    "prepareStarted",
    "prepareDeadline",
    "allowance",
    "elapsedMs",
  ])
    time(prepare[key])
  assert.ok(prepare.prepareStarted >= prepare.startedAt)
  assert.ok(prepare.allowance > 10000 && prepare.allowance <= 45000)
  assert.equal(prepare.prepareDeadline, prepare.prepareStarted + prepare.allowance)
  assert.ok(prepare.prepareDeadline <= prepare.startedAt + 80000)
  assert.ok(prepare.elapsedMs <= 90000)
  const root = parseReadyReceipt(
    Buffer.from(prepare.stdoutHex, "hex"),
    Buffer.alloc(0),
    prepare.exit.code,
    prepare.exit.signal,
    {
      parent: prepare.parent,
      nonce: prepare.nonce,
      pid: prepare.pid,
      elapsedCapMs: prepare.allowance,
    },
  )
  assert.equal(root, prepare.transferredRoot)
  const members = array(prepare.members)
  assert.ok(members.length > 0 && members.length <= 128)
  for (const member of members) {
    assert.ok(Number.isSafeInteger(member.pid) && member.pid > 0)
    time(member.startedAt)
    assert.equal(typeof member.image, "string")
  }
  assert.ok(
    members.some(
      (member) =>
        member.pid === candidate.process.processId &&
        member.startedAt === candidate.process.startedAt,
    ),
  )
  const operations = array(prepare.operations)
  assert.deepEqual(
    operations.map((op) => object(op).action),
    ["parent", "validate", "inventory", "inventory", "members", "drained", "remove"],
  )
  let previous = 0
  for (const operation of operations) {
    time(operation.atMs)
    assert.ok(operation.atMs >= previous && operation.atMs <= prepare.elapsedMs)
    assert.equal(operation.root, operation.action === "parent" ? null : root)
    assert.equal(operation.error, undefined)
    object(operation.value)
    previous = operation.atMs
  }
  assert.equal(operations[0].value.validated, true)
  assert.equal(operations[1].value.validated, true)
  assert.deepEqual(operations[2].value, before.inventory)
  assert.deepEqual(operations[3].value, final.inventory)
  assert.deepEqual(operations[4].value.members, members)
  assert.equal(operations[5].value.drained, true)
  assert.equal(operations[6].value.rootRemoved, true)
  assert.equal(operations[6].value.parentRemoved, true)
  assert.ok(operations[1].atMs <= before.clickedAtMs)
  assert.ok(operations[2].atMs <= before.observedAtMs)
  assert.ok(before.observedAtMs <= operations[3].atMs)
  assert.ok(operations[3].atMs <= final.observedAtMs)
  assert.ok(final.observedAtMs <= operations[4].atMs)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(
      process.argv.length,
      4,
      "Usage: download-report.mjs REPORT_JSON EXPECTED_JSON",
    )
    const report = JSON.parse(await readFile(process.argv[2], "utf8"))
    const expected = JSON.parse(await readFile(process.argv[3], "utf8"))
    validateDownloadReport(report, expected)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
