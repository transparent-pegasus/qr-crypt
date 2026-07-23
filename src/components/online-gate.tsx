import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2, Download, Plane, Share2 } from "lucide-react"
import { useDisplayGate } from "@/app/display-gate"
import { NetworkStatusBadge } from "@/components/network-status"
import { usePwaOfflineReady } from "@/components/pwa-offline-ready"
import { Button } from "@/components/ui/button"
import { env } from "@/schemas/env-schema"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  )
}

function isIosSafari(): boolean {
  return (
    /iP(?:hone|ad|od)/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent)
  )
}

export function OnlineGate({ children }: { children: ReactNode }) {
  const { online } = useDisplayGate()

  return online ? <OnlineInstallScreen /> : children
}

export function OnlineInstallScreen() {
  const { offlineReady, error: registrationError } = usePwaOfflineReady()
  const [installed, setInstalled] = useState(isStandalone)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const markInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener("beforeinstallprompt", capturePrompt)
    window.addEventListener("appinstalled", markInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt)
      window.removeEventListener("appinstalled", markInstalled)
    }
  }, [])

  const requestInstall = async () => {
    if (!installPrompt || installing) return
    setInstalling(true)
    setInstallError(null)
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallPrompt(null)
      if (choice.outcome === "accepted") setInstalled(true)
    } catch {
      setInstallError(
        "インストールを開始できませんでした。ブラウザーのメニューから操作してください。",
      )
    } finally {
      setInstalling(false)
    }
  }

  return (
    <main
      aria-labelledby="online-gate-title"
      className="min-h-dvh bg-background px-4 py-6 text-foreground"
    >
      <section className="mx-auto w-full max-w-md space-y-6">
        <header className="flex items-center gap-3">
          <img
            src="/icons/icon-192.png"
            alt={`${env.appName}のアプリアイコン`}
            width={56}
            height={56}
            className="size-14 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              オンライン導入モード
            </p>
            <h1 id="online-gate-title" className="truncate text-2xl font-bold">
              {env.appName}
            </h1>
          </div>
          <NetworkStatusBadge />
        </header>

        <div className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Download aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">
                オンラインではPWAの導入のみ利用できます
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                暗号化・復号・鍵管理・保存済みQR・設定はオフライン時だけ表示します。
              </p>
            </div>
          </div>

          <StatusRow
            label="PWAインストール状態"
            value={installed ? "インストール済み" : "未インストール"}
            ready={installed}
          />
          <StatusRow
            label="オフライン利用準備状態"
            value={offlineReady ? "準備完了" : "準備中"}
            ready={offlineReady}
          />

          {!installed && installPrompt && (
            <Button
              type="button"
              className="h-11 w-full cursor-pointer focus-visible:ring-2"
              disabled={installing}
              onClick={() => void requestInstall()}
            >
              <Download aria-hidden="true" />
              {installing ? "インストール中…" : "PWAをインストール"}
            </Button>
          )}

          {!installed && !installPrompt && isIosSafari() && (
            <p className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
              <Share2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              Safariの共有メニューから「ホーム画面に追加」を選んでください。
            </p>
          )}
          {!installed && !installPrompt && !isIosSafari() && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              ブラウザーのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。
            </p>
          )}
          {(registrationError || installError) && (
            <p role="alert" className="text-sm text-destructive">
              {registrationError ?? installError}
            </p>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-5">
          <Plane aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <h2 className="font-semibold">機内モードへ切り替えてください</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              機内モードなどでオフラインに切り替えるとオフライン機能を利用できます。切替時にリスク確認が表示されます。オフライン化は端末の安全性を証明しません。
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}

function StatusRow({
  label,
  value,
  ready,
}: {
  label: string
  value: string
  ready: boolean
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">
        {ready && <CheckCircle2 aria-hidden="true" className="size-4 text-success" />}
        {value}
      </span>
    </div>
  )
}
