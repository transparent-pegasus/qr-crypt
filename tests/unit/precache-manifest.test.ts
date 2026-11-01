import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { precacheManifest } from "../../scripts/precache-manifest.mjs"

describe("precacheManifest", () => {
  let outDir: string

  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), "qr-crypt-precache-"))
  })

  afterEach(() => rmSync(outDir, { recursive: true, force: true }))

  function writeFixture(names: string[]) {
    for (const name of names) {
      const file = path.join(outDir, name)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, `fixture: ${name}\n`)
    }
  }

  it("keeps exactly the precache extensions", () => {
    writeFixture([
      "index.html",
      "manifest.webmanifest",
      "favicon.svg",
      "icons/a.png",
      "assets/a-12345678.js",
      "assets/a-12345678.css",
      "assets/r-12345678.wasm",
      "reachability-sentinel.txt",
      "_headers",
      "_redirects",
      "assets/A.JS",
    ])

    expect(precacheManifest(outDir).map(({ url }) => url)).toEqual([
      "assets/a-12345678.css",
      "assets/a-12345678.js",
      "assets/r-12345678.wasm",
      "favicon.svg",
      "icons/a.png",
      "index.html",
      "manifest.webmanifest",
    ])
  })

  it("excludes about and the worker itself", () => {
    writeFixture(["index.html", "about/index.html", "about/ja/index.html", "sw.js"])

    expect(precacheManifest(outDir).map(({ url }) => url)).toEqual(["index.html"])
  })

  it("ignores dot segments and non-regular files", () => {
    writeFixture(["index.html", ".well-known/x.js", "assets/.hidden.js"])
    symlinkSync("index.html", path.join(outDir, "link.js"))
    mkdirSync(path.join(outDir, "directory.js"))

    expect(precacheManifest(outDir).map(({ url }) => url)).toEqual(["index.html"])
  })

  it("revision is the SHA-256 of the bytes", () => {
    const bytes = Buffer.from([0, 0xff, 0x80, 0x0a, 0x0d, 0x61])
    writeFileSync(path.join(outDir, "binary.wasm"), bytes)

    expect(precacheManifest(outDir)).toEqual([
      {
        url: "binary.wasm",
        revision: createHash("sha256").update(bytes).digest("hex"),
      },
    ])
  })

  it("is sorted and repeatable", () => {
    writeFixture(["z.js", "a.js", "Z.js"])

    const first = precacheManifest(outDir)
    expect(precacheManifest(outDir)).toEqual(first)
    expect(first.map(({ url }) => url)).toEqual(["Z.js", "a.js", "z.js"])
    for (let index = 1; index < first.length; index += 1) {
      expect(first[index - 1]!.url < first[index]!.url).toBe(true)
    }
  })
})
