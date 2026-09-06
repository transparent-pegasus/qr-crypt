import { createHash } from "node:crypto"
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  utimesSync,
} from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  createFixture,
  readFiles,
  releaseScript,
  REPO_ROOT,
  run,
  writeFiles,
  writeStaticDist,
} from "../fixtures/release-fixture"

const VERSION = "1.2.3-test.4"
const COSIGN_VERSION = "v0.0.1" // Synthetic policy value, not a maintained tool pin.
const COMMIT_TIME = "2001-02-03T04:05:07Z" // ZIP rounds odd seconds down.
const OTHER_SHA = "f".repeat(40)
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

function packageFixture() {
  const fixture = createFixture()
  const output = path.join(fixture.runnerTemp, "github-output")
  writeFiles(fixture.root, {
    "package.json": JSON.stringify({ name: "release-fixture", version: VERSION }),
    ".github/workflows/github-release.yml": `env:\n  COSIGN_VERSION: ${COSIGN_VERSION}\n`,
    "docs/develop/install-route-a/INSTALL.template.txt":
      "Version: {{VERSION}}\nSource commit: {{SOURCE_SHA}}\nRelease tag: {{RELEASE_TAG}}\n" +
      "Root: {{ROOT_NAME}}\nArchive: {{ARCHIVE_NAME}}\nBundle: {{BUNDLE_NAME}}\n" +
      "Cosign: {{COSIGN_VERSION}}\n",
  })
  copyFileSync(
    path.join(REPO_ROOT, "scripts/generate-install-txt.mjs"),
    path.join(fixture.root, "scripts/generate-install-txt.mjs"),
  )
  const gitEnv = {
    GIT_AUTHOR_NAME: "Release fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Release fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: COMMIT_TIME,
    GIT_COMMITTER_DATE: COMMIT_TIME,
  }
  for (const args of [
    [
      "init",
      "--quiet",
      "--initial-branch=fixture",
      "--object-format=sha1",
      "--template=",
    ],
    ["add", "package.json", ".github", "docs", "scripts/generate-install-txt.mjs"],
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
  ]) {
    const result = run(fixture.root, "git", args, gitEnv)
    expect(result.status, result.stderr).toBe(0)
  }
  const head = run(fixture.root, "git", ["rev-parse", "HEAD"])
  expect(head.status, head.stderr).toBe(0)
  const sourceSha = head.stdout.trim()
  expect(sourceSha).toMatch(/^[0-9a-f]{40}$/)
  const payload = writeStaticDist(fixture.root, sourceSha)
  writeFiles(fixture.runnerTemp, { "github-output": "" })
  return {
    ...fixture,
    sourceSha,
    payload,
    output,
    execute: (env: NodeJS.ProcessEnv = {}) =>
      run(fixture.root, "bash", [releaseScript("package-static-pwa.sh")], {
        GITHUB_REPOSITORY: "release-fixture/project",
        EXPECTED_REPOSITORY: "release-fixture/project",
        SOURCE_SHA: sourceSha,
        RUNNER_TEMP: fixture.runnerTemp,
        GITHUB_OUTPUT: output,
        COSIGN_VERSION,
        ...env,
      }),
  }
}

interface ZipEntry {
  name: string
  bytes: string
  timestamp: number[]
  mode: number
  system: number
  compression: number
}

function inspectArchive(root: string, archive: string): ZipEntry[] {
  const result = run(root, "python3", [
    "-c",
    `import base64, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    print(json.dumps([{
        "name": entry.filename,
        "bytes": base64.b64encode(archive.read(entry)).decode("ascii"),
        "timestamp": entry.date_time,
        "mode": entry.external_attr >> 16,
        "system": entry.create_system,
        "compression": entry.compress_type,
    } for entry in archive.infolist()]))
`,
    archive,
  ])
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as ZipEntry[]
}

describe("package-static-pwa.sh", () => {
  it("emits the canonical archive, exact checksums and normalized reproducible member bytes", () => {
    const fixture = packageFixture()
    writeFiles(fixture.root, {
      "dist/about/index.html": "online-only page\n",
      "dist/about/assets/card.png": Buffer.from([1, 2, 3]),
    })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(0)

    const tag = `v${VERSION}-main.g${fixture.sourceSha}`
    const rootName = `qr-crypt-${tag}-static-install`
    const archiveName = `${rootName}.zip`
    const expectedOutputs =
      `archive_name=${archiveName}\nbundle_name=${archiveName}.sigstore.json\n` +
      `release_tag=${tag}\nversion=${VERSION}\n`
    expect(readFileSync(fixture.output, "utf8")).toBe(expectedOutputs)
    expect(existsSync(path.join(fixture.root, "dist/about"))).toBe(false)

    const expectedPayload = {
      ...fixture.payload,
      "INSTALL.txt": Buffer.from(
        `Version: ${VERSION}\nSource commit: ${fixture.sourceSha}\nRelease tag: ${tag}\n` +
          `Root: ${rootName}\nArchive: ${archiveName}\nBundle: ${archiveName}.sigstore.json\n` +
          `Cosign: ${COSIGN_VERSION}\n`,
      ),
    }
    const perFileChecksums = Object.entries(expectedPayload)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`)
      .join("")
    const expectedFiles: Record<string, Buffer> = {
      ...expectedPayload,
      "SHA256SUMS.files": Buffer.from(perFileChecksums),
    }
    const outputDir = path.join(fixture.runnerTemp, "qr-crypt-release")
    const archivePath = path.join(outputDir, archiveName)
    const archiveBytes = readFileSync(archivePath)
    expect(readdirSync(outputDir).sort()).toEqual(["SHA256SUMS", archiveName])
    expect(readFileSync(path.join(outputDir, "SHA256SUMS"), "utf8")).toBe(
      `${sha256(archiveBytes)}  ${archiveName}\n`,
    )

    const entries = inspectArchive(fixture.root, archivePath)
    expect(entries.map((entry) => entry.name)).toEqual(
      Object.keys(expectedFiles)
        .sort()
        .map((name) => `${rootName}/${name}`),
    )
    for (const entry of entries) {
      const name = entry.name.slice(rootName.length + 1)
      expect(Buffer.from(entry.bytes, "base64"), entry.name).toEqual(expectedFiles[name])
      expect(entry, entry.name).toMatchObject({
        timestamp: [2001, 2, 3, 4, 5, 6],
        mode: 0o100644,
        system: 3,
        compression: 0,
      })
    }
    for (const parent of ["qr-crypt-release-stage", "qr-crypt-release-extracted"]) {
      const packagedRoot = path.join(fixture.runnerTemp, parent, rootName)
      expect(readFiles(packagedRoot)).toEqual(expectedFiles)
    }
    const stagedRoot = path.join(fixture.runnerTemp, "qr-crypt-release-stage", rootName)
    for (const name of ["", "assets", "icons"]) {
      const metadata = statSync(path.join(stagedRoot, name))
      expect(metadata.mode & 0o777).toBe(0o755)
      expect(metadata.mtimeMs).toBe(Date.parse(COMMIT_TIME))
    }
    for (const name of Object.keys(expectedFiles)) {
      const metadata = statSync(path.join(stagedRoot, name))
      expect(metadata.mode & 0o777).toBe(0o644)
      expect(metadata.mtimeMs).toBe(Date.parse(COMMIT_TIME))
    }

    // Filesystem metadata must not change the archive of the same source bytes.
    for (const name of Object.keys(fixture.payload)) {
      const file = path.join(fixture.root, "dist", name)
      chmodSync(file, 0o755)
      const timestamp = new Date("2020-01-01T00:00:00Z")
      utimesSync(file, timestamp, timestamp)
    }
    const repeated = fixture.execute()
    expect(repeated.status, repeated.stderr).toBe(0)
    expect(readFileSync(archivePath)).toEqual(archiveBytes)
    expect(readFileSync(fixture.output, "utf8")).toBe(expectedOutputs.repeat(2))
  })

  it.each([
    {
      name: "an extra file",
      mutate: (root: string) => writeFiles(root, { "dist/unexpected.txt": "extra\n" }),
      error: "file outside the explicit release allowlist",
    },
    {
      name: "an extra directory",
      mutate: (root: string) => mkdirSync(path.join(root, "dist/unexpected")),
      error: "directory outside the explicit release allowlist",
    },
    {
      name: "an unreferenced generated asset",
      mutate: (root: string) =>
        writeFiles(root, { "dist/assets/unused-abcdefgh.js": "export {};\n" }),
      error: "generated asset is not referenced by the static closure",
    },
    {
      name: "a symlink among generated assets",
      mutate: (root: string) =>
        symlinkSync("../index.html", path.join(root, "dist/assets/link-12345678.js")),
      error: "dist/assets must contain only flat regular files",
    },
    {
      name: "a source-map reference in an allowed asset",
      mutate: (root: string) =>
        appendFileSync(
          path.join(root, "dist/assets/app-1234abcd.js"),
          "//# sourceMappingURL=app.js.map\n",
        ),
      error: "source-map reference is forbidden",
    },
    {
      name: "a missing asset referenced from the root page",
      mutate: (root: string) =>
        appendFileSync(
          path.join(root, "dist/index.html"),
          '<script src="/assets/missing-12345678.js"></script>',
        ),
      error: "missing or unsafe root-relative asset",
    },
  ])("rejects $name without advertising an archive", ({ mutate, error }) => {
    const fixture = packageFixture()
    mutate(fixture.root)
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain(error)
    expect(readFileSync(fixture.output, "utf8")).toBe("")
    const outputDir = path.join(fixture.runnerTemp, "qr-crypt-release")
    expect(existsSync(outputDir) ? readdirSync(outputDir) : []).toEqual([])
  })

  it.each([
    {
      name: "another source commit",
      env: { SOURCE_SHA: OTHER_SHA },
      error: "checkout does not match the triggering commit",
    },
    {
      name: "a noncanonical source SHA",
      env: { SOURCE_SHA: OTHER_SHA.toUpperCase() },
      error: "source SHA is not a full lowercase Git object ID",
    },
    {
      name: "another repository",
      env: { GITHUB_REPOSITORY: "other/project" },
      error: "unexpected repository",
    },
  ])("rejects $name before creating release output", ({ env, error }) => {
    const fixture = packageFixture()
    const outcome = fixture.execute(env)

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain(error)
    expect(readFileSync(fixture.output, "utf8")).toBe("")
    expect(existsSync(path.join(fixture.runnerTemp, "qr-crypt-release"))).toBe(false)
  })

  it("rejects built assets that contain the wrong source identity", () => {
    const fixture = packageFixture()
    const asset = path.join(fixture.root, "dist/assets/app-1234abcd.js")
    writeFiles(fixture.root, {
      "dist/assets/app-1234abcd.js": readFileSync(asset, "utf8").replace(
        fixture.sourceSha,
        OTHER_SHA,
      ),
    })
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain("built assets do not contain the full source SHA")
    expect(readFileSync(fixture.output, "utf8")).toBe("")
  })
})
