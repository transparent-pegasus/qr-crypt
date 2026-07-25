import { useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { LanguageToggle, useI18n } from "@/i18n"

export interface OfflineAckShellProps {
  generation: number
  onContinue: (generation: number) => boolean
  variant?: "standard" | "wiped"
}

export function OfflineAckShell({
  generation,
  onContinue,
  variant = "standard",
}: OfflineAckShellProps) {
  const { t } = useI18n()
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const checkboxId = `offline-risk-ack-${generation}`
  const wiped = variant === "wiped"

  const continueOffline = () => {
    if (!checked || submitting) return
    setSubmitting(true)
    if (!onContinue(generation)) {
      setChecked(false)
      setSubmitting(false)
    }
  }

  return (
    <main
      aria-labelledby="offline-ack-title"
      className="fixed inset-0 max-h-dvh overflow-y-auto bg-background text-foreground [padding-block-end:max(1rem,env(safe-area-inset-bottom))] [padding-block-start:max(1rem,env(safe-area-inset-top))] [padding-inline-end:max(1rem,env(safe-area-inset-right))] [padding-inline-start:max(1rem,env(safe-area-inset-left))]"
    >
      <section className="mx-auto w-full max-w-2xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            {t("language.field")}
          </span>
          <LanguageToggle />
        </div>
        {wiped && (
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-success"
              />
              <div className="space-y-1">
                <h2 className="font-semibold">{t("boot.wiped.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("boot.wiped.body")}
                </p>
              </div>
            </div>
          </div>
        )}

        <header className="flex items-center gap-4">
          <AlertTriangle
            aria-hidden="true"
            className="size-11 shrink-0 text-warning sm:size-12"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p role="status" className="text-xs font-medium text-muted-foreground">
                {t("offlineAck.status")}
              </p>
            <h1
              id="offline-ack-title"
              className="text-xl font-bold tracking-tight sm:text-2xl"
            >
              {t("offlineAck.title")}
            </h1>
          </div>
        </header>

        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>{t("offlineAck.body.assumption")}</p>
          <p>
            {t("offlineAck.body.riskPrefix")}
            <strong className="font-semibold text-foreground">
              {t("offlineAck.body.neverReconnect")}
            </strong>
            {t("offlineAck.body.riskSuffix")}
            <strong className="font-semibold text-foreground">
              {t("offlineAck.body.noGuarantee")}
            </strong>
          </p>
        </div>

        <div className="space-y-1 rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id={checkboxId}
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
              className="mt-0.5 size-5"
            />
            <label
              htmlFor={checkboxId}
              className="cursor-pointer text-sm leading-relaxed"
            >
              {t("offlineAck.ackLabel")}
            </label>
          </div>
          <p className="pl-8 text-xs leading-relaxed text-muted-foreground">
            {t("offlineAck.ackHint")}
          </p>
        </div>

        <Button
          type="button"
          className="h-11 w-full whitespace-normal"
          disabled={!checked || submitting}
          onClick={continueOffline}
        >
          {wiped ? t("offlineAck.reload") : t("offlineAck.continue")}
        </Button>
      </section>
    </main>
  )
}
