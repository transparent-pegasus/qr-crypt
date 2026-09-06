import { chmodSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  createFixture,
  readFiles,
  releaseScript,
  run,
  writeFiles,
} from "../fixtures/release-fixture"

const firstFiles = {
  "index.html": "first build\n",
  "assets/app.js": "export const value = 1;\n",
  "assets/binary file.wasm": Buffer.from([0, 1, 2, 255]),
}

function buildFixture() {
  const fixture = createFixture()
  const dist = path.join(fixture.root, "dist")
  const secondBuild = path.join(fixture.directory, "second-build-input")
  const bin = path.join(fixture.directory, "bin")
  const calls = path.join(fixture.directory, "build-calls")
  writeFiles(dist, firstFiles)
  writeFiles(secondBuild, firstFiles)
  writeFiles(bin, {
    aube: `#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 2 && "$1" == run && "$2" == build:prod ]] || exit 64
[[ ! -e dist ]] || { printf 'first dist is still in the build scan tree\n' >&2; exit 65; }
printf '%s\n' "$*" >> "$FIXTURE_BUILD_CALLS"
if [[ "$FIXTURE_BUILD_EXIT" == 0 ]]; then
  cp -a -- "$FIXTURE_SECOND_BUILD" dist
else
  mkdir dist
  printf 'partial build\n' > dist/partial.txt
  printf 'fixture second build failed\n' >&2
  exit "$FIXTURE_BUILD_EXIT"
fi
`,
  })
  chmodSync(path.join(bin, "aube"), 0o755)
  const original = readFiles(dist)
  const originalInode = statSync(dist).ino
  return {
    ...fixture,
    secondBuild,
    execute: (exitCode = 0) =>
      run(fixture.root, "bash", [releaseScript("verify-build-determinism.sh")], {
        RUNNER_TEMP: fixture.runnerTemp,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FIXTURE_SECOND_BUILD: secondBuild,
        FIXTURE_BUILD_CALLS: calls,
        FIXTURE_BUILD_EXIT: String(exitCode),
      }),
    expectRestored() {
      expect(readFiles(dist)).toEqual(original)
      expect(statSync(dist).ino).toBe(originalInode)
      expect(readFileSync(calls, "utf8")).toBe("run build:prod\n")
    },
  }
}

describe("verify-build-determinism.sh", () => {
  it("accepts identical file sets and bytes and returns the original dist", () => {
    const fixture = buildFixture()
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(0)
    fixture.expectRestored()
  })

  it("rejects changed bytes even when the file set agrees and restores dist", () => {
    const fixture = buildFixture()
    writeFiles(fixture.secondBuild, { "assets/app.js": "export const value = 2;\n" })
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain("file hashes differ")
    fixture.expectRestored()
  })

  it.each(["added", "missing"])(
    "rejects %s second-build files and restores dist",
    (change) => {
      const fixture = buildFixture()
      if (change === "added") {
        writeFiles(fixture.secondBuild, { "unexpected.txt": "extra\n" })
      } else {
        rmSync(path.join(fixture.secondBuild, "assets/app.js"))
      }
      const outcome = fixture.execute()

      expect(outcome.status, outcome.stderr).toBe(1)
      expect(outcome.stderr).toContain("file sets differ")
      fixture.expectRestored()
    },
  )

  it("restores the first dist when the second build fails after writing partial output", () => {
    const fixture = buildFixture()
    const outcome = fixture.execute(23)

    expect(outcome.status, outcome.stderr).toBe(23)
    expect(outcome.stderr).toContain("fixture second build failed")
    fixture.expectRestored()
  })
})
