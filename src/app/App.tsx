import { useMemo } from "react"
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { RouterProvider } from "react-router-dom"
import {
  detectFeatures as detectBrowserFeatures,
  type FeatureSupport,
} from "@/lib/feature-detect"
import { createAppRouter } from "@/app/router"
import { AppProviders, ThemeProvider } from "@/app/providers"
import type { UseRegisterSwHook } from "@/components/pwa-update-prompt"

export interface AppProps {
  detectFeatures?: () => FeatureSupport
  pwaHook?: UseRegisterSwHook
}

function UnsupportedBrowser({ features }: { features: FeatureSupport }) {
  const entries = [
    ["Web Crypto", features.webCrypto],
    ["IndexedDB", features.indexedDb],
    ["カメラ", features.camera],
    ["Service Worker", features.serviceWorker],
  ] as const
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section className="w-full max-w-lg space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-6 shrink-0 text-destructive"
          />
          <div>
            <p className="font-mono text-xs text-muted-foreground">UNSUPPORTED_BROWSER</p>
            <h1 className="text-xl font-bold tracking-tight">
              このブラウザーでは利用できません
            </h1>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          暗号化と端末内保存に必要な機能が不足しています。Web
          CryptoとIndexedDBに対応した最新のブラウザーで開いてください。
        </p>
        <ul aria-label="ブラウザー機能一覧" className="space-y-2">
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
                {supported ? "利用できます" : "利用できません"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export function App({ detectFeatures, pwaHook }: AppProps) {
  const detector = detectFeatures ?? detectBrowserFeatures
  const features = useMemo(() => detector(), [detector])
  const router = useMemo(() => createAppRouter(), [])

  if (!features.webCrypto || !features.indexedDb) {
    return (
      <ThemeProvider>
        <UnsupportedBrowser features={features} />
      </ThemeProvider>
    )
  }

  return (
    <AppProviders features={features} pwaHook={pwaHook}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
