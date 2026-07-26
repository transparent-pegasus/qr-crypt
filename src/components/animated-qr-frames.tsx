import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  Sun,
  TriangleAlert,
} from "lucide-react"
import type { QrFrameV2 } from "@/schemas/domain"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import { qrPngBlob, sanitizeQrFileName, triggerDownload } from "@/qr/export-image"
import { storeOnlyZip } from "@/lib/best-effort-zip"
import { toAppError } from "@/crypto/errors"
import { formatFramePositions } from "@/features/presentation"
import { env } from "@/schemas/env-schema"
import { QrDisplay } from "@/components/qr-display"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useI18n, useLocalizedMessage, type LocalizedMessage } from "@/i18n"

export interface AnimatedQrCompatibilityControl {
  enabled: boolean
  disabled?: boolean
  onEnabledChange: (enabled: boolean) => void | Promise<void>
}

export interface AnimatedQrFramesProps {
  frames: readonly QrFrameV2[]
  frameIntervalMs: number
  densityRaised?: boolean
  compatibilityControl?: AnimatedQrCompatibilityControl
  outputName: string
  size?: number
  title?: string
  onFirstRendered?: () => void
  fullscreenEnabled?: boolean
  fullscreenOpen?: boolean
  showFullscreenTrigger?: boolean
  exportsEnabled?: boolean
  splitting?: boolean
  onFullscreenOpenChange?: (open: boolean) => void
  animationSignal?: AbortSignal
}

interface FrameSlot {
  payload: string
}

interface CommittedFrame {
  generation: string
  position: number
  payload: string
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
  densityRaised = false,
  compatibilityControl,
  outputName,
  size = env.qrRenderSize,
  title: titleProp,
  onFirstRendered,
  fullscreenEnabled = true,
  fullscreenOpen,
  showFullscreenTrigger = true,
  exportsEnabled = true,
  splitting = false,
  onFullscreenOpenChange,
  animationSignal,
}: AnimatedQrFramesProps) {
  const { language, t } = useI18n()
  const compatibilityLabelId = useId()
  const title = titleProp ?? t("animatedQr.defaultTitle")
  // A density change makes useFrameSplit project an empty set until its
  // replacement commits. Retaining the last completed set keeps QrDisplay and
  // its fullscreen dialog mounted across that same-session handoff.
  const [frameBuffer, setFrameBuffer] = useState(() => ({
    source: frames,
    committed: frames,
  }))
  if (frameBuffer.source !== frames) {
    setFrameBuffer({
      source: frames,
      committed: frames.length > 0 ? frames : frameBuffer.committed,
    })
  }
  const displayFrames =
    frames.length > 0
      ? frames
      : splitting
        ? frameBuffer.committed
        : frames
  const { slots, missingIndexes, frameCount } = useMemo(() => {
    const expected = Math.max(
      0,
      ...displayFrames.map((frame) => frame.frameCount),
    )
    const nextSlots = new Map<number, FrameSlot>()
    for (const frame of displayFrames) {
      if (!nextSlots.has(frame.frameIndex)) {
        nextSlots.set(frame.frameIndex, {
          payload: encodeFrameToPayload(frame),
        })
      }
    }
    const missing: number[] = []
    for (let index = 0; index < expected; index += 1) {
      if (!nextSlots.has(index)) missing.push(index)
    }
    return { slots: nextSlots, missingIndexes: missing, frameCount: expected }
  }, [displayFrames])
  const availableIndexes = useMemo(
    () => [...slots.keys()].sort((left, right) => left - right),
    [slots],
  )
  const frameGeneration = useMemo(
    () => transferIdentity(displayFrames),
    [displayFrames],
  )
  const [cursor, setCursor] = useState({
    generation: frameGeneration,
    position: 0,
  })
  const position = cursor.generation === frameGeneration ? cursor.position : 0
  const [paused, setPaused] = useState(false)
  const [committedFrame, setCommittedFrame] = useState<CommittedFrame | null>(null)
  const [uncontrolledFullscreen, setUncontrolledFullscreen] = useState(false)
  const fullscreen = fullscreenOpen ?? uncontrolledFullscreen
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(error)
  const firstRenderedRef = useRef(false)
  const currentIndex = availableIndexes[position]
  const current = currentIndex === undefined ? undefined : slots.get(currentIndex)
  const currentPayload = current?.payload

  const handleRendered = (payload: string) => {
    if (payload !== currentPayload) return
    if (!firstRenderedRef.current) {
      firstRenderedRef.current = true
      onFirstRendered?.()
    }
    setCommittedFrame((existing) =>
      existing?.generation === frameGeneration &&
      existing.position === position &&
      existing.payload === payload
        ? existing
        : { generation: frameGeneration, position, payload },
    )
  }

  const changeFullscreen = (open: boolean) => {
    if (fullscreenOpen === undefined) setUncontrolledFullscreen(open)
    onFullscreenOpenChange?.(open)
  }

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
    if (
      paused ||
      availableIndexes.length < 2 ||
      animationSignal?.aborted ||
      currentPayload === undefined ||
      committedFrame?.generation !== frameGeneration ||
      committedFrame.position !== position ||
      committedFrame.payload !== currentPayload
    ) {
      return
    }
    // QrDisplay reports a payload only after React has committed its rendered
    // data URL. Starting one dwell timeout from that exact commit prevents the
    // latest-target renderer from ever dropping an automatically selected index.
    const timer = window.setTimeout(
      () =>
        setCursor((cursorState) => ({
          generation: frameGeneration,
          position:
            ((cursorState.generation === frameGeneration ? cursorState.position : 0) +
              1) %
            availableIndexes.length,
        })),
      frameIntervalMs,
    )
    const stopAnimation = () => window.clearTimeout(timer)
    animationSignal?.addEventListener("abort", stopAnimation, { once: true })
    return () => {
      stopAnimation()
      animationSignal?.removeEventListener("abort", stopAnimation)
    }
  }, [
    animationSignal,
    availableIndexes.length,
    committedFrame,
    currentPayload,
    frameGeneration,
    frameIntervalMs,
    paused,
    position,
  ])

  const safeName = exportsEnabled ? sanitizeQrFileName(outputName) : ""

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

  const exportFrames = async () => {
    if (!exportsEnabled) return
    setExporting(true)
    setError(null)
    try {
      if (animationSignal?.aborted) return
      if (availableIndexes.length === 1) {
        const slot = slots.get(availableIndexes[0]!)
        if (slot === undefined) return
        const blob = await qrPngBlob(slot.payload, { ecLevel: "Q", size })
        if (animationSignal?.aborted) return
        triggerDownload(blob, `${safeName}.png`)
        return
      }

      const entries: Array<{ name: string; data: Uint8Array }> = []
      for (const index of availableIndexes) {
        if (animationSignal?.aborted) return
        const slot = slots.get(index)
        if (!slot) continue
        const blob = await qrPngBlob(slot.payload, { ecLevel: "Q", size })
        if (animationSignal?.aborted) return
        const data = new Uint8Array(await blob.arrayBuffer())
        if (animationSignal?.aborted) return
        entries.push({
          name: `frame-${String(index + 1).padStart(2, "0")}.png`,
          data,
        })
      }
      if (animationSignal?.aborted) return
      triggerDownload(storeOnlyZip(entries), `${safeName}-frames.zip`)
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      setExporting(false)
    }
  }

  if (!current || frameCount === 0) {
    if (splitting) return null
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>{t("animatedQr.empty.title")}</AlertTitle>
        <AlertDescription>{t("animatedQr.empty.body")}</AlertDescription>
      </Alert>
    )
  }

  const compatibilitySwitch = (fullscreenControls: boolean) => {
    if (compatibilityControl === undefined) {
      return fullscreenControls ? <span aria-hidden="true" /> : null
    }
    const labelId = `${compatibilityLabelId}-${fullscreenControls ? "fullscreen" : "inline"}`
    return (
      <div
        data-compatibility-control={fullscreenControls ? "fullscreen" : "inline"}
        className={
          fullscreenControls
            ? "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-1 text-slate-950"
            : "flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm"
        }
      >
        <span
          id={labelId}
          className={
            fullscreenControls
              ? "min-w-0 text-center text-xs leading-tight"
              : "font-medium"
          }
        >
          {t("animatedQr.compatibility.label")}
        </span>
        <Switch
          checked={compatibilityControl.enabled}
          disabled={compatibilityControl.disabled}
          aria-labelledby={labelId}
          className={
            fullscreenControls
              ? "focus-visible:ring-slate-950 focus-visible:ring-offset-white"
              : undefined
          }
          onCheckedChange={(enabled) => {
            void compatibilityControl.onEnabledChange(enabled)
          }}
        />
      </div>
    )
  }

  const transportControls = (
    fullscreenControls: boolean,
    closeSlot?: ReactNode,
  ) => (
    <div
      data-transport-controls={fullscreenControls ? "fullscreen" : "inline"}
      className={
        fullscreenControls
          ? "grid w-full grid-cols-[2.75rem_2.75rem_2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2"
          : "flex flex-wrap items-center justify-center gap-2"
      }
    >
      <Button
        type="button"
        variant="outline"
        className={`h-11 min-w-11 cursor-pointer px-3 focus-visible:ring-2 ${
          fullscreenControls
            ? "w-11 border-slate-400 bg-white px-2 text-slate-950 hover:bg-slate-100 hover:text-slate-950"
            : ""
        }`}
        onClick={movePrevious}
      >
        <ChevronLeft aria-hidden="true" />
        <span className={fullscreenControls ? "sr-only" : undefined}>
          {t("animatedQr.prev")}
        </span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        className={`h-11 cursor-pointer px-3 focus-visible:ring-2 ${
          fullscreenControls
            ? "min-w-11 w-11 border-slate-400 bg-white px-2 text-slate-950 hover:bg-slate-100 hover:text-slate-950"
            : "min-w-28"
        }`}
        onClick={togglePaused}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        <span className={fullscreenControls ? "sr-only" : undefined}>
          {t(paused ? "animatedQr.play" : "animatedQr.pause")}
        </span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className={`h-11 min-w-11 cursor-pointer px-3 focus-visible:ring-2 ${
          fullscreenControls
            ? "w-11 border-slate-400 bg-white px-2 text-slate-950 hover:bg-slate-100 hover:text-slate-950"
            : ""
        }`}
        onClick={moveNext}
      >
        <span className={fullscreenControls ? "sr-only" : undefined}>
          {t("animatedQr.next")}
        </span>
        <ChevronRight aria-hidden="true" />
      </Button>
      {compatibilitySwitch(fullscreenControls)}
      {fullscreenControls && closeSlot}
    </div>
  )

  const renderFullscreenControls = (closeSlot: ReactNode) => (
    <div
      data-fullscreen-controls
      className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-2"
    >
      <p
        aria-live="polite"
        className="shrink-0 text-center font-mono text-base tabular-nums"
      >
        {currentIndex! + 1} / {frameCount}
      </p>
      {transportControls(true, closeSlot)}
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

      {densityRaised && (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("animatedQr.densityRaised")}
        </p>
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
        showFullscreenTrigger={showFullscreenTrigger}
        fullscreenControls={{
          kind: "transport",
          render: renderFullscreenControls,
        }}
        fullscreenOpen={fullscreen}
        onFullscreenOpenChange={changeFullscreen}
      />

      {!fullscreen && (
        <>
          {transportControls(false)}

          <p aria-live="polite" className="text-center font-mono text-base tabular-nums">
            {currentIndex! + 1} / {frameCount}
          </p>

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Sun aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("animatedQr.brightnessHint")}
          </p>

          {exportsEnabled && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full cursor-pointer focus-visible:ring-2"
              disabled={exporting || missingIndexes.length > 0}
              onClick={() => void exportFrames()}
              aria-label={t("common.download")}
            >
              <Download aria-hidden="true" />
              {t("common.download")}
            </Button>
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
