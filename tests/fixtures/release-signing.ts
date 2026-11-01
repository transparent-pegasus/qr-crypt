import { chmodSync, copyFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { createFixture, run, writeFiles } from "./release-fixture"
import { ARCHIVE_NAME, BUNDLE_NAME, SOURCE_SHA } from "./release-publication"
import { sha256, writeArchive } from "./tested-archive"
import { parseReleaseWorkflow } from "./workflow"

export function signingFixture() {
  const fixture = createFixture()
  const archiveDirectory = path.join(fixture.runnerTemp, "unsigned-release")
  const archive = path.join(archiveDirectory, ARCHIVE_NAME)
  writeFiles(archiveDirectory, { SHA256SUMS: "" })
  writeArchive(archive, [
    { name: "fixture/INSTALL.txt", bytes: Buffer.from("fixture\n") },
  ])
  const digest = sha256(readFileSync(archive))
  const scripts = parseReleaseWorkflow()
    .jobs.sign.steps.map((step) => step.run)
    .filter((script): script is string => script?.includes("cosign sign-blob") === true)
  if (scripts.length !== 1) throw new Error("Expected one inline signing script")
  writeFiles(fixture.directory, {
    "sign.sh": scripts[0]!,
    "calls.jsonl": "",
    "bin/cosign": "",
    "runner/unsigned-release/SHA256SUMS": `${digest}  ${ARCHIVE_NAME}\n`,
  })
  const executable = path.join(fixture.directory, "bin/cosign")
  copyFileSync(new URL("./release-sign-command.py", import.meta.url), executable)
  chmodSync(executable, 0o755)
  return {
    digest,
    execute: (env: NodeJS.ProcessEnv = {}) => {
      const outcome = run(
        fixture.root,
        "bash",
        [path.join(fixture.directory, "sign.sh")],
        {
          PATH: `${path.join(fixture.directory, "bin")}:${process.env.PATH ?? ""}`,
          RELEASE_SIGN_TEST_CALLS: path.join(fixture.directory, "calls.jsonl"),
          RUNNER_TEMP: fixture.runnerTemp,
          GITHUB_REPOSITORY: "fixture/repository",
          EXPECTED_REPOSITORY: "fixture/repository",
          EXPECTED_WORKFLOW_IDENTITY: "https://example.invalid/release-workflow",
          SOURCE_SHA,
          ARCHIVE_NAME,
          BUNDLE_NAME,
          PACKAGED_ARCHIVE_SHA256: digest,
          TESTED_ARCHIVE_SHA256: digest,
          ...env,
        },
      )
      const calls = readFileSync(path.join(fixture.directory, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
      return { ...outcome, calls }
    },
  }
}
