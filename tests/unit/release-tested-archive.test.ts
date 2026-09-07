import {
  accessSync,
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { releaseScript, run, writeFiles } from "../fixtures/release-fixture"
import { sha256, testedArchiveFixture, writeArchive } from "../fixtures/tested-archive"

const helper = releaseScript("verify-tested-archive.py")
type Fixture = ReturnType<typeof testedArchiveFixture>
const verify = (fixture: Fixture, digest = fixture.digest, root = fixture.extracted) =>
  run(fixture.root, "python3", [helper, fixture.archive, root, digest])

describe("tested archive identity CLI", () => {
  beforeAll(() => accessSync(helper))

  it("accepts an archive whose digest and entire extracted tree match", () => {
    const fixture = testedArchiveFixture()
    const outcome = verify(fixture)
    expect(outcome.status, outcome.stderr).toBe(0)
  })

  it.each(["0".repeat(64), "NOT_A_DIGEST", "", "a".repeat(63), "A".repeat(64)])(
    "rejects an incorrect or noncanonical expected digest %j",
    (digest) => {
      expect(verify(testedArchiveFixture(), digest).status).not.toBe(0)
    },
  )

  it("rejects changed archive bytes even when every extracted member still matches", () => {
    const fixture = testedArchiveFixture()
    // ZIP readers tolerate trailing bytes; the trusted archive digest must not.
    appendFileSync(fixture.archive, "changed transport bytes")
    expect(verify(fixture).status).not.toBe(0)
  })

  it.each(["index.html", "assets/app-1234abcd.js", "INSTALL.txt", "SHA256SUMS.files"])(
    "rejects changed extracted %s bytes",
    (name) => {
      const fixture = testedArchiveFixture()
      appendFileSync(path.join(fixture.extracted, name), "changed")
      expect(verify(fixture).status).not.toBe(0)
    },
  )

  it("does not trust a rewritten per-file manifest to authorize changed payload bytes", () => {
    const fixture = testedArchiveFixture()
    const bytes = Buffer.from("replacement executable")
    const name = "assets/app-1234abcd.js"
    writeFiles(fixture.extracted, {
      [name]: bytes,
      "SHA256SUMS.files": `${sha256(bytes)}  ${name}\n`,
    })
    expect(verify(fixture).status).not.toBe(0)
  })

  it.each(["INSTALL.txt", "SHA256SUMS.files", "assets/app-1234abcd.js"])(
    "rejects a missing extracted member %s",
    (name) => {
      const fixture = testedArchiveFixture()
      rmSync(path.join(fixture.extracted, name))
      expect(verify(fixture).status).not.toBe(0)
    },
  )

  it("rejects an extra extracted file omitted from the manifest", () => {
    const fixture = testedArchiveFixture()
    writeFiles(fixture.extracted, { "unlisted.txt": "extra" })
    expect(verify(fixture).status).not.toBe(0)
  })

  it("rejects an extra empty extracted directory", () => {
    const fixture = testedArchiveFixture()
    mkdirSync(path.join(fixture.extracted, "unlisted-directory"))
    expect(verify(fixture).status).not.toBe(0)
  })

  it.each(["file", "directory", "root"] as const)(
    "rejects a symlinked extracted %s even when the target bytes agree",
    (kind) => {
      const fixture = testedArchiveFixture()
      const source =
        kind === "root"
          ? fixture.extracted
          : path.join(fixture.extracted, kind === "file" ? "INSTALL.txt" : "assets")
      const outside = path.join(fixture.directory, "symlink-target")
      renameSync(source, outside)
      symlinkSync(outside, source)
      expect(verify(fixture).status).not.toBe(0)
    },
  )

  it("rejects a FIFO without reading or hanging on it", () => {
    const fixture = testedArchiveFixture()
    const filename = path.join(fixture.extracted, "INSTALL.txt")
    rmSync(filename)
    const created = run(fixture.root, "python3", [
      "-c",
      "import os, sys; os.mkfifo(sys.argv[1])",
      filename,
    ])
    expect(created.status, created.stderr).toBe(0)
    expect(verify(fixture).status).not.toBe(0)
  })

  it("rejects duplicate ZIP members even if their bytes are identical", () => {
    const fixture = testedArchiveFixture()
    writeArchive(fixture.archive, [...fixture.members, fixture.members[0]!])
    expect(verify(fixture, sha256(readFileSync(fixture.archive))).status).not.toBe(0)
  })

  it.each([
    "../outside.txt",
    "/absolute.txt",
    "C:/drive.txt",
    "ROOT/../outside.txt",
    "ROOT/./index.html",
    "ROOT//index.html",
    "ROOT\\index.html",
    "other-root/index.html",
  ])("rejects unsafe ZIP member %s even with the correct archive digest", (name) => {
    const fixture = testedArchiveFixture()
    writeArchive(fixture.archive, [
      ...fixture.members,
      { name: name.replaceAll("ROOT", fixture.rootName), bytes: Buffer.from("extra") },
    ])
    expect(verify(fixture, sha256(readFileSync(fixture.archive))).status).not.toBe(0)
  })

  it.each([
    ["symlink", 0o120777],
    ["FIFO", 0o010644],
    ["socket", 0o140644],
    ["character device", 0o020644],
    ["block device", 0o060644],
  ] as const)(
    "rejects a ZIP %s entry whose extracted bytes look regular",
    (_name, mode) => {
      const fixture = testedArchiveFixture()
      writeArchive(
        fixture.archive,
        fixture.members.map((member, index) =>
          index === 0 ? { ...member, mode } : member,
        ),
      )
      expect(verify(fixture, sha256(readFileSync(fixture.archive))).status).not.toBe(0)
    },
  )

  it("rejects an unreadable ZIP even if its digest was supplied correctly", () => {
    const fixture = testedArchiveFixture()
    writeFiles(path.dirname(fixture.archive), { [fixture.archiveName]: "not a zip" })
    expect(verify(fixture, sha256(readFileSync(fixture.archive))).status).not.toBe(0)
  })
})
