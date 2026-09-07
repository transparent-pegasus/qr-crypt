import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createFixture, readFiles, run, writeFiles } from "./release-fixture"
import { sha256, writeArchive } from "./tested-archive"
import { parseReleaseWorkflow } from "./workflow"

export const SOURCE_SHA = "1".repeat(40)
export const RELEASE_TAG = `v0.1.0-main.g${SOURCE_SHA}`
export const ARCHIVE_NAME = `qr-crypt-${RELEASE_TAG}-static-install.zip`
export const BUNDLE_NAME = `${ARCHIVE_NAME}.sigstore.json`
export const ASSET_NAMES = [ARCHIVE_NAME, "SHA256SUMS", BUNDLE_NAME]

export interface ReleaseAsset {
  name: string
  state: string
}

export interface Release {
  id: number
  tag_name: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  immutable: boolean
  author: { login: string }
  assets: ReleaseAsset[]
}

export const uploadedAssets = (names: string[]): ReleaseAsset[] =>
  names.map((name) => ({ name, state: "uploaded" }))

export function matchingRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: 73,
    tag_name: RELEASE_TAG,
    name: "QR Crypt 0.1.0 automated experimental 111111111111",
    body: [
      `<!-- qr-crypt-automated-release:${SOURCE_SHA} -->`,
      "",
      `Automated experimental build from main commit \`${SOURCE_SHA}\`.`,
      "",
      "This build is not independently audited or security-approved. Use only",
      `\`${ARCHIVE_NAME}\` as the static offline deployment bundle. GitHub's`,
      "automatically generated source archives are not install bundles.",
      "",
      `Verify the ZIP with \`${BUNDLE_NAME}\` and an independently provisioned`,
      "QR Crypt verifier policy, then check `SHA256SUMS`. The archive's",
      "`INSTALL.txt` documents the trust bootstrap and offline deployment",
      "constraints.",
      "",
    ].join("\n"),
    draft: true,
    prerelease: true,
    immutable: false,
    author: { login: "github-actions[bot]" },
    assets: [],
    ...overrides,
  }
}

interface Tag {
  type: string
  sha: string
}

interface FixtureOptions {
  release: Release | null
  tag?: Tag | null
  createRace?: Release
  readOverride?: Partial<Release>
  errors?: Record<string, string>
  corruptDownload?: string
}

export interface PublicationCall {
  command: string
  args: string[]
}

export function mutationCalls(calls: PublicationCall[]): PublicationCall[] {
  return calls.filter(({ command, args }) => {
    if (command !== "gh") return false
    if (args[0] === "api") {
      const method = args[args.indexOf("--method") + 1]
      return args.includes("--method") && method !== "GET"
    }
    return ["upload", "create", "edit", "delete"].includes(args[1] ?? "")
  })
}

export function publicationFixture(options: FixtureOptions) {
  const fixture = createFixture()
  const bin = path.join(fixture.directory, "bin")
  const assets = path.join(fixture.directory, "remote-assets")
  const handoffs = path.join(fixture.directory, "handoffs")
  for (const directory of [bin, assets, handoffs]) mkdirSync(directory)

  const archive = path.join(handoffs, ARCHIVE_NAME)
  writeArchive(archive, [
    {
      name: `${ARCHIVE_NAME.slice(0, -4)}/INSTALL.txt`,
      bytes: Buffer.from(`Source commit: ${SOURCE_SHA}\nRelease tag: ${RELEASE_TAG}\n`),
    },
  ])
  const archiveBytes = readFileSync(archive)
  const expectedAssets = {
    [ARCHIVE_NAME]: archiveBytes,
    SHA256SUMS: Buffer.from(`${sha256(archiveBytes)}  ${ARCHIVE_NAME}\n`),
    [BUNDLE_NAME]: Buffer.from('{"fixture":"offline verification boundary"}\n'),
  }
  writeArchive(path.join(handoffs, "package.zip"), [
    { name: ARCHIVE_NAME, bytes: archiveBytes },
    { name: "SHA256SUMS", bytes: expectedAssets.SHA256SUMS },
  ])
  writeArchive(path.join(handoffs, "signature.zip"), [
    { name: BUNDLE_NAME, bytes: expectedAssets[BUNDLE_NAME]! },
  ])

  // Existing draft bytes need replacement; published bytes already match the
  // handoff. The service fixture only stores bytes supplied by CLI uploads.
  const initialRelease = options.release ?? options.createRace
  for (const asset of initialRelease?.assets ?? []) {
    writeFiles(assets, {
      [asset.name]: initialRelease?.draft
        ? "bytes left by an interrupted upload\n"
        : (expectedAssets[asset.name] ?? Buffer.from("unexpected asset\n")),
    })
  }

  writeFiles(fixture.directory, {
    "scenario.json": JSON.stringify(options),
    "state.json": JSON.stringify({
      release: options.release,
      tag: options.tag === undefined ? { type: "commit", sha: SOURCE_SHA } : options.tag,
    }),
    "calls.jsonl": "",
    "bash-env": "sleep() { :; }\n",
  })
  for (const command of ["gh", "docker"]) {
    const target = path.join(bin, command)
    copyFileSync(new URL("./release-publication-command.py", import.meta.url), target)
    chmodSync(target, 0o755)
  }
  const scripts = parseReleaseWorkflow()
    .jobs.publish.steps.map((step) => step.run)
    .filter((script): script is string => typeof script === "string")
  if (scripts.length !== 1) throw new Error("Expected one inline publication script")
  const scriptPath = path.join(fixture.directory, "publish.sh")
  writeFileSync(scriptPath, scripts[0]!)

  const state = () =>
    JSON.parse(readFileSync(path.join(fixture.directory, "state.json"), "utf8")) as {
      release: Release | null
      tag: Tag | null
    }
  return {
    expectedAssets,
    state,
    assets: () => readFiles(assets),
    execute: (env: NodeJS.ProcessEnv = {}) => {
      const outcome = run(fixture.root, "bash", [scriptPath], {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RELEASE_PUBLICATION_FIXTURE: fixture.directory,
        // Retry decisions execute unchanged; external replication delays do not
        // need wall-clock sleeps in these offline process tests.
        BASH_ENV: path.join(fixture.directory, "bash-env"),
        RUNNER_TEMP: fixture.runnerTemp,
        GITHUB_REPOSITORY: "fixture/repository",
        EXPECTED_REPOSITORY: "fixture/repository",
        EXPECTED_WORKFLOW_IDENTITY: "https://example.invalid/release-workflow",
        COSIGN_VERIFY_IMAGE: `fixture/cosign@sha256:${"f".repeat(64)}`,
        GH_TOKEN: "offline-fixture-token",
        SOURCE_SHA,
        RELEASE_VERSION: "0.1.0",
        RELEASE_TAG,
        ARCHIVE_NAME,
        BUNDLE_NAME,
        PACKAGE_ARTIFACT_ID: "101",
        SIGNATURE_ARTIFACT_ID: "202",
        TESTED_ARCHIVE_SHA256: sha256(archiveBytes),
        IMMUTABILITY_ACKNOWLEDGED: "true",
        ...env,
      })
      const calls = readFileSync(path.join(fixture.directory, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PublicationCall)
      return { ...outcome, calls }
    },
  }
}
