// Render the archive's INSTALL.txt from its versioned template so an
// independent verifier can reproduce that member byte for byte, like every
// payload file. The release workflow and the Route A rebuild-and-compare
// procedure both call this; a second copy of the text would defeat the point.
//
// The only caller-supplied input is the source commit, which the verifier
// authenticates independently. Everything else is read from the checkout at
// that commit, so no value from the archive under inspection can feed back
// into the comparison.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const REPO_ROOT = new URL("../", import.meta.url)
const TEMPLATE_PATH = "docs/develop/install-route-a/INSTALL.template.txt"
const WORKFLOW_PATH = ".github/workflows/github-release.yml"

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/
// Same SemVer rule the release workflow applies to package.json.
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$/
const COSIGN_VERSION_LINE = /^ {2}COSIGN_VERSION: (v[0-9]+\.[0-9]+\.[0-9]+)$/gm
const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), "utf8")
}

function fail(message) {
  throw new Error(`INSTALL.txt generation failed: ${message}`)
}

function readVersion() {
  const { version } = JSON.parse(read("package.json"))
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    fail("package.json version is not a supported SemVer value")
  }
  return version
}

// Read the pinned Cosign version from the workflow rather than accepting it as
// an argument: the release notes and the verifier must quote the same pin, and
// a single match keeps a renamed or duplicated key from silently passing.
function readCosignVersion() {
  const matches = [...read(WORKFLOW_PATH).matchAll(COSIGN_VERSION_LINE)]
  if (matches.length !== 1) {
    fail(`${WORKFLOW_PATH} must define COSIGN_VERSION exactly once`)
  }
  return matches[0][1]
}

export function installTextValues(sourceSha) {
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
    fail("source commit is not a full lowercase Git object ID")
  }
  const version = readVersion()
  const releaseTag = `v${version}-main.g${sourceSha}`
  const rootName = `qr-crypt-${releaseTag}-static-install`
  const archiveName = `${rootName}.zip`
  return {
    VERSION: version,
    SOURCE_SHA: sourceSha,
    RELEASE_TAG: releaseTag,
    ROOT_NAME: rootName,
    ARCHIVE_NAME: archiveName,
    BUNDLE_NAME: `${archiveName}.sigstore.json`,
    COSIGN_VERSION: readCosignVersion(),
  }
}

export function renderInstallText(sourceSha) {
  const values = installTextValues(sourceSha)
  const rendered = read(TEMPLATE_PATH).replace(PLACEHOLDER, (_match, name) => {
    if (!(name in values)) fail(`template uses an unknown placeholder ${name}`)
    return values[name]
  })
  if (rendered.includes("{{") || rendered.includes("}}")) {
    fail("rendered text still contains placeholder syntax")
  }
  return rendered
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(renderInstallText(process.env.QR_CRYPT_SOURCE_SHA ?? ""))
}
