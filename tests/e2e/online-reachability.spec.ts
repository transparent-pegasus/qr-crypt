import { expect, test, type Request } from "@playwright/test"
import { loadOnlineGate, mainNavigation } from "./helpers"

function isDisplayProbe(request: Request): boolean {
  const url = new URL(request.url())
  return (
    request.method() === "HEAD" &&
    url.pathname === "/manifest.webmanifest" &&
    url.searchParams.has("reach")
  )
}

for (const tab of ["Home", "Relay"] as const) {
  test(`online ${tab} survives repeated display HEAD failures after admission`, async ({
    context,
    page,
  }, testInfo) => {
    let failDisplayProbes = false
    let failedProbes = 0
    const failedRequests: string[] = []
    page.on("requestfailed", (request) => {
      if (failDisplayProbes && isDisplayProbe(request)) failedRequests.push(request.url())
    })
    await context.route("**/manifest.webmanifest?reach=*", async (route) => {
      if (failDisplayProbes && isDisplayProbe(route.request())) {
        failedProbes += 1
        await route.abort("failed")
      } else await route.continue()
    })
    // Observe protected-store transactions without opening a database ourselves.
    // Boot and relay admission perform their own legitimate cleanliness reads.
    await page.addInitScript(() => {
      const openedStores: string[] = []
      Object.assign(window, { __reachabilityOpenedStores: openedStores })
      const transaction = IDBDatabase.prototype.transaction
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name === "qr-crypt") {
          const names = typeof args[0] === "string" ? [args[0]] : Array.from(args[0])
          openedStores.push(
            ...names.filter((name) =>
              ["keys", "preferences", "pqIdentities", "pqPublicBundles"].includes(name),
            ),
          )
        }
        return transaction.apply(this, args)
      }
    })
    const now = new Date()
    await page.clock.install({ time: now })
    await page.clock.pauseAt(new Date(now.getTime() + 1_000))
    await loadOnlineGate(page)
    const navigation = page.getByRole("navigation", { name: "Online navigation" })
    await expect(navigation).toBeVisible()
    expect(await page.evaluate(() => navigator.onLine)).toBe(true)
    const playback = page.getByRole("dialog", { name: "Turn relay text into QR" })
    if (tab === "Relay") {
      await page.getByRole("button", { name: "Relay", exact: true }).click()
      await page.getByRole("button", { name: "Text → QR" }).click()
      await expect(playback).toBeVisible()
      await playback.getByLabel("Relay text").fill("relay-session-draft")
    }
    const storesAtAdmission = await page.evaluate(
      () =>
        (window as Window & { __reachabilityOpenedStores?: string[] })
          .__reachabilityOpenedStores,
    )
    expect(storesAtAdmission).toEqual(expect.any(Array))

    let navigationsAfterAdmission = 0
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigationsAfterAdmission += 1
    })
    failDisplayProbes = true
    let virtualElapsedMs = 0
    // Advance until each request has actually failed. Yielding between ticks
    // lets the browser finish routing instead of timing out queued traffic.
    for (let poll = 1; poll <= 3; poll += 1) {
      await expect
        .poll(
          async () => {
            await page.clock.runFor(1_000)
            virtualElapsedMs += 1_000
            return failedRequests.length
          },
          { intervals: [10] },
        )
        .toBeGreaterThanOrEqual(poll)
    }
    await testInfo.attach("display-probe-failures", {
      body: JSON.stringify({ failedProbes, failedRequests, virtualElapsedMs }),
      contentType: "application/json",
    })
    expect(failedProbes).toBeGreaterThanOrEqual(3)
    expect(virtualElapsedMs).toBeGreaterThanOrEqual(12_000)
    expect(await page.evaluate(() => navigator.onLine)).toBe(true)
    expect(navigationsAfterAdmission).toBe(0)
    const openedStores = await page.evaluate(
      () =>
        (window as Window & { __reachabilityOpenedStores?: string[] })
          .__reachabilityOpenedStores,
    )
    expect(openedStores).toEqual(storesAtAdmission)
    await expect(mainNavigation(page)).toHaveCount(0)
    await expect
      .soft(page.getByText("Network connection detected", { exact: true }))
      .toHaveCount(0)
    if (tab === "Home") {
      await expect.soft(navigation).toBeVisible()
      await expect(
        page.getByRole("heading", { name: "Install the PWA", exact: true }),
      ).toBeVisible()
      await page.getByRole("button", { name: "Relay", exact: true }).click()
      await page.getByRole("button", { name: "Text → QR" }).click()
      await expect(playback).toBeVisible()
    } else {
      await expect(playback).toBeVisible()
      await expect(playback.getByLabel("Relay text")).toHaveValue("relay-session-draft")
    }
    await playback.getByLabel("Relay text").fill("invalid relay input")
    await playback.getByRole("button", { name: "Show QR" }).click()
    await expect(
      playback.getByText("Relay input rejected", { exact: true }),
    ).toBeVisible()
    await playback.getByRole("button", { name: "Close", exact: true }).click()
    await expect(navigation).toBeVisible()
    await page.getByRole("button", { name: "Top", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Install the PWA", exact: true }),
    ).toBeVisible()
  })
}
