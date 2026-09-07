import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ARCHIVE_NAME,
  ASSET_NAMES,
  BUNDLE_NAME,
  matchingRelease,
  mutationCalls,
  publicationFixture,
  RELEASE_TAG,
  SOURCE_SHA,
  uploadedAssets,
  type PublicationCall,
  type Release,
} from "../fixtures/release-publication"

function expectVerified(calls: PublicationCall[]) {
  expect(calls.some(({ args }) => args[0] === "release" && args[1] === "verify")).toBe(
    true,
  )
  expect(
    calls
      .filter(({ args }) => args[0] === "release" && args[1] === "verify-asset")
      .map(({ args }) => path.basename(args[3]!))
      .sort(),
  ).toEqual([...ASSET_NAMES].sort())
  const verifiers = calls.filter(({ command }) => command === "docker")
  expect(verifiers).toHaveLength(1)
  expect(verifiers[0]!.args).toEqual([
    "run",
    "--rm",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev",
    "--env",
    "HOME=/tmp",
    "--mount",
    expect.stringMatching(/^type=bind,src=.+,dst=\/release,readonly$/),
    `fixture/cosign@sha256:${"f".repeat(64)}`,
    "verify-blob",
    `/release/${ARCHIVE_NAME}`,
    "--bundle",
    `/release/${BUNDLE_NAME}`,
    "--certificate-identity",
    "https://example.invalid/release-workflow",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "--certificate-github-workflow-repository",
    "fixture/repository",
    "--certificate-github-workflow-ref",
    "refs/heads/main",
    "--certificate-github-workflow-sha",
    SOURCE_SHA,
    "--certificate-github-workflow-trigger",
    "push",
  ])
}

const publishedRelease = () =>
  matchingRelease({
    draft: false,
    immutable: true,
    assets: uploadedAssets(ASSET_NAMES),
  })

describe("inline release publication", () => {
  it.each([
    { name: "empty", names: [] },
    { name: "partial", names: ["SHA256SUMS"] },
    { name: "complete", names: ASSET_NAMES },
  ])("recovers a matching draft with $name assets", ({ names }) => {
    const fixture = publicationFixture({
      release: matchingRelease({ assets: uploadedAssets(names) }),
    })
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(0)
    expect(fixture.state().release).toMatchObject({ draft: false, immutable: true })
    expect(fixture.assets()).toEqual(fixture.expectedAssets)
    const mutations = mutationCalls(outcome.calls)
    expect(mutations).toHaveLength(2)
    expect(mutations[0]!.args.slice(0, 3)).toEqual(["release", "upload", RELEASE_TAG])
    expect(mutations[1]!.args.slice(0, 4)).toEqual([
      "api",
      "--method",
      "PATCH",
      "repos/fixture/repository/releases/73",
    ])
    const restRead = outcome.calls.findIndex(
      ({ args }) =>
        args[0] === "api" && args[1] === "repos/fixture/repository/releases/73",
    )
    expect(restRead).toBeGreaterThanOrEqual(0)
    expect(restRead).toBeLessThan(outcome.calls.indexOf(mutations[0]!))
    expectVerified(outcome.calls)
  })

  it.each<{ name: string; change: Partial<Release> }>([
    { name: "another author", change: { author: { login: "untrusted-user" } } },
    { name: "different notes", change: { body: "unreviewed notes\n" } },
    { name: "a different title", change: { name: "unreviewed title" } },
    { name: "a different tag", change: { tag_name: "v0.1.0-other" } },
    { name: "a stable release marker", change: { prerelease: false } },
    { name: "an immutable draft", change: { immutable: true } },
    { name: "an extra asset", change: { assets: uploadedAssets(["unexpected.txt"]) } },
    {
      name: "duplicate asset names",
      change: { assets: uploadedAssets(["SHA256SUMS", "SHA256SUMS"]) },
    },
    {
      name: "an unfinished asset",
      change: { assets: [{ name: ARCHIVE_NAME, state: "starter" }] },
    },
    { name: "an invalid release ID", change: { id: 0 } },
  ])("rejects a draft with $name before mutation", ({ change }) => {
    const fixture = publicationFixture({ release: matchingRelease(change) })
    const initialState = fixture.state()
    const initialAssets = fixture.assets()
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).not.toContain("fixture error")
    expect(mutationCalls(outcome.calls)).toEqual([])
    expect(fixture.state()).toEqual(initialState)
    expect(fixture.assets()).toEqual(initialAssets)
  })

  it.each([
    {
      name: "the REST author changed",
      readOverride: { author: { login: "untrusted-user" } },
    },
    { name: "the REST record is no longer a draft", readOverride: { draft: false } },
  ])("rejects discovery metadata when $name", ({ readOverride }) => {
    const fixture = publicationFixture({ release: matchingRelease(), readOverride })
    const before = fixture.state()
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(mutationCalls(outcome.calls)).toEqual([])
    expect(fixture.state()).toEqual(before)
  })

  it.each([
    { name: "a moved tag", tag: { type: "commit", sha: "2".repeat(40) } },
    { name: "a missing canonical tag", tag: null },
  ])("rejects a draft with $name before mutation", ({ tag }) => {
    const fixture = publicationFixture({ release: matchingRelease(), tag })
    const before = fixture.state()
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(mutationCalls(outcome.calls)).toEqual([])
    expect(fixture.state()).toEqual(before)
  })

  it("requires the immutability acknowledgement before recovering a draft", () => {
    const fixture = publicationFixture({ release: matchingRelease() })
    const outcome = fixture.execute({ IMMUTABILITY_ACKNOWLEDGED: "false" })
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(mutationCalls(outcome.calls)).toEqual([])
  })

  it("verifies a matching published release without mutation or an acknowledgement", () => {
    const fixture = publicationFixture({ release: publishedRelease() })
    const initialState = fixture.state()
    const initialAssets = fixture.assets()
    const outcome = fixture.execute({ IMMUTABILITY_ACKNOWLEDGED: "false" })

    expect(outcome.status, outcome.stderr).toBe(0)
    expect(outcome.stdout).toContain("no release state was mutated")
    expect(mutationCalls(outcome.calls)).toEqual([])
    expect(fixture.state()).toEqual(initialState)
    expect(fixture.assets()).toEqual(initialAssets)
    expectVerified(outcome.calls)
  })

  it("creates, uploads and publishes when both tag and release are absent", () => {
    const fixture = publicationFixture({ release: null, tag: null })
    const outcome = fixture.execute()

    expect(outcome.status, outcome.stderr).toBe(0)
    expect(fixture.state().tag).toEqual({ type: "commit", sha: SOURCE_SHA })
    expect(fixture.state().release).toMatchObject({
      ...publishedRelease(),
      assets: expect.arrayContaining(uploadedAssets(ASSET_NAMES)),
    })
    expect(fixture.assets()).toEqual(fixture.expectedAssets)
    expect(mutationCalls(outcome.calls).map(({ args }) => args.slice(0, 3))).toEqual([
      ["api", "--method", "POST"],
      ["api", "--method", "POST"],
      ["release", "upload", RELEASE_TAG],
      ["api", "--method", "PATCH"],
    ])
    expectVerified(outcome.calls)
  })

  it.each([
    {
      name: "draft",
      release: matchingRelease({ assets: uploadedAssets(["SHA256SUMS"]) }),
    },
    { name: "published", release: publishedRelease() },
  ])("recovers a matching $name release after a create race", ({ release }) => {
    const fixture = publicationFixture({ release: null, createRace: release })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(0)
    expect(fixture.state().release).toMatchObject({ draft: false, immutable: true })
    expect(fixture.assets()).toEqual(fixture.expectedAssets)
    const mutations = mutationCalls(outcome.calls)
    expect(mutations[0]!.args.slice(0, 4)).toEqual([
      "api",
      "--method",
      "POST",
      "repos/fixture/repository/releases",
    ])
    // The failed create is the only write attempt for a published race winner.
    expect(mutations).toHaveLength(release.draft ? 3 : 1)
    expectVerified(outcome.calls)
  })

  it("rejects a mismatched create-race draft without uploading or publishing it", () => {
    const release = matchingRelease({ author: { login: "untrusted-user" } })
    const fixture = publicationFixture({ release: null, createRace: release })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(fixture.state().release).toEqual(release)
    expect(mutationCalls(outcome.calls)).toHaveLength(1)
    expect(mutationCalls(outcome.calls)[0]!.args.slice(0, 3)).toEqual([
      "api",
      "--method",
      "POST",
    ])
  })

  it("fails closed on a release lookup error", () => {
    const fixture = publicationFixture({
      release: matchingRelease(),
      errors: { view: "gh: Internal Server Error (HTTP 500)" },
    })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain("could not determine whether the release exists")
    expect(mutationCalls(outcome.calls)).toEqual([])
  })

  it("fails closed when creation fails without a recoverable release", () => {
    const fixture = publicationFixture({
      release: null,
      errors: { create: "gh: Forbidden (HTTP 403)" },
    })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain(
      "draft creation failed and no recoverable release exists",
    )
    expect(fixture.state().release).toBeNull()
    expect(mutationCalls(outcome.calls)).toHaveLength(1)
  })

  it("leaves a draft unpublished when an upload fails", () => {
    const fixture = publicationFixture({
      release: null,
      errors: { upload: "gh: fixture upload denied (HTTP 403)" },
    })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain("fixture upload denied")
    expect(fixture.state().release).toMatchObject({ draft: true, assets: [] })
    expect(mutationCalls(outcome.calls).some(({ args }) => args.includes("PATCH"))).toBe(
      false,
    )
  })

  it.each([
    {
      name: "GitHub attestation",
      errors: { attestation: "fixture attestation rejected" },
    },
    { name: "Cosign signature", errors: { docker: "fixture signature rejected" } },
  ])("refuses a published release when $name verification fails", ({ errors }) => {
    const fixture = publicationFixture({ release: publishedRelease(), errors })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain("rejected")
    expect(mutationCalls(outcome.calls)).toEqual([])
  })

  it("checks actual downloaded bytes against the checksum", () => {
    const fixture = publicationFixture({
      release: publishedRelease(),
      corruptDownload: ARCHIVE_NAME,
    })
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(1)
    expect(outcome.stderr).toContain("computed checksum did NOT match")
    expect(mutationCalls(outcome.calls)).toEqual([])
    expect(outcome.calls.some(({ command }) => command === "docker")).toBe(false)
  })
})
