import { test, expect } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

test("record relay probe without treating feature failures as harness failures", async ({
  page,
}, testInfo) => {
  const out = fileURLToPath(
    new URL("../out/" + testInfo.project.name + "/", import.meta.url),
  )
  await mkdir(out, { recursive: true })
  const logs: string[] = []
  const errors: string[] = []
  const external: string[] = []
  page.on("console", (message) => logs.push(message.type() + ": " + message.text()))
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://localhost:4179/") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url())
  })
  try {
    const autoDone = page.waitForEvent("console", {
      predicate: (message) => message.text() === "G0R_SIGNAL auto-done",
      timeout: 90000,
    })
    await page.goto("/")
    await autoDone
    await page
      .getByRole("button", { name: "Tap once to test text and PNG clipboard writes" })
      .click()
    await page.waitForFunction(
      () => (window as unknown as { __g0rResult?: unknown }).__g0rResult,
    )
    const result = await page.evaluate(
      () =>
        (
          window as unknown as {
            __g0rResult: { checks: { name: string; ok: boolean }[] }
          }
        ).__g0rResult,
    )
    await writeFile(out + "result.json", JSON.stringify(result, null, 2))
    expect(errors, "Uncaught probe errors").toEqual([])
    expect(external, "All assets must load from the app origin").toEqual([])
    expect(result.checks.some((check) => check.name === "harness")).toBe(false)
    expect(result.checks.map((check) => check.name)).toEqual([
      "secureContext",
      "webLocks",
      "zxing.prepare",
      "fixtures",
      "relay.render.sym",
      "relay.render.pq",
      "roundtrip.sym",
      "roundtrip.pq",
      "relay.playback.parse",
      "relay.playback.animate",
      "camera.api",
      "clipboard.api",
      "clipboard.auto.text",
      "clipboard.auto.image",
      "clipboard.gesture.text",
      "clipboard.gesture.image",
    ])
    // The probe must never acquire a camera before the manual button is tapped.
    expect(
      await page.locator("video").evaluate((video: HTMLVideoElement) => video.srcObject),
    ).toBeNull()
  } finally {
    await page.screenshot({ path: out + "screenshot.png", fullPage: true })
    await writeFile(out + "console.log", logs.join("\n"))
    await writeFile(
      out + "page-errors.json",
      JSON.stringify({ errors, external }, null, 2),
    )
  }
})
