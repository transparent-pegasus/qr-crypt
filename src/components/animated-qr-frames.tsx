import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  FileCode2,
  Pause,
  Play,
  Sun,
} from "lucide-react"
import type { QrFrameV2 } from "@/schemas/domain"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import {
  qrPngBlob,
  qrSvgBlob,
  sanitizeQrFileName,
  triggerDownload,
} from "@/qr/export-image"
import { storeOnlyZip } from "@/lib/best-effort-zip"
import {
  FRAME_INTERVAL_MS_DEFAULT,
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_MIN,
  FRAME_INTERVAL_MS_STEP,
  isFrameIntervalMs,
} from "@/lib/limits"
import { toAppError } from "@/crypto/errors"
import { formatFramePositions } from "@/features/presentation"
import { env } from "@/schemas/env-schema"
import { QrDisplay } from "@/components/qr-display"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"

export interface AnimatedQrFramesProps {
  frames: readonly QrFrameV2[]
  frameIntervalMs: number
  outputName: string
  size?: number
  title?: string
  onFirstRendered?: () => void
  fullscreenEnabled?: boolean
}

interface FrameSlot {
  frame: QrFrameV2
  payload: string
}

function currentFrameInterval(value: number): number {
  return isFrameIntervalMs(value) ? value : FRAME_INTERVAL_MS_DEFAULT
}

export function AnimatedQrFrames({
  frames,
  frameIntervalMs,
  outputName,
  size = env.qrRenderSize,
  title: titleProp,
  onFirstRendered,
  fullscreenEnabled = true,
}: AnimatedQrFramesProps) {
  const { language, t } = useI18n()
  const title = titleProp ?? t("animatedQr.defaultTitle")
  const { slots, missingIndexes, frameCount } = useMemo(() => {
    const expected = Math.max(0, ...frames.map((frame) => frame.frameCount))
    const nextSlots = new Map<number, FrameSlot>()
    for (const frame of frames) {
      if (!nextSlots.has(frame.frameIndex)) {
        nextSlots.set(frame.frameIndex, { frame, payload: encodeFrameToPayload(frame) })
      }
    }
    const missing: number[] = []
    for (let index = 0; index < expected; index += 1) {
      if (!nextSlots.has(index)) missing.push(index)
    }
    return { slots: nextSlots, missingIndexes: missing, frameCount: expected }
  }, [frames])
  const availableIndexes = useMemo(
    () => [...slots.keys()].sort((left, right) => left - right),
    [slots],
  )
  const [position, setPosition] = useState(0)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(() => currentFrameInterval(frameIntervalMs))
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(error)
  const firstRenderedRef = useRef(false)

  const handleRendered = () => {
    if (firstRenderedRef.current) return
    firstRenderedRef.current = true
    onFirstRendered?.()
  }

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setSpeed(currentFrameInterval(frameIntervalMs))
    })
    return () => {
      active = false
    }
  }, [frameIntervalMs])
  useEffect(() => {
    if (position < availableIndexes.length) return
    let active = true
    queueMicrotask(() => {
      if (active) setPosition(0)
    })
    return () => {
      active = false
    }
  }, [availableIndexes.length, position])
  useEffect(() => {
    if (paused || availableIndexes.length < 2) return
    const timer = window.setInterval(
      () => setPosition((value) => (value + 1) % availableIndexes.length),
      speed,
    )
    return () => window.clearInterval(timer)
  }, [availableIndexes.length, paused, speed])

  const currentIndex = availableIndexes[position]
  const current = currentIndex === undefined ? undefined : slots.get(currentIndex)
  const safeName = sanitizeQrFileName(outputName)

  const exportAllPng = async () => {
    setExporting(true)
    setError(null)
    try {
      for (const index of availableIndexes) {
        const slot = slots.get(index)
        if (!slot) continue
        const blob = await qrPngBlob(slot.payload, { ecLevel: "Q", size })
        triggerDownload(
          blob,
          `${safeName}-frame-${String(index + 1).padStart(2, "0")}.png`,
        )
      }
    } catch (caught) {
        setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      setExporting(false)
    }
  }

  const exportZip = async () => {
    setExporting(true)
    setError(null)
    try {
      const entries = await Promise.all(
        availableIndexes.map(async (index) => {
          const slot = slots.get(index)!
          const blob = await qrPngBlob(slot.payload, { ecLevel: "Q", size })
          return {
            name: `frame-${String(index + 1).padStart(2, "0")}.png`,
            data: new Uint8Array(await blob.arrayBuffer()),
          }
        }),
      )
      triggerDownload(storeOnlyZip(entries), `${safeName}-frames.zip`)
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      setExporting(false)
    }
  }

  const exportSvg = async () => {
    if (!current || currentIndex === undefined) return
    setExporting(true)
    setError(null)
    try {
      const blob = await qrSvgBlob(current.payload, { ecLevel: "Q" })
      triggerDownload(
        blob,
        `${safeName}-frame-${String(currentIndex + 1).padStart(2, "0")}.svg`,
      )
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      setExporting(false)
    }
  }

  if (!current || frameCount === 0) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>{t("animatedQr.empty.title")}</AlertTitle>
        <AlertDescription>{t("animatedQr.empty.body")}</AlertDescription>
      </Alert>
    )
  }

  return (
    <section
      aria-label={t("animatedQr.section.ariaLabel", { title })}
      className="space-y-4"
      aria-busy={exporting}
    >
      {missingIndexes.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("animatedQr.missing.title")}</AlertTitle>
          <AlertDescription>
            {t("animatedQr.missing.body", {
              indexes: formatFramePositions(missingIndexes, language),
            })}
          </AlertDescription>
        </Alert>
      )}

      <QrDisplay
        payload={current.payload}
        ecLevel="Q"
        size={size}
        title={t("animatedQr.frameTitle", {
          title,
          current: currentIndex! + 1,
          total: frameCount,
        })}
        onRendered={handleRendered}
        fullscreenEnabled={fullscreenEnabled}
      />

      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer focus-visible:ring-2"
          onClick={() =>
            setPosition(
              (value) => (value - 1 + availableIndexes.length) % availableIndexes.length,
            )
          }
          aria-label={t("animatedQr.prev.ariaLabel")}
        >
          <ChevronLeft aria-hidden="true" />
          {t("animatedQr.prev")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-11 min-w-28 cursor-pointer focus-visible:ring-2"
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {t(paused ? "animatedQr.play" : "animatedQr.pause")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer focus-visible:ring-2"
          onClick={() => setPosition((value) => (value + 1) % availableIndexes.length)}
          aria-label={t("animatedQr.next.ariaLabel")}
        >
          {t("animatedQr.next")}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <p aria-live="polite" className="text-center font-mono text-base tabular-nums">
        {currentIndex! + 1} / {frameCount}
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="frame-speed">{t("animatedQr.speed.label")}</Label>
          <span className="font-mono text-xs tabular-nums">{speed} ms</span>
        </div>
        <Input
          id="frame-speed"
          aria-label={t("animatedQr.speed.label")}
          type="range"
          min={FRAME_INTERVAL_MS_MIN}
          max={FRAME_INTERVAL_MS_MAX}
          step={FRAME_INTERVAL_MS_STEP}
          value={speed}
          onChange={(event) => {
            const nextSpeed = Number(event.target.value)
            if (isFrameIntervalMs(nextSpeed)) setSpeed(nextSpeed)
          }}
        />
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Sun aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("animatedQr.brightnessHint")}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer focus-visible:ring-2"
          disabled={exporting || missingIndexes.length > 0}
          onClick={() => void exportAllPng()}
        >
          <Download aria-hidden="true" />
          {t("animatedQr.export.allPng")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer focus-visible:ring-2"
          disabled={exporting || missingIndexes.length > 0}
          onClick={() => void exportZip()}
        >
          <FileArchive aria-hidden="true" />
          {t("animatedQr.export.zip")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer focus-visible:ring-2"
          disabled={exporting}
          onClick={() => void exportSvg()}
        >
          <FileCode2 aria-hidden="true" />
          {t("animatedQr.export.currentSvg")}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("animatedQr.export.error.title")}</AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
