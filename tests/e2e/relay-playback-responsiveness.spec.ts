import { expect, test } from "@playwright/test"
import { syntheticRelayPlayback } from "../fixtures/relay-playback"
import { loadOnlineGate } from "./helpers"

interface RelayProgressWindow extends Window {
  relayPlaybackProgress: { renders: number; rendersAtTimer: number | null }
}

test("a real timer progresses between preflight renders and all 128 frames remain playable", async ({
  page,
}) => {
  await loadOnlineGate(page)
  await page.getByRole("button", { name: "Relay", exact: true }).click()
  await page.getByRole("button", { name: "Text → QR" }).click()
  const dialog = page.getByRole("dialog", { name: "Turn relay text into QR" })
  await dialog.getByLabel("Relay text").fill(syntheticRelayPlayback(128).text)

  // Observe the real browser canvas boundary, keeping the renderer and the UI
  // intact. This uses no development module and also works on packaged bytes.
  await page.evaluate(() => {
    const progress = { renders: 0, rendersAtTimer: null as number | null }
    ;(window as unknown as RelayProgressWindow).relayPlaybackProgress = progress
    const original = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      progress.renders += 1
      if (progress.renders === 1) {
        setTimeout(() => {
          progress.rendersAtTimer = progress.renders
        }, 0)
      }
      return original.apply(this, args)
    }
  })

  await dialog.getByRole("button", { name: "Show QR" }).click()
  await expect(dialog.getByRole("img")).toBeVisible()
  await expect(dialog.getByText(/^\d+ \/ 128$/)).toBeVisible()
  const progress = await page.evaluate(
    () => (window as unknown as RelayProgressWindow).relayPlaybackProgress,
  )
  expect(progress.rendersAtTimer).toBe(1)
  expect(progress.renders).toBeGreaterThanOrEqual(129)
})
