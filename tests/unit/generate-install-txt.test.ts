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
})

// The release workflow deletes dist/about before staging, so a rebuild that
// compares it against the archive must drop the same tree. Documents that tell a
// verifier otherwise turn every honest release into a tampering signal.
describe("Route A rebuild comparison", () => {
  const documents = [
    "docs/develop/install-route-a/INSTALL.template.txt",
    "docs/develop/install-route-a/README.md",
    "docs/languages/ja/develop/install-route-a/README.md",
  ]

  it.each(documents)("%s excludes the online-only about/ tree", async (file) => {
    const text = await readFile(path.join(REPO_ROOT, file), "utf8")
    expect(text).toContain("! -path './about/*'")
  })

  it("is what the release workflow does", async () => {
    expect(await readFile(WORKFLOW, "utf8")).toContain("rm -rf -- dist/about")
  })
})
