import { appendFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  createFixture,
  releaseScript,
  run,
  writeFiles,
  writeStaticDist,
} from "../fixtures/release-fixture"

function closureFixture() {
  const fixture = createFixture()
  writeStaticDist(fixture.root)
  return {
    ...fixture,
    execute: () =>
      run(fixture.root, "node", [releaseScript("validate-static-closure.cjs")]),
  }
}

describe("validate-static-closure.cjs", () => {
  it("silently accepts an origin-root PWA with existing assets, query and fragment URLs", () => {
    const outcome = closureFixture().execute()

    expect(outcome.status, outcome.stderr).toBe(0)
    expect(outcome.stdout).toBe("")
    expect(outcome.stderr).toBe("")
  })

  it.each([
    { name: "missing script", url: "/assets/missing-12345678.js" },
    { name: "parent traversal to an existing file", url: "/../outside.css" },
    { name: "backslash in an existing filename", url: "/assets\\unsafe.js" },
  ])("rejects a $name in the root page", ({ url }) => {
    const fixture = closureFixture()
    writeFiles(fixture.root, {
      "outside.css": "body {}\n",
      "dist/assets\\unsafe.js": "export {};\n",
    })
    appendFileSync(
      path.join(fixture.root, "dist/index.html"),
      `<script src="${url}"></script>`,
    )
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain(`missing or unsafe root-relative asset ${url}`)
  })

  it.each([
    { name: "non-root start URL", change: { start_url: "/app/" }, error: "origin root" },
    { name: "non-root scope", change: { scope: "/app/" }, error: "origin root" },
    { name: "browser display", change: { display: "browser" }, error: "standalone PWA" },
    { name: "no icons", change: { icons: [] }, error: "manifest has no icons" },
    {
      name: "missing icon",
      change: { icons: [{ src: "/icons/missing.png" }] },
      error: "missing or unsafe root-relative asset /icons/missing.png",
    },
  ])("rejects a manifest with $name", ({ change, error }) => {
    const fixture = closureFixture()
    writeFileSync(
      path.join(fixture.root, "dist/manifest.webmanifest"),
      JSON.stringify({
        start_url: "/",
        scope: "/",
        display: "standalone",
        icons: [{ src: "/icons/icon-192.png" }],
        ...change,
      }),
    )
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain(`static closure validation failed:`)
    expect(outcome.stderr).toContain(error)
  })

  it("rejects a manifest that is not JSON", () => {
    const fixture = closureFixture()
    writeFileSync(path.join(fixture.root, "dist/manifest.webmanifest"), "{invalid")
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain("SyntaxError")
  })

  it.each([
    '{url:"reachability-sentinel.txt"}',
    '{"url":"/reachability-sentinel.txt"}',
    "{'url': 'reachability-sentinel.txt'}",
  ])("rejects precaching the reachability sentinel as %s", (entry) => {
    const fixture = closureFixture()
    appendFileSync(
      path.join(fixture.root, "dist/sw.js"),
      `workbox.precaching.precacheAndRoute([${entry}]);\n`,
    )
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain(
      "reachability sentinel is present in the precache manifest",
    )
  })
})
