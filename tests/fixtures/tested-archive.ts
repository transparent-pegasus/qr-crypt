import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createFixture, run, writeFiles, writeStaticDist } from "./release-fixture"

export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

export interface ArchiveMember {
  name: string
  bytes: Buffer
  mode?: number
}

export function writeArchive(archive: string, members: ArchiveMember[]) {
  const input = `${archive}.members.json`
  writeFileSync(
    input,
    JSON.stringify(
      members.map(({ name, bytes, mode = 0o100644 }) => ({
        name,
        bytes: bytes.toString("base64"),
        mode,
      })),
    ),
  )
  const outcome = run(path.dirname(archive), "python3", [
    "-c",
    `import base64, json, sys, zipfile
with open(sys.argv[2]) as source:
    members = json.load(source)
with zipfile.ZipFile(sys.argv[1], "w", compression=zipfile.ZIP_STORED) as archive:
    for member in members:
        info = zipfile.ZipInfo(member["name"], (2001, 2, 3, 4, 5, 6))
        info.create_system = 3
        info.external_attr = member["mode"] << 16
        archive.writestr(info, base64.b64decode(member["bytes"]))
`,
    archive,
    input,
  ])
  rmSync(input)
  if (outcome.status !== 0) throw new Error(outcome.stderr)
}

export function testedArchiveFixture() {
  const fixture = createFixture()
  const rootName = "qr-crypt-fixture-static-install"
  const archiveName = `${rootName}.zip`
  const archiveDirectory = path.join(fixture.runnerTemp, "qr-crypt-release")
  const archive = path.join(archiveDirectory, archiveName)
  const extracted = path.join(fixture.runnerTemp, "qr-crypt-release-extracted", rootName)
  mkdirSync(archiveDirectory)
  const payload = {
    ...writeStaticDist(fixture.root),
    // Include every release byte, even metadata outside the manifest's inventory.
    "INSTALL.txt": Buffer.from("Synthetic installation instructions\n"),
  }
  const manifest = Object.entries(payload)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`)
    .join("")
  const files: Record<string, Buffer> = {
    ...payload,
    "SHA256SUMS.files": Buffer.from(manifest),
  }
  writeFiles(extracted, files)
  const members: ArchiveMember[] = Object.entries(files).map(([name, bytes]) => ({
    name: `${rootName}/${name}`,
    bytes,
  }))
  writeArchive(archive, members)
  const digest = sha256(readFileSync(archive))
  writeFiles(archiveDirectory, { SHA256SUMS: `${digest}  ${archiveName}\n` })
  return {
    ...fixture,
    rootName,
    archiveName,
    archive,
    extracted,
    files,
    members,
    digest,
  }
}
