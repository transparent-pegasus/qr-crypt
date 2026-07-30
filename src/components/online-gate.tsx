import { useEffect, useState, type ReactNode } from "react"
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Home,
  LoaderCircle,
  MessageSquareText,
  Share2,
  WifiOff,
} from "lucide-react"
import { useDisplayGate } from "@/app/display-gate"
import {
  BottomNavigationShell,
  NAV_ITEM_ACTIVE_CLASS,
  NAV_ITEM_CLASS,
} from "@/components/bottom-navigation"
import { NetworkStatusBadge } from "@/components/network-status"
import { OnlineRelay, type OnlineRelayProps } from "@/components/online-relay"
import { usePwaOfflineReady } from "@/components/pwa-offline-ready"
import { Button } from "@/components/ui/button"
import { LanguageField, useI18n, type MessageKey } from "@/i18n"
import { isStandalone } from "@/lib/feature-detect"
import { cn } from "@/lib/utils"
import { env } from "@/schemas/env-schema"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

function isIosSafari(): boolean {
  return (
    /iP(?:hone|ad|od)/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent)
  )
}

const PREPARING_LOADER_DELAY_MS = 1_000

// Mounted only for a preparing episode, so every episode starts from a fresh
// false and only the timer callback ever sets state. Resetting the flag from
// inside an effect would trip react-hooks/set-state-in-effect.
function DelayedSpinner({ label }: { label: string }) {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setElapsed(true),
      PREPARING_LOADER_DELAY_MS,
    )
    return () => window.clearTimeout(timeoutId)
  }, [])
  if (!elapsed) return null
  return <LoaderCircle aria-label={label} className="size-4 animate-spin" />
}

export function OnlineGate({ children }: { children: ReactNode }) {
  const { online } = useDisplayGate()

  return online ? <OnlineInstallScreen relayEligible={false} /> : children
}

export interface OnlineInstallScreenProps {
  relayEligible?: boolean
  onRelayEligibilityRefresh?: OnlineRelayProps["onEligibilityRefresh"]
  registerRelaySessionEndHandler?: OnlineRelayProps["registerRelaySessionEndHandler"]
}

type OnlineTab = "top" | "relay"

const ONLINE_TAB_STORAGE_KEY = "oc-online-tab"

// An online-only device relays and never installs twice, so the last explicit
// tab choice is the better default. Only the two literals are accepted, and the
// oc- prefix keeps the key inside the existing reset sweep. A stored value only
// ever selects a tab the current session is already eligible to show.
function readStoredOnlineTab(): OnlineTab {
  try {
    return window.localStorage.getItem(ONLINE_TAB_STORAGE_KEY) === "relay"
      ? "relay"
      : "top"
  } catch {
    return "top"
  }
}

export function OnlineInstallScreen({
  relayEligible = false,
  onRelayEligibilityRefresh,
  registerRelaySessionEndHandler,
}: OnlineInstallScreenProps = {}) {
  const { t } = useI18n()
  const { offlineReady, error: registrationError } = usePwaOfflineReady()
  const [installed, setInstalled] = useState(isStandalone)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<MessageKey | null>(null)
  // A stored selection is a preference, not a session choice: it takes effect
  // only once relay eligibility is confirmed, so an ineligible gate shows
  // neither the navigation nor, through it, a write path.
  const [storedTab] = useState<OnlineTab>(readStoredOnlineTab)
  const [chosenTab, setChosenTab] = useState<OnlineTab | null>(null)
  const tab: OnlineTab = chosenTab ?? (relayEligible ? storedTab : "top")
  const activeTab: OnlineTab = relayEligible ? tab : "top"
  const navVisible = relayEligible || tab === "relay"

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

  // Persist only an explicit choice, so an untouched gate writes nothing.
  const selectTab = (next: OnlineTab) => {
    setChosenTab(next)
    try {
      window.localStorage.setItem(ONLINE_TAB_STORAGE_KEY, next)
    } catch {
      // Persistence is best-effort; the in-session selection still applies.
    }
  }

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
      className={cn(
        "min-h-dvh bg-background px-4 py-6 text-foreground",
        navVisible && "pb-content-safe",
      )}
    >
      <section className="mx-auto w-full max-w-md space-y-6">
        <LanguageField />
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

        <div hidden={activeTab !== "top"} className="space-y-6">
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
              loading={!offlineReady && registrationError === null}
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

          {/* Opens in a browser tab so an installed standalone window is left
              alone. Online-only surface: this screen never renders offline. */}
          <a
            href="/about/"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium underline-offset-4 hover:underline"
          >
            <ExternalLink aria-hidden="true" className="size-5 shrink-0" />
            {t("gate.about.link")}
          </a>
        </div>

        <div hidden={activeTab !== "relay"}>
          <OnlineRelay
            eligible={relayEligible}
            {...(onRelayEligibilityRefresh
              ? { onEligibilityRefresh: onRelayEligibilityRefresh }
              : {})}
            {...(registerRelaySessionEndHandler
              ? { registerRelaySessionEndHandler }
              : {})}
          />
        </div>
      </section>

      {navVisible && (
        <BottomNavigationShell ariaLabel={t("nav.onlineAriaLabel")}>
          <button
            type="button"
            aria-label={t("nav.top")}
            aria-current={activeTab === "top" ? "page" : undefined}
            className={cn(NAV_ITEM_CLASS, activeTab === "top" && NAV_ITEM_ACTIVE_CLASS)}
            onClick={() => selectTab("top")}
          >
            <Home aria-hidden="true" className="size-6" />
          </button>
          <button
            type="button"
            aria-label={t("nav.relay")}
            aria-current={activeTab === "relay" ? "page" : undefined}
            className={cn(NAV_ITEM_CLASS, activeTab === "relay" && NAV_ITEM_ACTIVE_CLASS)}
            onClick={() => selectTab("relay")}
          >
            <MessageSquareText aria-hidden="true" className="size-6" />
          </button>
        </BottomNavigationShell>
      )}
    </main>
  )
}

function StatusRow({
  label,
  value,
  ready,
  loading = false,
}: {
  label: string
  value: string
  ready: boolean
  loading?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">
        {ready && <CheckCircle2 aria-hidden="true" className="size-4 text-success" />}
        {!ready && loading && <DelayedSpinner label={t("common.loading")} />}
        {value}
      </span>
    </div>
  )
}
