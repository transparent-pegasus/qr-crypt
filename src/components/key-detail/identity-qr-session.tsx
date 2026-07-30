import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import type { IdentityQrView } from "@/components/key-detail/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { formatSuggestedDate } from "@/features/presentation"
import { useFrameSplit } from "@/hooks/use-frame-split"
import { useI18n, useLocalizedMessage } from "@/i18n"
import { effectiveGeneratedDisplay } from "@/lib/generated-display"
import type { Preferences } from "@/schemas/domain"

export interface IdentityQrSessionProps {
  view: IdentityQrView
  title: string
  enabled: boolean
  fullscreenOpen: boolean
  showFullscreenTrigger: boolean
  preferences: Pick<Preferences, "frameBytes" | "frameIntervalMs">
  compatibilityDisabled: boolean
  onCompatibilityModeChange: (enabled: boolean) => void | Promise<void>
  onFirstRendered: () => void
  onFullscreenOpenChange: (open: boolean) => void
}

export function IdentityQrSession({
  view,
  title,
  enabled,
  fullscreenOpen,
  showFullscreenTrigger,
  preferences,
  compatibilityDisabled,
  onCompatibilityModeChange,
  onFirstRendered,
  onFullscreenOpenChange,
}: IdentityQrSessionProps) {
  const { t } = useI18n()
  const frameProfile = effectiveGeneratedDisplay(
    preferences,
    view.artifactBytes.byteLength,
  )
  const split = useFrameSplit({
    bytes: view.artifactBytes,
    artifactType: view.artifactType,
    frameBytes: frameProfile.frameBytes,
    enabled,
    generation: `${view.generation}:${frameProfile.frameBytes}`,
  })
  const localizedError = useLocalizedMessage(split.error)

  return (
    <>
      {split.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("qrDisplay.error.title")}</AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}
      {split.frames.length === 0 && split.splitting && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {t("qrDisplay.generating")}
        </p>
      )}
      {(split.frames.length > 0 || split.splitting) && (
        <AnimatedQrFrames
          frames={split.frames}
          frameIntervalMs={frameProfile.frameIntervalMs}
          densityRaised={frameProfile.densityRaised}
          compatibilityControl={{
            enabled: frameProfile.compatibilityEnabled,
            disabled: compatibilityDisabled,
            onEnabledChange: onCompatibilityModeChange,
          }}
          outputName={t("keyDetail.qr.outputName", {
            title,
            date: formatSuggestedDate(view.generatedAt),
          })}
          title={title}
          splitting={split.splitting}
          fullscreenOpen={fullscreenOpen}
          showFullscreenTrigger={showFullscreenTrigger}
          onFirstRendered={onFirstRendered}
          onFullscreenOpenChange={onFullscreenOpenChange}
        />
      )}
    </>
  )
}
