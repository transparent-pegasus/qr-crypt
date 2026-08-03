// The archive's INSTALL.txt must stay reproducible from versioned source: it is
// the only member a verifier cannot otherwise byte-compare, and its text is what
// tells them how to verify everything else.
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const run = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, "../..")
const GENERATOR = path.join(REPO_ROOT, "scripts/generate-install-txt.mjs")
const WORKFLOW = path.join(REPO_ROOT, ".github/workflows/github-release.yml")
const SOURCE_SHA = "1234567890abcdef1234567890abcdef12345678"

const generate = (sourceSha: string | undefined) =>
  run("node", [GENERATOR], {
    cwd: REPO_ROOT,
    env: { ...process.env, QR_CRYPT_SOURCE_SHA: sourceSha ?? "" },
  })

describe("INSTALL.txt generation", () => {
  it("renders the release identity the workflow derives from the same sources", async () => {
    const { stdout } = await generate(SOURCE_SHA)
    const { version } = JSON.parse(
      await readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
    )
    const tag = `v${version}-main.g${SOURCE_SHA}`
    const root = `qr-crypt-${tag}-static-install`

    expect(stdout).toContain(`Version: ${version}\n`)
    expect(stdout).toContain(`Source commit: ${SOURCE_SHA}\n`)
    expect(stdout).toContain(`Release tag: ${tag}\n`)
    expect(stdout).toContain(`"${root}.zip"`)
    expect(stdout).toContain(`"${root}.zip.sigstore.json"`)
    expect(stdout).toContain(root)
    expect(stdout).not.toContain("{{")
  })

  it("names the Cosign version pinned by the release workflow", async () => {
    const workflow = await readFile(WORKFLOW, "utf8")
    const pins = [...workflow.matchAll(/^ {2}COSIGN_VERSION: (v[\d.]+)$/gm)]
    expect(pins).toHaveLength(1)
    const { stdout } = await generate(SOURCE_SHA)
    expect(stdout).toContain(`Cosign ${pins[0]![1]} `)
  })

  it("is deterministic", async () => {
    const [first, second] = await Promise.all([
      generate(SOURCE_SHA),
      generate(SOURCE_SHA),
    ])
    expect(first.stdout).toBe(second.stdout)
  })

  it.each([undefined, "nope", SOURCE_SHA.toUpperCase(), `${SOURCE_SHA}0`])(
    "refuses the source commit %s instead of emitting text",
    async (sourceSha) => {
      await expect(generate(sourceSha)).rejects.toMatchObject({ stdout: "" })
    },
  )

  it("stays the release workflow's only source of that text", async () => {
    const workflow = await readFile(WORKFLOW, "utf8")
    expect(workflow).toContain("node scripts/generate-install-txt.mjs")
    expect(workflow).not.toContain('INSTALL.txt" <<')
  })

  // Two clean checkouts of one commit must render identical bytes, or the
  // mandatory diff in Route A §5 reports tampering on an honest release.
  it("renders LF only, and the repository pins that", async () => {
    const { stdout } = await generate(SOURCE_SHA)
    expect(stdout).not.toContain("\r")
    expect(await readFile(path.join(REPO_ROOT, ".gitattributes"), "utf8"))
      .toMatch(/^\* text=auto eol=lf$/m)
  })
})

// INSTALL.txt is the copy that reaches the offline device. Route A §5 requires
// the archive copy to state every operational requirement the repository
// document states; a weaker archive copy is the divergence that procedure
// treats as a tampering signal.
describe("INSTALL.txt as the self-contained procedure", () => {
  const template = () =>
    readFile(
      path.join(REPO_ROOT, "docs/develop/install-route-a/INSTALL.template.txt"),
      "utf8",
    )

  it("validates the container before anything is extracted", async () => {
    const text = await template()
    const validation = text.indexOf("VALIDATE THE CONTAINER BEFORE EXTRACTION")
    const extraction = text.indexOf("Only after all checks pass, extract")
    const sectionEnd = text.indexOf("REBUILD AND COMPARE")
    expect(validation).toBeGreaterThan(-1)
    expect(extraction).toBeGreaterThan(validation)
    expect(sectionEnd).toBeGreaterThan(extraction)
    // Every later mention of extraction points back at the validated root.
    expect(text.indexOf("Extract this ZIP")).toBe(-1)
    expect(text).toContain("Use the validated, safely extracted root")
    const section = text.slice(validation, sectionEnd)
    for (const requirement of [
      "symbolic links",
      "Unicode normalization",
      "compression ratios",
      "no-link, traversal-safe",
    ]) {
      expect(section).toContain(requirement)
    }
  })

  it("regenerates the manifest and compares the complete roots", async () => {
    const text = await template()
    expect(text).toContain('> "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"')
    expect(text).toContain('diff -u "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"')
    expect(text).toContain(
      'diff -qr "$QR_CRYPT_REBUILT_ROOT" "$QR_CRYPT_ARCHIVE_ROOT"',
    )
  })
})

// The release workflow deletes dist/about before staging, so a rebuild that
// compares it against the archive must drop the same tree. Documents that tell a
// verifier otherwise turn every honest release into a tampering signal.
describe("Route A rebuild comparison", () => {
  const documents = [
    "docs/develop/install-route-a/INSTALL.template.txt",
    "docs/develop/install-route-a/README.md",
    "docs/locales/ja/develop/install-route-a/README.md",
  ]

  it.each(documents)("%s excludes the online-only about/ tree", async (file) => {
    const text = await readFile(path.join(REPO_ROOT, file), "utf8")
    expect(text).toContain("! -path './about/*'")
  })

  it("is what the release workflow does", async () => {
    expect(await readFile(WORKFLOW, "utf8")).toContain("rm -rf -- dist/about")
  })
})
