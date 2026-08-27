import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const REPOSITORY_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const SOURCE_ROOT = join(REPOSITORY_ROOT, "src")
const TEST_ROOT = join(REPOSITORY_ROOT, "tests")
const RETIRED_CBOR_PACKAGE = ["cbor", "x"].join("-")

function moduleFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return moduleFiles(path)
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : []
  })
}

describe("v1 implementation removal", () => {
  it("deletes the v1 envelope modules", () => {
    expect(existsSync(join(SOURCE_ROOT, "crypto/envelope.ts"))).toBe(false)
    expect(existsSync(join(SOURCE_ROOT, "schemas/envelope-schema.ts"))).toBe(false)
  })

  it("has no module import of cbor-x", () => {
    const importNeedle = new RegExp(
      String.raw`(?:from\s*|import\s*\(\s*)["']${RETIRED_CBOR_PACKAGE}["']`,
      "u",
    )
    const importingModules = [SOURCE_ROOT, TEST_ROOT]
      .flatMap(moduleFiles)
      .filter((path) => importNeedle.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPOSITORY_ROOT, path))

    expect(importingModules).toEqual([])
  })

  it("removes the cbor-x package dependency", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies).not.toHaveProperty(RETIRED_CBOR_PACKAGE)
    expect(manifest.devDependencies).not.toHaveProperty(RETIRED_CBOR_PACKAGE)
  })

  it("has no v1 prefix or RSA vocabulary in source modules", () => {
    const retiredTokens = [
      "OCM1",
      "OCK1",
      "OCP1",
      "OCB1",
      "RSA-OAEP-3072",
      "rsa-key-pair",
      "KeyKind",
    ]
    const occurrences = moduleFiles(SOURCE_ROOT).flatMap((path) => {
      const source = readFileSync(path, "utf8")
      return retiredTokens
        .filter((token) => source.includes(token))
        .map((token) => `${relative(REPOSITORY_ROOT, path)}: ${token}`)
    })

    expect(occurrences).toEqual([])
  })
})
