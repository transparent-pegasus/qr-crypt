import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  FileCode2,
  LoaderCircle,
  Pause,
  Play,
  Sun,
  TriangleAlert,
  X,
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
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  FRAME_BYTES_STEP,
  FRAME_INTERVAL_MS_DEFAULT,
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_MIN,
  FRAME_INTERVAL_MS_STEP,
  isFrameIntervalMs,
  minimumFrameBytesForArtifact,
} from "@/lib/limits"
import { toAppError } from "@/crypto/errors"
import { formatFramePositions } from "@/features/presentation"
import { env } from "@/schemas/env-schema"
import { QrDisplay } from "@/components/qr-display"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useI18n, useLocalizedMessage, type LocalizedMessage } from "@/i18n"

export interface AnimatedQrFramesProps {
  frames: readonly QrFrameV2[]
  frameIntervalMs: number
  outputName: string
  size?: number
  title?: string
  onFirstRendered?: () => void
  fullscreenEnabled?: boolean
  exportsEnabled?: boolean
  onFrameIntervalMsChange?: (ms: number) => void
  frameBytes?: number
  onFrameBytesChange?: (bytes: number) => void
  splitting?: boolean
  onFullscreenOpenChange?: (open: boolean) => void
  animationSignal?: AbortSignal
}

interface FrameSlot {
  frame: QrFrameV2
  payload: string
}

function currentFrameInterval(value: number): number {
  return isFrameIntervalMs(value) ? value : FRAME_INTERVAL_MS_DEFAULT
}

function transferIdentity(frames: readonly QrFrameV2[]): string {
  const first = frames[0]
  return first === undefined
    ? ""
    : `${Array.from(first.transferId).join(".")}:${first.totalByteLength}:${first.frameCount}`
}

export function AnimatedQrFrames({
  frames,
  frameIntervalMs,
  outputName,
  size = env.qrRenderSize,
  title: titleProp,
  onFirstRendered,
  fullscreenEnabled = true,
  exportsEnabled = true,
  onFrameIntervalMsChange,
  frameBytes,
  onFrameBytesChange,
  splitting = false,
  onFullscreenOpenChange,
  animationSignal,
}: AnimatedQrFramesProps) {
  const { language, t } = useI18n()
  const title = titleProp ?? t("animatedQr.defaultTitle")
  const controlId = useId()
  const speedInputId = `frame-speed-${controlId}`
  const densityInputId = `frame-density-${controlId}`
  const { slots, missingIndexes, frameCount } = useMemo(() => {
    const expected = Math.max(0, ...frames.map((frame) => frame.frameCount))
    const nextSlots = new Map<number, FrameSlot>()
    for (const frame of frames) {
      if (!nextSlots.has(frame.frameIndex)) {
        nextSlots.set(frame.frameIndex, {
          frame,
          payload: encodeFrameToPayload(frame),
        })
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
  const frameGeneration = useMemo(() => transferIdentity(frames), [frames])
  const [cursor, setCursor] = useState({
    generation: frameGeneration,
    position: 0,
  })
  const position = cursor.generation === frameGeneration ? cursor.position : 0
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(() => currentFrameInterval(frameIntervalMs))
  const [fullscreen, setFullscreen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(error)
  const firstRenderedRef = useRef(false)

  const handleRendered = () => {
    if (firstRenderedRef.current) return
    firstRenderedRef.current = true
    onFirstRendered?.()
  }

  const changeFullscreen = (open: boolean) => {
    setFullscreen(open)
    onFullscreenOpenChange?.(open)
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
      if (active) setCursor({ generation: frameGeneration, position: 0 })
    })
    return () => {
      active = false
    }
  }, [availableIndexes.length, frameGeneration, position])
  useEffect(() => {
    if (paused || availableIndexes.length < 2 || animationSignal?.aborted) {
      return
    }
    const timer = window.setInterval(
      () =>
        setCursor((current) => ({
          generation: frameGeneration,
          position:
            ((current.generation === frameGeneration ? current.position : 0) + 1) %
            availableIndexes.length,
        })),
      speed,
    )
    const stopAnimation = () => window.clearInterval(timer)
    animationSignal?.addEventListener("abort", stopAnimation, { once: true })
    return () => {
      stopAnimation()
      animationSignal?.removeEventListener("abort", stopAnimation)
    }
  }, [animationSignal, availableIndexes.length, frameGeneration, paused, speed])

  const currentIndex = availableIndexes[position]
  const current = currentIndex === undefined ? undefined : slots.get(currentIndex)
  const safeName = exportsEnabled ? sanitizeQrFileName(outputName) : ""
  const densityEnabled =
    frameBytes !== undefined && onFrameBytesChange !== undefined && current !== undefined
  const densityMinimum =
    current === undefined
      ? FRAME_BYTES_MIN
      : minimumFrameBytesForArtifact(current.frame.totalByteLength)

  const movePrevious = () =>
    setCursor((current) => ({
      generation: frameGeneration,
      position:
        ((current.generation === frameGeneration ? current.position : 0) -
          1 +
          availableIndexes.length) %
        availableIndexes.length,
    }))
  const moveNext = () =>
    setCursor((current) => ({
      generation: frameGeneration,
      position:
        ((current.generation === frameGeneration ? current.position : 0) + 1) %
        availableIndexes.length,
    }))
  const togglePaused = () => setPaused((value) => !value)
  const changeSpeed = (raw: string) => {
    const nextSpeed = Number(raw)
    if (!isFrameIntervalMs(nextSpeed)) return
    setSpeed(nextSpeed)
    onFrameIntervalMsChange?.(nextSpeed)
  }
  const changeDensity = (raw: string) => {
    if (!densityEnabled) return
    const nextFrameBytes = Number(raw)
    if (
      !Number.isSafeInteger(nextFrameBytes) ||
      nextFrameBytes < densityMinimum ||
      nextFrameBytes > FRAME_BYTES_MAX ||
      (nextFrameBytes - densityMinimum) % FRAME_BYTES_STEP !== 0
    ) {
      return
    }
    onFrameBytesChange(nextFrameBytes)
  }

  const exportAllPng = async () => {
    if (!exportsEnabled) return
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
    if (!exportsEnabled) return
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
    if (!exportsEnabled || !current || currentIndex === undefined) return
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

  const transportControls = (fullscreenControls: boolean) => (
    <div className="flex items-center justify-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-11 min-w-11 cursor-pointer px-3 focus-visible:ring-2 landscape:size-11 landscape:p-0"
        onClick={movePrevious}
        aria-label={t("animatedQr.prev.ariaLabel")}
      >
        <ChevronLeft aria-hidden="true" />
        <span className={fullscreenControls ? "landscape:sr-only" : ""}>
          {t("animatedQr.prev")}
        </span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-11 min-w-28 cursor-pointer px-3 focus-visible:ring-2 landscape:size-11 landscape:min-w-11 landscape:p-0"
        onClick={togglePaused}
        aria-label={t(paused ? "animatedQr.play" : "animatedQr.pause")}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        <span className={fullscreenControls ? "landscape:sr-only" : ""}>
          {t(paused ? "animatedQr.play" : "animatedQr.pause")}
        </span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 min-w-11 cursor-pointer px-3 focus-visible:ring-2 landscape:size-11 landscape:p-0"
        onClick={moveNext}
        aria-label={t("animatedQr.next.ariaLabel")}
      >
        <span className={fullscreenControls ? "landscape:sr-only" : ""}>
          {t("animatedQr.next")}
        </span>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )

  const fullscreenControls = (
    <div
      data-fullscreen-controls
      className="mx-auto flex w-full max-w-md flex-col gap-2 landscape:my-auto landscape:w-[min(42vw,18rem)] landscape:max-h-[300px] landscape:gap-1.5"
    >
      <div className="flex items-center justify-center gap-3">
        <p
          aria-live="polite"
          className="shrink-0 text-center font-mono text-base tabular-nums"
        >
          {currentIndex! + 1} / {frameCount}
        </p>
        {transportControls(true)}
      </div>

      {densityEnabled && (
        <>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <Label htmlFor={densityInputId}>{t("animatedQr.density.label")}</Label>
              <span className="flex items-center gap-1 font-mono text-xs tabular-nums">
                {splitting && (
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                )}
                {frameBytes} B
              </span>
            </div>
            <Input
              id={densityInputId}
              aria-label={t("animatedQr.density.label")}
              type="range"
              min={densityMinimum}
              max={FRAME_BYTES_MAX}
              step={FRAME_BYTES_STEP}
              value={frameBytes}
              onChange={(event) => changeDensity(event.target.value)}
            />
          </div>
          <details className="text-xs text-slate-700">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 focus-visible:ring-2">
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate">{t("animatedQr.density.restartWarning")}</span>
            </summary>
            <p className="pl-5 leading-snug">{t("animatedQr.density.restartDetail")}</p>
          </details>
        </>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3 text-sm">
          <Label htmlFor={speedInputId}>{t("animatedQr.speed.label")}</Label>
          <span className="font-mono text-xs tabular-nums">{speed} ms</span>
        </div>
        <Input
          id={speedInputId}
          aria-label={t("animatedQr.speed.label")}
          type="range"
          min={FRAME_INTERVAL_MS_MIN}
          max={FRAME_INTERVAL_MS_MAX}
          step={FRAME_INTERVAL_MS_STEP}
          value={speed}
          onChange={(event) => changeSpeed(event.target.value)}
        />
      </div>

      <p className="flex min-w-0 items-center justify-center gap-1.5 truncate text-xs text-slate-700">
        <Sun aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{t("animatedQr.brightnessHint")}</span>
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full cursor-pointer border-slate-300 bg-white text-slate-950 focus-visible:ring-2"
        onClick={() => changeFullscreen(false)}
      >
        <X aria-hidden="true" />
        {t("common.close")}
      </Button>
    </div>
  )

  return (
    <section
      aria-label={t("animatedQr.section.ariaLabel", { title })}
      className="space-y-4"
      aria-busy={exporting || splitting}
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
        fullscreenControls={fullscreenControls}
        fullscreenOpen={fullscreen}
        onFullscreenOpenChange={changeFullscreen}
      />

      {!fullscreen && (
        <>
          {transportControls(false)}

          <p aria-live="polite" className="text-center font-mono text-base tabular-nums">
            {currentIndex! + 1} / {frameCount}
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={speedInputId}>{t("animatedQr.speed.label")}</Label>
              <span className="font-mono text-xs tabular-nums">{speed} ms</span>
            </div>
            <Input
              id={speedInputId}
              aria-label={t("animatedQr.speed.label")}
              type="range"
              min={FRAME_INTERVAL_MS_MIN}
              max={FRAME_INTERVAL_MS_MAX}
              step={FRAME_INTERVAL_MS_STEP}
              value={speed}
              onChange={(event) => changeSpeed(event.target.value)}
            />
          </div>

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Sun aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("animatedQr.brightnessHint")}
          </p>

          {exportsEnabled && (
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
          )}
        </>
      )}

      {exportsEnabled && error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("animatedQr.export.error.title")}</AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
