import { createServer } from "node:http"
import { readdir } from "node:fs/promises"
import { APP_ORIGIN, expect, test } from "./native-fixture"

for (const operation of ["navigation", "popup"] as const) {
  test(
    "native policy denies an actual external " +
      operation +
      " without reaching the inert loopback sink",
    async ({ native, page, context }, testInfo) => {
      const hits: { method: string | undefined; path: string | undefined }[] = []
      const sink = createServer((request, response) => {
        hits.push({ method: request.method, path: request.url })
        response.writeHead(200, { "Content-Type": "text/plain" })
        response.end("inert native policy probe")
      })
      await new Promise<void>((done, fail) => {
        sink.once("error", fail)
        sink.listen(0, "127.0.0.1", done)
      })
      const address = sink.address()
      if (!address || typeof address === "string") throw new Error("No owned policy sink")
      const destination = "http://127.0.0.1:" + address.port + "/native-policy"
      const newPages: string[] = []
      context.on("page", (opened) => newPages.push(opened.url()))
      try {
        await page.evaluate(
          ({ destination, operation }) => {
            const anchor = document.createElement("a")
            anchor.textContent = "Inert native policy attempt"
            anchor.href = destination
            if (operation === "popup") anchor.target = "_blank"
            document.body.append(anchor)
          },
          { destination, operation },
        )
        await page
          .getByRole("link", { name: "Inert native policy attempt", exact: true })
          .click({ noWaitAfter: true })
        // Observe the denied operation long enough for a local request or newly created page to surface.
        await page.waitForTimeout(1_000)
        expect(new URL(page.url()).origin).toBe(APP_ORIGIN)
        await expect(
          page.getByRole("heading", { name: "QR Crypt Relay", exact: true }),
        ).toBeVisible()
        expect(context.pages()).toEqual([page])
        expect(newPages).toEqual([])
        expect(hits).toEqual([])
        expect(
          native.requests.filter(
            (request) => new URL(request.url).origin === new URL(destination).origin,
          ),
        ).toEqual([])
        await testInfo.attach("native-" + operation + "-denial.json", {
          body: Buffer.from(
            JSON.stringify({
              destination,
              observationMilliseconds: 1_000,
              pages: context.pages().map((open) => open.url()),
              newPages,
              hits,
              requests: native.requests,
            }),
          ),
          contentType: "application/json",
        })
      } finally {
        sink.closeAllConnections()
        await new Promise<void>((done, fail) =>
          sink.close((error) => (error ? fail(error) : done())),
        )
      }
    },
  )
}

test("a trusted blob download cannot complete or save a file in owned storage", async ({
  native,
  page,
  context,
}, testInfo) => {
  const session = await context.newCDPSession(page)
  const progress: { state: string; receivedBytes: number }[] = []
  const downloads: { url: string; failure: Promise<string | null> }[] = []
  session.on("Browser.downloadProgress", (event) =>
    progress.push({ state: event.state, receivedBytes: event.receivedBytes }),
  )
  await session.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: native.downloads,
    eventsEnabled: true,
  })
  page.on("download", (download) =>
    downloads.push({ url: download.url(), failure: download.failure() }),
  )
  await page.evaluate(() => {
    const anchor = document.createElement("a")
    anchor.textContent = "Inert native download attempt"
    anchor.href = URL.createObjectURL(
      new Blob(["inert native download probe"], { type: "text/plain" }),
    )
    anchor.download = "native-relay-inert-download.txt"
    document.body.append(anchor)
  })
  await page
    .getByRole("link", { name: "Inert native download attempt", exact: true })
    .click()
  await page.waitForTimeout(1_000)
  const failures = await Promise.all(
    downloads.map(async (download) => ({
      url: download.url,
      failure: await Promise.race([
        download.failure,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Native download did not cancel within five seconds")),
            5_000,
          )
          timer.unref()
        }),
      ]),
    })),
  )
  for (const download of failures)
    expect(download.failure).toMatch(/cancel|denied|abort|blocked/i)
  expect(progress.some((event) => event.state === "completed")).toBe(false)
  const files = await readdir(native.downloads, { recursive: true })
  expect(files).toEqual([])
  expect(new URL(page.url()).origin).toBe(APP_ORIGIN)
  expect(context.pages()).toEqual([page])
  expect(
    native.requests.every((request) => {
      const url = new URL(request.url)
      return (
        url.origin === APP_ORIGIN ||
        (url.protocol === "blob:" && url.pathname.startsWith(APP_ORIGIN + "/"))
      )
    }),
  ).toBe(true)
  await testInfo.attach("native-download-denial.json", {
    body: Buffer.from(
      JSON.stringify({
        observationMilliseconds: 1_000,
        progress,
        failures,
        files,
        requests: native.requests,
      }),
    ),
    contentType: "application/json",
  })
})

type InvokeWindow = Window & {
  __TAURI_INTERNALS__?: { invoke?: (command: string) => Promise<unknown> }
}

test("the real internal Tauri invoke entry denies an existing core application command", async ({
  native,
  page,
}, testInfo) => {
  const result = await page.evaluate(async () => {
    const internal = (window as InvokeWindow).__TAURI_INTERNALS__
    if (typeof internal?.invoke !== "function") {
      throw new Error(
        "Native ACL oracle unavailable: actual __TAURI_INTERNALS__.invoke entry is absent",
      )
    }
    return Promise.race([
      internal.invoke("plugin:app|version").then(
        (value) => ({ kind: "allowed", detail: String(value) }),
        (error: unknown) => ({ kind: "denied", detail: String(error) }),
      ),
      new Promise<{ kind: string; detail: string }>((done) =>
        setTimeout(
          () =>
            done({
              kind: "timeout",
              detail: "No actual IPC response within five seconds",
            }),
          5_000,
        ),
      ),
    ])
  })
  expect(result.kind).toBe("denied")
  expect(result.detail).toMatch(/not allowed|denied|forbidden|permission/i)
  expect(result.detail).toMatch(/app[.:|]version|app:allow-version/i)
  await testInfo.attach("native-runtime-ACL.json", {
    body: Buffer.from(
      JSON.stringify({
        entry: "__TAURI_INTERNALS__.invoke",
        command: "plugin:app|version",
        result,
        requests: native.requests,
      }),
    ),
    contentType: "application/json",
  })
})
