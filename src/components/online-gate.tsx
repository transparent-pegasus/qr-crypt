import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2, Download, Share2, WifiOff } from "lucide-react"
import { useDisplayGate } from "@/app/display-gate"
import { NetworkStatusBadge } from "@/components/network-status"
import { usePwaOfflineReady } from "@/components/pwa-offline-ready"
import { Button } from "@/components/ui/button"
import { LanguageSelect, useI18n, type MessageKey } from "@/i18n"
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
  const { t } = useI18n()
  const { offlineReady, error: registrationError } = usePwaOfflineReady()
  const [installed, setInstalled] = useState(isStandalone)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<MessageKey | null>(null)

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
      setInstallError("gate.install.error")
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
        <div className="flex justify-end">
          <LanguageSelect />
        </div>
        <header className="flex items-center gap-3">
          <img
            src="/icons/icon-192.png"
            alt={t("gate.appIcon.alt", { appName: env.appName })}
            width={56}
            height={56}
            className="size-14 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("gate.mode.label")}
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
              <h2 className="text-lg font-semibold">{t("gate.heading")}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("gate.description")}
              </p>
            </div>
          </div>

          <StatusRow
            label={t("pwa.installState.label")}
            value={
              installed
                ? t("pwa.installState.installed")
                : t("pwa.installState.notInstalled")
            }
            ready={installed}
          />
          <StatusRow
            label={t("pwa.offlineReady.label")}
            value={
              offlineReady
                ? t("pwa.offlineReady.ready")
                : t("pwa.offlineReady.preparing")
            }
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
              {installing ? t("gate.install.progress") : t("gate.install.button")}
            </Button>
          )}

          {!installed && !installPrompt && isIosSafari() && (
            <p className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
              <Share2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t("gate.install.iosHint")}
            </p>
          )}
          {!installed && !installPrompt && !isIosSafari() && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("gate.install.otherHint")}
            </p>
          )}
          {(registrationError || installError) && (
            <p role="alert" className="text-sm text-destructive">
              {t(registrationError ?? installError ?? "gate.install.error")}
            </p>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-5">
          <WifiOff aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <h2 className="font-semibold">{t("gate.switchOffline.title")}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("gate.switchOffline.body")}
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
