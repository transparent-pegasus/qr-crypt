import { chmodSync, copyFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { createFixture, run, writeFiles } from "./release-fixture"

export const DISPLAYED_SOURCE_SHA = "1234567890abcdef1234567890abcdef12345678"

interface RebuildCall {
  command: string
  args: string[]
  sourceSha: string | null
  buildSha: string | null
}

function rebuildShell(text: string, template: boolean): string {
  if (template) {
    const section = text.slice(text.indexOf("\nREBUILD AND COMPARE"))
    const preparation = section.slice(0, section.search(/\n3\./))
    const start = preparation.indexOf("  set -euo pipefail")
    if (start < 0) throw new Error("Missing executable INSTALL rebuild preparation")
    // INSTALL's commands start at two spaces; prose continuations use three.
    return preparation
      .slice(start)
      .split("\n")
      .filter((line) => line === "" || /^ {2}\S|^ {4}/.test(line))
      .map((line) => line.slice(2))
      .join("\n")
  }
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]!)
  const start = blocks.findIndex(
    (block) => block.includes("set -euo pipefail") && block.includes("QR_CRYPT_CHECKOUT"),
  )
  const build = blocks.findIndex(
    (block, index) => index >= start && block.includes("aube ci"),
  )
  if (start < 0 || build < start)
    throw new Error("Missing executable Route A rebuild preparation")
  return blocks.slice(start, build + 1).join("\n")
}

export function rebuildFixture(text: string, template: boolean) {
  const fixture = createFixture()
  const archiveRoot = path.join(fixture.directory, "extracted archive")
  const bin = path.join(fixture.directory, "bin")
  const script = rebuildShell(text, template)
    // These are the operator's path inputs, supplied through the fixture env.
    .replace(/^export QR_CRYPT_(CHECKOUT|ARCHIVE_ROOT)=.*$/gm, ": # fixture path input")
    // Resolve the BASE document's operator input without rewriting its checks.
    .replaceAll(
      "<independently-authenticated-full-source-commit>",
      '"${QR_CRYPT_EXPECTED_SOURCE_SHA-}"',
    )
  writeFiles(fixture.directory, {
    "rebuild.sh": script,
    "calls.jsonl": "",
    "extracted archive/INSTALL.txt": `Source commit: ${DISPLAYED_SOURCE_SHA}\nRelease tag: v0.1.0-main.g${DISPLAYED_SOURCE_SHA}\n`,
    "bin/git": "",
    "bin/mise": "",
    "bin/aube": "",
  })
  for (const command of ["git", "mise", "aube"]) {
    const target = path.join(bin, command)
    copyFileSync(new URL("./release-rebuild-command.py", import.meta.url), target)
    chmodSync(target, 0o755)
  }
  return {
    execute: (
      expected: string | undefined,
      head = DISPLAYED_SOURCE_SHA,
      source = "f".repeat(40),
    ) => {
      const outcome = run(
        fixture.root,
        "bash",
        [path.join(fixture.directory, "rebuild.sh")],
        {
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          RELEASE_REBUILD_TEST_CALLS: path.join(fixture.directory, "calls.jsonl"),
          RELEASE_REBUILD_TEST_HEAD: head,
          QR_CRYPT_EXPECTED_SOURCE_SHA: expected,
          QR_CRYPT_SOURCE_SHA: source,
          QR_CRYPT_CHECKOUT: fixture.root,
          QR_CRYPT_ARCHIVE_ROOT: archiveRoot,
        },
      )
      const calls = readFileSync(path.join(fixture.directory, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RebuildCall)
      return { ...outcome, calls }
    },
  }
}
