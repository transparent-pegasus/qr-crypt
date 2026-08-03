import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const workflowPath = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "github-release.yml",
)

// The helpers under test live inline in the workflow, because the publish job
// deliberately has no checkout to load them from. Indentation is therefore
// whatever the surrounding YAML block happens to use: read it off the opening
// line rather than pinning it, so reformatting the workflow cannot move the
// test boundary.
const extractFunction = (source: string, name: string): string => {
  const lines = source.split("\n")
  const opening = new RegExp(`^(\\s*)${name}\\(\\) \\{$`)
  const start = lines.findIndex((line) => opening.test(line))
  if (start === -1) {
    throw new Error(`HELPER_NOT_FOUND:${name}`)
  }
  const indent = opening.exec(lines[start] as string)?.[1] ?? ""
  const end = lines.findIndex(
    (line, index) => index > start && line === `${indent}}`,
  )
  if (end === -1) {
    throw new Error(`HELPER_UNTERMINATED:${name}`)
  }
  return lines
    .slice(start, end + 1)
    .map((line) => line.slice(indent.length))
    .join("\n")
}

const matchingSha = "1111111111111111111111111111111111111111"
const movedSha = "2222222222222222222222222222222222222222"

interface Outcome {
  code: number | null
  stderr: string
  calls: number
}

// One line of the response plan is consumed per `gh` invocation:
//   ok:<type>:<sha>  print a ref object with that type and sha, exit 0
//   404              print gh's own 404 wording on stderr, exit 1
//   err:<text>       print <text> on stderr, exit 1
const ghStub = (callLog: string, planPath: string): string =>
  [
    "#!/usr/bin/env bash",
    `printf 'call\\n' >> ${JSON.stringify(callLog)}`,
    `count=$(wc -l < ${JSON.stringify(callLog)})`,
    `response=$(sed -n "\${count}p" ${JSON.stringify(planPath)})`,
    'case "$response" in',
    "  ok:*)",
    '    rest="${response#ok:}"',
    '    printf \'{"object":{"type":"%s","sha":"%s"}}\\n\' "${rest%%:*}" "${rest#*:}"',
    "    exit 0",
    "    ;;",
    "  404)",
    "    printf 'gh: Not Found (HTTP 404)\\n' >&2",
    "    exit 1",
    "    ;;",
    "  *)",
    '    printf \'%s\\n\' "${response#err:}" >&2',
    "    exit 1",
    "    ;;",
    "esac",
  ].join("\n")

const runHelper = async (responses: string[]): Promise<Outcome> => {
  const directory = await mkdtemp(path.join(tmpdir(), "qrypt-tag-read-"))
  try {
    const binDirectory = path.join(directory, "bin")
    const callLog = path.join(directory, "calls")
    const planPath = path.join(directory, "plan")
    await mkdir(binDirectory, { recursive: true })
    await writeFile(callLog, "")
    await writeFile(planPath, `${responses.join("\n")}\n`)

    const stubPath = path.join(binDirectory, "gh")
    await writeFile(stubPath, `${ghStub(callLog, planPath)}\n`)
    await chmod(stubPath, 0o755)

    const workflow = await readFile(workflowPath, "utf8")
    const harness = [
      "set -euo pipefail",
      "fail() { printf 'release publication error: %s\\n' \"$*\" >&2; exit 1; }",
      "sleep() { :; }",
      'GITHUB_REPOSITORY="owner/repo"',
      'RELEASE_TAG="v0.1.0-main.gdeadbeef"',
      `SOURCE_SHA=${JSON.stringify(matchingSha)}`,
      `tag_json=${JSON.stringify(path.join(directory, "tag.json"))}`,
      `tag_error=${JSON.stringify(path.join(directory, "tag.error"))}`,
      extractFunction(workflow, "assert_canonical_tag"),
      extractFunction(workflow, "read_canonical_tag"),
      'read_canonical_tag "test"',
    ].join("\n")
    const scriptPath = path.join(directory, "harness.sh")
    await writeFile(scriptPath, `${harness}\n`)

    return await new Promise<Outcome>((resolve, reject) => {
      const child = spawn("bash", [scriptPath], {
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
        },
      })
      let stderr = ""
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.once("error", reject)
      child.once("close", (code) => {
        void readFile(callLog, "utf8").then((log) => {
          resolve({
            code,
            stderr,
            calls: log.split("\n").filter((line) => line.length > 0).length,
          })
        }, reject)
      })
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("read_canonical_tag", () => {
  it("retries through replication lag and then succeeds", async () => {
    const outcome = await runHelper(["404", "404", `ok:commit:${matchingSha}`])
    expect(outcome.code).toBe(0)
    expect(outcome.calls).toBe(3)
  })

  // A readable response that disagrees is a tag move, never lag. It must fail
  // on the first read: a second response is supplied that WOULD satisfy the
  // helper, so any retry turns these into a pass or a call count above one.
  it.each([
    {
      name: "the tag resolves to another commit",
      first: `ok:commit:${movedSha}`,
      expected: "does not resolve",
    },
    {
      name: "the tag is not a lightweight commit tag",
      first: `ok:tag:${matchingSha}`,
      expected: "not a lightweight commit tag",
    },
  ])("fails on the first read when $name", async ({ first, expected }) => {
    const outcome = await runHelper([first, `ok:commit:${matchingSha}`])
    expect(outcome.code).toBe(1)
    expect(outcome.stderr).toContain(expected)
    expect(outcome.calls).toBe(1)
  })

  // Only an explicit HTTP 404 is lag. Anything else fails immediately, even
  // when its text happens to contain the words "Not Found".
  it.each([
    { name: "a server error", first: "err:gh: Internal Server Error (HTTP 500)" },
    { name: "a 500 whose text says Not Found", first: "err:gh: Not Found (HTTP 500)" },
    { name: "a local error mentioning Not Found", first: "err:gh: credential helper file Not Found" },
  ])("fails immediately on $name", async ({ first }) => {
    const outcome = await runHelper([first, `ok:commit:${matchingSha}`])
    expect(outcome.code).toBe(1)
    expect(outcome.stderr).toContain("canonical tag read failed")
    expect(outcome.calls).toBe(1)
  })

  it("gives up after a bounded number of 404s", async () => {
    const outcome = await runHelper([
      "404",
      "404",
      "404",
      "404",
      "404",
      "404",
      `ok:commit:${matchingSha}`,
    ])
    expect(outcome.code).toBe(1)
    expect(outcome.stderr).toContain("did not become readable")
    expect(outcome.calls).toBe(6)
  })
})
