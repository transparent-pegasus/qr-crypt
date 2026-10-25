import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FeatureSupportProvider } from "@/app/feature-support"
import { OnlineRelay } from "@/components/online-relay"
import { LanguageProvider, type Language } from "@/i18n"
import { acquireLocalRelaySession } from "@/relay/local-session"
import { RelayApp } from "@/relay/relay-app"
import { env } from "@/schemas/env-schema"

const readerModuleState = vi.hoisted(() => vi.fn<() => "idle" | "ready">())

vi.mock("@/qr/camera-scan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/camera-scan")>()),
  readerModuleState,
}))

const BUSY_MESSAGE =
  "Another operation is using this device's local storage. Close it, then try again."

const RELAY_DIALOGS = [
  { mode: "capture", button: "QR → Text", title: "QR to text" },
  { mode: "image", button: "QR → QR", title: "QR to QR" },
  { mode: "playback", button: "Text → QR", title: "Turn relay text into QR" },
] as const

function renderRelayApp(initialLanguage: Language = "en") {
  return render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <FeatureSupportProvider
        features={{
          webCrypto: true,
          indexedDb: true,
          camera: true,
          serviceWorker: true,
        }}
      >
        <RelayApp />
      </FeatureSupportProvider>
    </LanguageProvider>,
  )
}

beforeEach(() => {
  readerModuleState.mockReturnValue("ready")
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("relay-only app", () => {
  it("shows the English warning notice before any relay action", () => {
    renderRelayApp()

    const language = screen.getByRole("combobox", { name: "Language" })
    const title = screen.getByRole("heading", { level: 1, name: env.appName })
    const notice = screen.getByRole("note")
    expect(
      within(notice).getByRole("heading", { name: "Before you use this relay" }),
    ).toBeVisible()
    expect(
      within(notice)
        .getAllByRole("paragraph")
        .map((p) => p.textContent),
    ).toEqual([
      "Never install or use this app on a device that holds, or has ever held, QR Crypt keys, identities, or plaintext — including a device with a browser where the QR Crypt offline app is installed. Use a separate online device.",
      "The camera sees everything in its view, not only the QR code.",
      "This app has not been independently audited.",
    ])
    expect(
      language.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    for (const { button } of RELAY_DIALOGS) {
      const action = screen.getByRole("button", { name: button })
      expect(
        notice.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows the Japanese warning notice", () => {
    renderRelayApp("ja")

    const notice = screen.getByRole("note")
    expect(
      within(notice).getByRole("heading", { name: "この中継アプリを使う前に" }),
    ).toBeVisible()
    expect(
      within(notice)
        .getAllByRole("paragraph")
        .map((p) => p.textContent),
    ).toEqual([
      "QR Crypt の鍵、識別子、平文を持つ端末や、過去に持っていた端末には、このアプリを入れたり使ったりしないでください。QR Crypt のオフラインアプリを入れたブラウザーがある端末も含みます。別のオンライン端末を使ってください。",
      "カメラはQRコードだけでなく、写る範囲のすべてを映します。",
      "このアプリは、独立した第三者による監査を受けていません。",
    ])
  })

  it.each([
    {
      language: "en",
      nativeDescription:
        "Pass encrypted messages between a messenger and an offline device using QR codes and text. This app contains no key, decryption, or storage code: nothing is decrypted and no keys are used.",
      scanClaim: "scan finds no keys, PQ identities, or Vault on this device",
      webDescription:
        "Pass encrypted messages between a messenger and an offline device using QR codes and text. This works only while a scan finds no keys, PQ identities, or Vault on this device; nothing is decrypted and no keys are used.",
    },
    {
      language: "ja",
      nativeDescription:
        "QRコードとテキストで、メッセンジャーとオフライン端末の間で暗号化済みメッセージを受け渡します。このアプリには鍵・復号・保存のコードが無く、復号は行わず、鍵も使いません。",
      scanClaim: "走査で鍵・PQ identity・Vaultが無いと確認できた端末でのみ使え",
      webDescription:
        "QRコードとテキストで、メッセンジャーとオフライン端末の間で暗号化済みメッセージを受け渡します。走査で鍵・PQ identity・Vaultが無いと確認できた端末でのみ使え、復号は行わず、鍵も使いません。",
    },
  ] as const)(
    "uses the $language native description while preserving the web default",
    ({ language, nativeDescription, scanClaim, webDescription }) => {
      const app = renderRelayApp(language)

      expect.soft(screen.queryByText(nativeDescription)).toBeVisible()
      expect
        .soft(screen.queryByText(scanClaim, { exact: false }))
        .not.toBeInTheDocument()

      app.unmount()
      render(
        <LanguageProvider initialLanguage={language}>
          <FeatureSupportProvider
            features={{
              webCrypto: true,
              indexedDb: true,
              camera: true,
              serviceWorker: true,
            }}
          >
            <OnlineRelay eligible />
          </FeatureSupportProvider>
        </LanguageProvider>,
      )

      expect(screen.getByText(webDescription)).toBeVisible()
    },
  )

  it.each(RELAY_DIALOGS)(
    "opens capture, image and playback dialogs instead of reporting busy ($mode)",
    async ({ button, title }) => {
      renderRelayApp()
      const user = userEvent.setup()
      expect(screen.queryByText(BUSY_MESSAGE)).not.toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: button }))

      expect(await screen.findByRole("dialog", { name: title })).toBeVisible()
      expect(screen.queryByText(BUSY_MESSAGE)).not.toBeInTheDocument()
    },
  )

  it.each(RELAY_DIALOGS)(
    "reopens a dialog after closing it ($mode)",
    async ({ button, title }) => {
      renderRelayApp()
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: button }))
      expect(await screen.findByRole("dialog", { name: title })).toBeVisible()
      expect(screen.queryByText(BUSY_MESSAGE)).not.toBeInTheDocument()

      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(screen.getByRole("note")).toBeVisible()
      expect(screen.queryByText(BUSY_MESSAGE)).not.toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: button }))

      expect(await screen.findByRole("dialog", { name: title })).toBeVisible()
      expect(screen.queryByText(BUSY_MESSAGE)).not.toBeInTheDocument()
    },
  )

  it("issues no network request on mount", async () => {
    readerModuleState.mockReturnValue("idle")
    renderRelayApp()
    await act(async () => undefined)

    expect(screen.getByRole("note")).toBeVisible()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("acquireLocalRelaySession returns null for an aborted signal and a lease otherwise", async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(acquireLocalRelaySession(aborted.signal)).resolves.toBeNull()

    const active = new AbortController()
    const lease = await acquireLocalRelaySession(active.signal)
    expect(lease).toEqual({ release: expect.any(Function) })
    expect(lease?.release()).toBeUndefined()
    expect(lease?.release()).toBeUndefined()
  })
})
