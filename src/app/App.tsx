import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { RouterProvider } from "react-router"
import { getDefaultBootController, type BootController } from "@/app/boot/boot-controller"
import { useBootState } from "@/app/boot/use-boot-state"
import { useDisplayGate } from "@/app/display-gate"
import {
  detectFeatures as detectBrowserFeatures,
  type FeatureSupport,
} from "@/lib/feature-detect"
import { createAppRouter } from "@/app/router"
import { AppProviders, ThemeProvider, useSensitiveSession } from "@/app/providers"
import { OnlineGate, OnlineInstallScreen } from "@/components/online-gate"
import { OfflineAckShell } from "@/components/offline-ack-shell"
import type { UseRegisterSwHook } from "@/components/pwa-offline-ready"
import {
  LanguageProvider,
  LanguageSelect,
  useI18n,
  type Language,
} from "@/i18n"

export interface AppProps {
  bootController?: BootController
  detectFeatures?: () => FeatureSupport
  initialLanguage?: Language
  pwaHook?: UseRegisterSwHook
  reloadPage?: () => void
  routerFactory?: typeof createAppRouter
}

function UnsupportedBrowser({ features }: { features: FeatureSupport }) {
  const { t } = useI18n()
  const entries = [
    ["Web Crypto", features.webCrypto],
    ["IndexedDB", features.indexedDb],
    [t("feature.camera"), features.camera],
    ["Service Worker", features.serviceWorker],
  ] as const
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section className="w-full max-w-lg space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex justify-end">
          <LanguageSelect />
        </div>
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-6 shrink-0 text-destructive"
          />
          <div>
            <p className="font-mono text-xs text-muted-foreground">UNSUPPORTED_BROWSER</p>
            <h1 className="text-xl font-bold tracking-tight">
              {t("browser.unsupported.title")}
            </h1>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("browser.unsupported.body")}
        </p>
        <ul aria-label={t("browser.featureList.ariaLabel")} className="space-y-2">
          {entries.map(([label, supported]) => (
            <li
              key={label}
              className="flex min-h-11 items-center gap-2 rounded-md border px-3"
            >
              {supported ? (
                <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
              ) : (
                <XCircle aria-hidden="true" className="size-4 text-destructive" />
              )}
              <span>{label}</span>
              <span className="ml-auto text-sm text-muted-foreground">
                {supported ? t("common.supported.yes") : t("common.supported.no")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function BootStatusScreen({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section className="w-full max-w-md space-y-3 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex justify-end">
          <LanguageSelect />
        </div>
        {children}
      </section>
    </main>
  )
}

function OfflineApplication({
  routerFactory,
}: {
  routerFactory: typeof createAppRouter
}) {
  const router = useMemo(() => routerFactory(), [routerFactory])
  return (
    <OnlineGate>
      <RouterProvider router={router} />
    </OnlineGate>
  )
}

function BootGate({
  controller,
  reloadPage,
  routerFactory,
}: {
  controller: BootController | undefined
  reloadPage: () => void
  routerFactory: typeof createAppRouter
}) {
  const { t } = useI18n()
  const display = useDisplayGate()
  const { clearTransientForOnlineEpisode } = display
  const { resetSensitiveSession } = useSensitiveSession()
  const resolvedController = controller ?? getDefaultBootController()
  const resetTransient = useCallback(() => {
    clearTransientForOnlineEpisode()
    resetSensitiveSession()
  }, [clearTransientForOnlineEpisode, resetSensitiveSession])
  const state = useBootState({
    controller: resolvedController,
    resetTransient,
  })
  const nudgedDisplayGeneration = useRef<number | null>(null)
  const reconciledOnlineGeneration = useRef<number | null>(null)

  useEffect(() => {
    if (
      !display.online &&
      display.sessionSawCommittedOnline &&
      nudgedDisplayGeneration.current !== display.offlineGeneration &&
      resolvedController.nudgeDisplayOffline()
    ) {
      // Only a successful controller-side atomic transition is consumed.
      nudgedDisplayGeneration.current = display.offlineGeneration
    }
  }, [
    display.offlineGeneration,
    display.online,
    display.sessionSawCommittedOnline,
    resolvedController,
    state.kind,
  ])

  useEffect(() => {
    if (
      !display.online ||
      state.kind !== "offline-confirmed" ||
      reconciledOnlineGeneration.current === display.offlineGeneration
    ) {
      return
    }

    // Let a simultaneously delivered display-offline commit settle first. It
    // prevents the old online snapshot from turning the same offline edge back
    // into a sentinel probe. A genuine online re-commit remains eligible.
    const generation = display.offlineGeneration
    const timeoutId = window.setTimeout(() => {
      reconciledOnlineGeneration.current = generation
      void resolvedController.probe()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [display.offlineGeneration, display.online, resolvedController, state.kind])
  const routerEligible =
    state.kind === "offline-confirmed" &&
    !display.online &&
    (display.coldOffline || display.acceptedGeneration === display.offlineGeneration)

  const acceptOfflineRisk = (generation: number) => display.acceptOfflineRisk(generation)
  const reloadAfterWipe = (generation: number) => {
    if (!display.acceptOfflineRisk(generation)) return false
    reloadPage()
    return true
  }

  switch (state.kind) {
    case "unknown":
    case "probing":
      return (
        <BootStatusScreen>
          <p role="status" className="text-sm text-muted-foreground">
            {t("boot.probing.status")}
          </p>
        </BootStatusScreen>
      )
    case "offline-confirmed":
      if (display.online) return <OnlineInstallScreen />
      if (routerEligible) {
        return <OfflineApplication routerFactory={routerFactory} />
      }
      return (
        <OfflineAckShell
          key={display.offlineGeneration}
          generation={display.offlineGeneration}
          onContinue={acceptOfflineRisk}
        />
      )
    case "network-confirmed":
      return <OnlineInstallScreen />
    case "wiping":
      return (
        <BootStatusScreen>
          <h1 className="text-xl font-bold">{t("boot.wiping.title")}</h1>
          <p role="status" className="text-sm text-muted-foreground">
            {t("boot.wiping.body")}
          </p>
        </BootStatusScreen>
      )
    case "wiped":
      if (!display.online && display.ackPending) {
        return (
          <OfflineAckShell
            key={display.offlineGeneration}
            generation={display.offlineGeneration}
            onContinue={reloadAfterWipe}
            variant="wiped"
          />
        )
      }
      return (
        <BootStatusScreen>
          <h1 className="text-xl font-bold">{t("boot.wiped.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("boot.wiped.body")}</p>
        </BootStatusScreen>
      )
    case "partial-failure":
      return (
        <BootStatusScreen>
          <p className="font-mono text-xs text-destructive">RESET_FAILED</p>
          <h1 className="text-xl font-bold">{t("errors.RESET_FAILED")}</h1>
          <p className="text-sm text-muted-foreground">{t("boot.wiped.body")}</p>
          <p className="text-sm text-muted-foreground">
            {t("boot.partialFailure.retryHint")}
          </p>
        </BootStatusScreen>
      )
  }
}

function reloadCurrentPage(): void {
  window.location.reload()
}

function AppContent({
  bootController,
  detectFeatures,
  pwaHook,
  reloadPage = reloadCurrentPage,
  routerFactory = createAppRouter,
}: Omit<AppProps, "initialLanguage">) {
  const detector = detectFeatures ?? detectBrowserFeatures
  const features = useMemo(() => detector(), [detector])

  if (!features.webCrypto || !features.indexedDb) {
    return (
      <ThemeProvider>
        <UnsupportedBrowser features={features} />
      </ThemeProvider>
    )
  }

  return (
    <AppProviders features={features} pwaHook={pwaHook}>
      <BootGate
        controller={bootController}
        reloadPage={reloadPage}
        routerFactory={routerFactory}
      />
    </AppProviders>
  )
}

export function App({ initialLanguage, ...props }: AppProps) {
  return (
    <LanguageProvider
      {...(initialLanguage === undefined ? {} : { initialLanguage })}
    >
      <AppContent {...props} />
    </LanguageProvider>
  )
}
