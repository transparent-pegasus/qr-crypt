import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "@playwright/test"
import {
  artifactBoot,
  DAMAGED_ASSET_ERROR,
  tracePageErrors,
  treeDigests,
} from "../fixtures/artifact-browser"
import { loadOnlineGate, mainNavigation, switchToOfflineApp } from "./helpers"

test("artifact mode boots the selected bytes and rejects a damaged copy while the original still boots", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(360_000)
  // The outer Playwright run has already built dist, or selected an extracted
  // release root. No ZIP or second production build is needed for this test.
  const root = process.env.E2E_ARTIFACT_ROOT ?? path.resolve("dist")
  const temporary = await mkdtemp(path.join(tmpdir(), "qr-crypt-artifact-browser-"))
  const healthyRoot = path.join(temporary, "healthy root")
  const damagedRoot = path.join(temporary, "damaged root")
  const healthyOutput = testInfo.outputPath("artifact-probes", "healthy")
  const damagedOutput = testInfo.outputPath("artifact-probes", "damaged")
  const usedPorts = new Set([Number(new URL(baseURL!).port)])

  try {
    await loadOnlineGate(page, "/")
    const entry = await page
      .locator('script[type="module"][src]')
      .first()
      .getAttribute("src")
    expect(entry).toMatch(/^\/assets\/[^/]+\.js$/)
    const asset = entry!.slice(1)
    const original = await treeDigests(root)
    await cp(root, healthyRoot, { recursive: true })
    await cp(root, damagedRoot, { recursive: true })
    const damagedJavaScript = `throw new Error(${JSON.stringify(DAMAGED_ASSET_ERROR)});\n`
    await writeFile(path.join(damagedRoot, asset), damagedJavaScript)
    expect(await readFile(path.join(damagedRoot, asset), "utf8")).toBe(damagedJavaScript)
    const damaged = await treeDigests(damagedRoot)
    expect(Object.keys(damaged).sort()).toEqual(Object.keys(original).sort())
    expect(
      Object.keys(damaged).filter((name) => damaged[name] !== original[name]),
    ).toEqual([asset])

    // This exact child target excludes this regression, preventing recursion.
    const healthy = await artifactBoot(healthyRoot, healthyOutput, usedPorts)
    const broken = await artifactBoot(damagedRoot, damagedOutput, usedPorts)
    const healthyTrace = await tracePageErrors(healthyOutput)
    const damagedTrace = await tracePageErrors(damagedOutput)

    // Run the checkout/dist control before the negative assertions, so RED also
    // establishes that the original bytes and normal boot remained functional.
    expect(await treeDigests(root)).toEqual(original)
    expect(await treeDigests(healthyRoot)).toEqual(original)
    await loadOnlineGate(page, "/")
    await switchToOfflineApp(page, context)
    await expect(mainNavigation(page).getByRole("link")).toHaveCount(4)
    const evidence = {
      asset,
      originalDigest: original[asset],
      damagedDigest: damaged[asset],
      healthyExit: healthy.code,
      damagedExit: broken.code,
      healthyPort: healthy.port,
      damagedPort: broken.port,
      healthyPageErrors: healthyTrace.pageErrors,
      damagedPageErrors: damagedTrace.pageErrors,
      originalTreeUnchanged: true,
      originalBrowserBooted: true,
    }
    await testInfo.attach("artifact-root-evidence", {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: "application/json",
    })
    for (const [name, result] of [
      ["healthy", healthy],
      ["damaged", broken],
    ] as const) {
      await testInfo.attach(`${name}-probe-log`, {
        body: Buffer.from(`${result.stdout}\n${result.stderr}`),
        contentType: "text/plain",
      })
      expect(result.timedOut, `${name} child exceeded its wall-clock bound`).toBe(false)
      expect(
        result.signal,
        `${name} child was killed rather than reporting a test result`,
      ).toBeNull()
    }
    expect(
      healthy.code,
      `Healthy artifact failed:\n${healthy.stdout}\n${healthy.stderr}`,
    ).toBe(0)
    expect(
      broken.code,
      `Damaged artifact unexpectedly booted; the config served another root.\n${JSON.stringify(evidence)}`,
    ).not.toBe(0)
    expect(
      damagedTrace.pageErrors.some(
        (error) => error.includes(DAMAGED_ASSET_ERROR) && error.includes(asset),
      ),
      "The browser must execute the damaged JavaScript and record its URL in a pageError trace event",
    ).toBe(true)
  } finally {
    await context.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
