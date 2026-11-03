import type { JSX } from "react"
import { OnlineRelay } from "@/components/online-relay"
import { LanguageField, useI18n } from "@/i18n"
import { acquireLocalRelaySession } from "./local-session"

export function RelayApp(): JSX.Element {
  const { t } = useI18n()

  return (
    <main
      aria-labelledby="relay-title"
      className="min-h-dvh bg-background text-foreground [padding-block-end:max(1rem,env(safe-area-inset-bottom))] [padding-block-start:max(1rem,env(safe-area-inset-top))] [padding-inline-end:max(1rem,env(safe-area-inset-right))] [padding-inline-start:max(1rem,env(safe-area-inset-left))]"
    >
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <LanguageField />
        <h1 id="relay-title" className="text-2xl font-bold tracking-tight">
          QR Crypt
        </h1>
        <section
          role="note"
          aria-labelledby="relay-notice-title"
          className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-5 text-sm leading-relaxed"
        >
          <h2 id="relay-notice-title" className="font-semibold">
            {t("relay.native.notice.title")}
          </h2>
          <p>{t("relay.native.notice.keys")}</p>
          <p>{t("relay.native.notice.camera")}</p>
          <p>{t("relay.native.notice.audit")}</p>
        </section>
        <OnlineRelay
          eligible
          descriptionKey="relay.native.card.description"
          onSessionAcquire={acquireLocalRelaySession}
        />
      </div>
    </main>
  )
}
