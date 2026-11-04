import { createServer } from "node:http"
import type { CDPSession, Page, Request, Response } from "@playwright/test"
import { classifyDownload, type DownloadEvent } from "./download-candidate"
import type { Inventory } from "./download-io"
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
      try {
        await new Promise<void>((done, fail) => {
          sink.once("error", fail)
          sink.listen(0, "127.0.0.1", done)
        })
        const address = sink.address()
        if (!address || typeof address === "string")
          throw new Error("No owned policy sink")
        const destination = "http://127.0.0.1:" + address.port + "/native-policy"
        const newPages: string[] = []
        const eventLimit = 64
        const requestEvents: unknown[] = []
        let droppedEvents = 0
        const observationStarted = performance.now()
        const observeRequest = (
          event: "request" | "response" | "requestfailed",
          request: Request,
          status: number | null = null,
        ) => {
          if (request.url() !== destination) return
          if (requestEvents.length >= eventLimit) {
            droppedEvents++
            return
          }
          const method = request.method()
          const resourceType = request.resourceType()
          const failure = request.failure()?.errorText ?? null
          // Keep only Chromium error codes; arbitrary failure text may contain private paths.
          const error = failure?.match(/^net::ERR_[A-Z0-9_]{1,96}$/)?.[0] ?? null
          requestEvents.push({
            event,
            elapsedMilliseconds: performance.now() - observationStarted,
            url: request.url(),
            method: method.slice(0, 32),
            resourceType: resourceType.slice(0, 32),
            textTruncated: method.length > 32 || resourceType.length > 32,
            status,
            error,
            errorTextOmitted: failure !== null && failure !== error,
            timing: { ...request.timing() },
          })
        }
        const onPage = (opened: Page) => newPages.push(opened.url())
        const onRequest = (request: Request) => observeRequest("request", request)
        const onResponse = (response: Response) =>
          observeRequest("response", response.request(), response.status())
        const onRequestFailed = (request: Request) =>
          observeRequest("requestfailed", request)
        try {
          context.on("page", onPage)
          context.on("request", onRequest)
          context.on("response", onResponse)
          context.on("requestfailed", onRequestFailed)
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
          ).toEqual(
            operation === "navigation"
              ? [{ url: destination, method: "GET", body: null }]
              : [],
          )
          expect(droppedEvents).toBe(0)
          expect(requestEvents).toEqual(
            (operation === "navigation"
              ? [
                  { event: "request", status: null, error: null },
                  { event: "response", status: 403, error: null },
                  { event: "requestfailed", status: null, error: "net::ERR_ABORTED" },
                ]
              : []
            ).map((event) =>
              expect.objectContaining({
                ...event,
                url: destination,
                method: "GET",
                resourceType: "document",
                textTruncated: false,
                errorTextOmitted: false,
                timing: expect.objectContaining({
                  domainLookupStart: -1,
                  domainLookupEnd: -1,
                  connectStart: -1,
                  connectEnd: -1,
                  secureConnectionStart: -1,
                  requestStart: -1,
                }),
              }),
            ),
          )
        } finally {
          context.off("page", onPage)
          context.off("request", onRequest)
          context.off("response", onResponse)
          context.off("requestfailed", onRequestFailed)
          await testInfo.attach("native-" + operation + "-denial.json", {
            body: Buffer.from(
              JSON.stringify({
                destination,
                observationMilliseconds: 1_000,
                pages: context.pages().map((open) => open.url()),
                newPages,
                hits,
                requests: native.requests,
                passive: { eventLimit, droppedEvents, events: requestEvents },
              }),
            ),
            contentType: "application/json",
          })
        }
      } finally {
        sink.closeAllConnections()
        if (sink.listening)
          await new Promise<void>((done, fail) =>
            sink.close((error) => (error ? fail(error) : done())),
          )
      }
    },
  )
}

test.describe(() => {
  test.use({ prepareDownloads: true })
  test("a trusted blob download cannot complete or save a file in owned storage", async ({
    native,
    page,
    context,
  }, testInfo) => {
    const io = native.downloadDiagnostic
    if (!io) throw new Error("Download diagnostic was not prepared")
    const events: DownloadEvent[] = []
    let droppedEvents = 0
    let evidenceError: unknown | null = null
    let inventoryError: unknown | null = null
    let primary: unknown | null = null
    let blobUrl = ""
    let clickedAtMs = 0
    let observedAtMs = 0
    let before: Inventory | undefined
    let final: Inventory | undefined
    let beforeOriginal: string | undefined
    let beforeMutant: string | undefined
    let session: CDPSession | undefined
    const at = () => performance.now() - io.startedAt
    const append = (event: DownloadEvent) => {
      if (events.length >= 64) {
        droppedEvents++
        return
      }
      if (
        Object.values(event).some(
          (value) =>
            typeof value === "string" &&
            (Buffer.byteLength(value) > 1024 ||
              // eslint-disable-next-line no-control-regex -- Reject raw controls in event evidence.
              /[\u0000-\u001f\u007f-\u009f]/u.test(value)),
        )
      ) {
        evidenceError ??= new Error("Download event field overflow/control")
        return
      }
      if (Buffer.byteLength(JSON.stringify([...events, event])) > 32768) {
        droppedEvents++
        return
      }
      events.push(event)
    }
    const begin = (
      event: Omit<
        Extract<DownloadEvent, { method: "Browser.downloadWillBegin" }>,
        "method" | "atMs"
      >,
    ) =>
      append({
        method: "Browser.downloadWillBegin",
        atMs: at(),
        guid: event.guid,
        url: event.url,
        frameId: event.frameId,
        suggestedFilename: event.suggestedFilename,
      })
    const progress = (
      event: Omit<
        Extract<DownloadEvent, { method: "Browser.downloadProgress" }>,
        "method" | "atMs"
      >,
    ) =>
      append({
        method: "Browser.downloadProgress",
        atMs: at(),
        guid: event.guid,
        state: event.state,
        receivedBytes: event.receivedBytes,
        totalBytes: event.totalBytes,
      })
    const classification = (
      inventory: Inventory | undefined,
      variant: "original" | "mutant",
    ) =>
      classifyDownload({
        variant,
        blobUrl,
        clickedAtMs,
        observedAtMs,
        events: [...events],
        files: inventory?.files ?? [],
        droppedEvents,
        evidenceError,
        inventoryError:
          inventoryError ??
          (inventory?.complete === true && inventory.no_reparse === true
            ? null
            : new Error("Incomplete downloads inventory")),
      })
    const save = async (phase: string, inventory: Inventory | undefined) => {
      await testInfo.attach("native-download-" + phase + ".json", {
        body: Buffer.from(
          JSON.stringify(
            {
              phase,
              blobUrl,
              clickedAtMs,
              observedAtMs,
              events,
              droppedEvents,
              evidenceError:
                evidenceError === null ? null : String(evidenceError).slice(0, 1024),
              inventoryError:
                inventoryError === null ? null : String(inventoryError).slice(0, 1024),
              inventory,
              originalDenial: classification(inventory, "original"),
              mutantPositive: classification(inventory, "mutant"),
            },
            null,
            2,
          ),
        ),
        contentType: "application/json",
      })
    }
    try {
      const browser = context.browser()
      if (!browser) throw new Error("Existing native context has no browser")
      session = await io.run(() => browser.newBrowserCDPSession(), 5000)
      session.on("Browser.downloadWillBegin", begin)
      session.on("Browser.downloadProgress", progress)
      await io.run(
        () =>
          session!.send("Browser.setDownloadBehavior", {
            behavior: "default",
            eventsEnabled: true,
          }),
        5000,
      )
      blobUrl = await io.run(
        () =>
          page.evaluate(() => {
            const anchor = document.createElement("a")
            anchor.textContent = "Inert native download attempt"
            anchor.href = URL.createObjectURL(
              new Blob(["inert native download probe"], { type: "text/plain" }),
            )
            anchor.download = "native-relay-inert-download.txt"
            document.body.append(anchor)
            return anchor.href
          }),
        5000,
      )
      clickedAtMs = at()
      await page
        .getByRole("link", { name: "Inert native download attempt", exact: true })
        .click({ timeout: io.work(15000) })
      // Observe a full second after click and every started GUID's original five-second cancellation window.
      await io.run(() => page.waitForTimeout(1000), 1500)
      while (
        events.some(
          (event) =>
            event.method === "Browser.downloadWillBegin" &&
            !events.some(
              (progress) =>
                progress.method === "Browser.downloadProgress" &&
                progress.guid === event.guid &&
                progress.state !== "inProgress",
            ) &&
            at() - event.atMs < 5000,
        )
      ) {
        await io.run(() => page.waitForTimeout(Math.min(50, io.work(50))), 1000)
      }
      try {
        before = await io.inventory()
      } catch (error) {
        inventoryError = error
      }
      observedAtMs = at()
      beforeOriginal = classification(before, "original")
      beforeMutant = classification(before, "mutant")
      await save("before-assertion", before)
      expect(
        beforeOriginal,
        "NATIVE_DOWNLOAD_DENIAL: same original denial assertion for every EXE",
      ).toBe("denied")
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
    } catch (error) {
      primary = error
    } finally {
      try {
        final = await io.inventory(true)
      } catch (error) {
        inventoryError ??= error
      }
      observedAtMs = at()
      if (session) {
        session.off("Browser.downloadWillBegin", begin)
        session.off("Browser.downloadProgress", progress)
        try {
          await io.run(() => session!.detach(), 2000, true)
        } catch (error) {
          evidenceError ??= error
        }
      }
      await save("finally", final)
      await testInfo.attach("native-download-classifications.json", {
        body: Buffer.from(
          JSON.stringify({
            beforeOriginal,
            beforeMutant,
            finalOriginal: classification(final, "original"),
            finalMutant: classification(final, "mutant"),
            primary: primary === null ? null : String(primary).slice(0, 2048),
          }),
        ),
        contentType: "application/json",
      })
    }
    if (primary !== null) throw primary
    expect(
      classification(final, "original"),
      "NATIVE_DOWNLOAD_DENIAL: final complete inventory",
    ).toBe("denied")
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
