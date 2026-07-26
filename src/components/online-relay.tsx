/* eslint-disable react-refresh/only-export-components -- pure parser exports share the relay's bounded contract with tests */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  Camera,
  CameraOff,
  ClipboardCopy,
  MessageSquareText,
  QrCode,
  ScanLine,
} from "lucide-react"
import type { RelaySessionEndReason } from "@/app/boot/boot-controller"
import { useFeatureSupport } from "@/app/providers"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AppError, errorMessageKey } from "@/crypto/errors"
import { formatFramePositions } from "@/features/presentation"
import {
  FRAME_CHUNK_MAX_BYTES,
  FRAME_INTERVAL_MS_DEFAULT,
  MAX_FRAME_PAYLOAD_CHARS,
  PROTOCOL_MAX_FRAMES,
  TRANSFER_TIMEOUT_MINUTES_DEFAULT,
} from "@/lib/limits"
import { startQrScan, type QrScanHandle } from "@/qr/decode"
import { copyTextToClipboard } from "@/qr/export-image"
import { renderQrDataUrl } from "@/qr/encode"
import { decodeFramePayload, encodeFrameToPayload } from "@/qr/payload-v2"
import type { QrFrameV2 } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { useI18n, type MessageKey } from "@/i18n"

export const RELAY_TEXT_MAX_CHARS = PROTOCOL_MAX_FRAMES * (MAX_FRAME_PAYLOAD_CHARS + 2)
const RELAY_LIFETIME_MS = TRANSFER_TIMEOUT_MINUTES_DEFAULT * 60_000

export type RelayParseErrorCode =
  | "empty"
  | "frame-count"
  | "input-size"
  | "invalid-frame"
  | "length"
  | "mismatch"
  | "outer-type"
  | "prefix"

interface RelayMetadata {
  readonly transferId: Uint8Array
  readonly artifactType: "pq-message"
  readonly frameCount: number
  readonly totalByteLength: number
}

export interface RelayFrameEntry {
  readonly frame: QrFrameV2
  readonly original: string
}

export interface RelayFrameSet {
  readonly metadata: RelayMetadata | null
  readonly entries: ReadonlyMap<number, RelayFrameEntry>
  readonly receivedByteLength: number
}

export type RelayParseResult =
  { ok: true; set: RelayFrameSet } | { ok: false; code: RelayParseErrorCode }

export type RelayTextParseResult =
  | {
      ok: true
      set: RelayFrameSet
      frames: readonly QrFrameV2[]
      originals: readonly string[]
    }
  | {
      ok: false
      code: RelayParseErrorCode
      missingIndexes?: readonly number[]
    }

export function emptyRelayFrameSet(): RelayFrameSet {
  return {
    metadata: null,
    entries: new Map(),
    receivedByteLength: 0,
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!
  }
  return difference === 0
}

function metadataMatches(metadata: RelayMetadata, frame: QrFrameV2): boolean {
  return (
    bytesEqual(metadata.transferId, frame.transferId) &&
    metadata.artifactType === frame.artifactType &&
    metadata.frameCount === frame.frameCount &&
    metadata.totalByteLength === frame.totalByteLength
  )
}

function parserError(error: unknown): RelayParseErrorCode {
  return error instanceof AppError && error.code === "INVALID_QR_PREFIX"
    ? "prefix"
    : "invalid-frame"
}

function validFrameLengths(frame: QrFrameV2): boolean {
  return (
    frame.totalByteLength <= frame.frameCount * FRAME_CHUNK_MAX_BYTES &&
    (frame.frameCount !== 1 || frame.chunk.byteLength === frame.totalByteLength)
  )
}

/**
 * Pure, bounded parser shared by camera capture and text playback. The caller's
 * accepted set is never mutated; a failed batch has no commit side effect.
 */
export function parseRelayFrameSet(
  originals: readonly string[],
  initial: RelayFrameSet = emptyRelayFrameSet(),
): RelayParseResult {
  if (originals.length === 0) return { ok: false, code: "empty" }
  if (originals.length > PROTOCOL_MAX_FRAMES) {
    return { ok: false, code: "frame-count" }
  }

  let metadata = initial.metadata
  let receivedByteLength = initial.receivedByteLength
  const entries = new Map(initial.entries)

  for (const original of originals) {
    if (!original.startsWith("OCF2:")) return { ok: false, code: "prefix" }

    let frame: QrFrameV2
    try {
      frame = decodeFramePayload(original)
    } catch (error) {
      return { ok: false, code: parserError(error) }
    }

    if (frame.artifactType !== "pq-message") {
      return { ok: false, code: "outer-type" }
    }
    if (!validFrameLengths(frame)) return { ok: false, code: "length" }

    if (metadata === null) {
      metadata = {
        transferId: Uint8Array.from(frame.transferId),
        artifactType: "pq-message",
        frameCount: frame.frameCount,
        totalByteLength: frame.totalByteLength,
      }
    } else if (!metadataMatches(metadata, frame)) {
      return { ok: false, code: "mismatch" }
    }

    const occupied = entries.get(frame.frameIndex)
    if (occupied !== undefined) {
      if (occupied.original !== original) {
        return { ok: false, code: "mismatch" }
      }
      continue
    }

    const nextByteLength = receivedByteLength + frame.chunk.byteLength
    if (
      !Number.isSafeInteger(nextByteLength) ||
      nextByteLength > metadata.totalByteLength
    ) {
      return { ok: false, code: "length" }
    }
    entries.set(frame.frameIndex, { frame, original })
    receivedByteLength = nextByteLength
  }

  if (
    metadata !== null &&
    entries.size === metadata.frameCount &&
    receivedByteLength !== metadata.totalByteLength
  ) {
    return { ok: false, code: "length" }
  }

  return {
    ok: true,
    set: { metadata, entries, receivedByteLength },
  }
}

export function missingRelayIndexes(set: RelayFrameSet): number[] {
  if (set.metadata === null) return []
  const missing: number[] = []
  for (let index = 0; index < set.metadata.frameCount; index += 1) {
    if (!set.entries.has(index)) missing.push(index)
  }
  return missing
}

export function orderedRelayEntries(set: RelayFrameSet): RelayFrameEntry[] {
  return [...set.entries.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => entry)
}

export function parseRelayText(text: string): RelayTextParseResult {
  if (text.length > RELAY_TEXT_MAX_CHARS) {
    return { ok: false, code: "input-size" }
  }
  const originals = text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0)
  if (originals.length === 0) return { ok: false, code: "empty" }
  if (originals.length > PROTOCOL_MAX_FRAMES) {
    return { ok: false, code: "frame-count" }
  }

  const parsed = parseRelayFrameSet(originals)
  if (!parsed.ok) return parsed
  const missingIndexes = missingRelayIndexes(parsed.set)
  if (missingIndexes.length > 0) {
    return { ok: false, code: "frame-count", missingIndexes }
  }
  const ordered = orderedRelayEntries(parsed.set)
  return {
    ok: true,
    set: parsed.set,
    frames: ordered.map(({ frame }) => frame),
    originals: ordered.map(({ original }) => original),
  }
}

const PARSE_ERROR_KEYS: Record<RelayParseErrorCode, MessageKey> = {
  empty: "relay.error.empty",
  "frame-count": "relay.error.incomplete",
  "input-size": "relay.error.inputSize",
  "invalid-frame": "relay.error.invalidFrame",
  length: "relay.error.length",
  mismatch: "relay.error.mismatch",
  "outer-type": "relay.error.outerType",
  prefix: "relay.error.prefix",
}

type DialogMode = "capture" | "playback" | null
type LocalEndReason =
  | RelaySessionEndReason
  | "camera-error"
  | "close"
  | "hidden"
  | "pagehide"
  | "pageshow"
  | "render-error"
  | "timeout"
  | "unmount"

export interface OnlineRelayProps {
  eligible: boolean
  onEligibilityRefresh?: () => Promise<boolean>
  registerRelaySessionEndHandler?: (
    handler: (reason: RelaySessionEndReason) => void,
  ) => () => void
}

export function OnlineRelay({
  eligible,
  onEligibilityRefresh,
  registerRelaySessionEndHandler,
}: OnlineRelayProps) {
  const { language, t } = useI18n()
  const { camera: cameraAvailable } = useFeatureSupport()
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [captureSet, setCaptureSet] = useState<RelayFrameSet>(emptyRelayFrameSet)
  const [joinedText, setJoinedText] = useState("")
  const [captureError, setCaptureError] = useState<MessageKey | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [playbackText, setPlaybackText] = useState("")
  const [playbackFrames, setPlaybackFrames] = useState<readonly QrFrameV2[]>([])
  const [playbackAnimationSignal, setPlaybackAnimationSignal] = useState<
    AbortSignal | undefined
  >()
  const [playbackError, setPlaybackError] = useState<MessageKey | null>(null)
  const [playbackMissingIndexes, setPlaybackMissingIndexes] = useState<readonly number[]>(
    [],
  )
  const [terminalNotice, setTerminalNotice] = useState<MessageKey | null>(null)

  const mountedRef = useRef(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const captureSetRef = useRef<RelayFrameSet>(emptyRelayFrameSet())
  const joinedTextRef = useRef("")
  const playbackTextRef = useRef("")
  const playbackFramesRef = useRef<readonly QrFrameV2[]>([])
  const startupAbortRef = useRef<AbortController | null>(null)
  const liveHandleRef = useRef<QrScanHandle | null>(null)
  const lifetimeTimeoutRef = useRef<number | null>(null)
  const playbackAnimationAbortRef = useRef<AbortController | null>(null)
  const playbackOperationRef = useRef(0)
  const sessionGenerationRef = useRef(0)
  const pendingOpenGenerationRef = useRef(0)

  const detachVideo = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    video.srcObject = null
    video.removeAttribute("src")
    videoRef.current = null
  }, [])

  const stopCameraOnly = useCallback(() => {
    startupAbortRef.current?.abort()
    startupAbortRef.current = null
    liveHandleRef.current?.stop()
    liveHandleRef.current = null
    detachVideo()
    if (mountedRef.current) setCameraActive(false)
  }, [detachVideo])

  const endSession = useCallback(
    (reason: LocalEndReason) => {
      if (reason !== "eligibility-loss") {
        pendingOpenGenerationRef.current += 1
      }
      playbackOperationRef.current += 1
      sessionGenerationRef.current += 1
      stopCameraOnly()
      if (lifetimeTimeoutRef.current !== null) {
        window.clearTimeout(lifetimeTimeoutRef.current)
        lifetimeTimeoutRef.current = null
      }
      playbackAnimationAbortRef.current?.abort()
      playbackAnimationAbortRef.current = null
      captureSetRef.current = emptyRelayFrameSet()
      joinedTextRef.current = ""
      playbackTextRef.current = ""
      playbackFramesRef.current = []
      if (!mountedRef.current) return
      setDialogMode(null)
      setCaptureSet(emptyRelayFrameSet())
      setJoinedText("")
      setCaptureError(null)
      setPlaybackText("")
      setPlaybackFrames([])
      setPlaybackAnimationSignal(undefined)
      setPlaybackError(null)
      setPlaybackMissingIndexes([])
      setTerminalNotice(null)
    },
    [stopCameraOnly],
  )

  const beginLifetime = useCallback(() => {
    if (lifetimeTimeoutRef.current !== null) return
    lifetimeTimeoutRef.current = window.setTimeout(() => {
      endSession("timeout")
      if (mountedRef.current) setTerminalNotice("relay.error.timeout")
    }, RELAY_LIFETIME_MS)
  }, [endSession])

  useLayoutEffect(() => {
    if (!registerRelaySessionEndHandler) return
    return registerRelaySessionEndHandler((reason) => endSession(reason))
  }, [endSession, registerRelaySessionEndHandler])

  useLayoutEffect(() => {
    if (!eligible) endSession("eligibility-loss")
  }, [eligible, endSession])

  useEffect(() => {
    const onPageHide = () => endSession("pagehide")
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) endSession("pageshow")
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        endSession("hidden")
        return
      }
      if (!eligible || !onEligibilityRefresh) return
      let refresh: Promise<boolean>
      try {
        refresh = onEligibilityRefresh()
      } catch {
        endSession("eligibility-loss")
        return
      }
      void refresh.then(
        (stillEligible) => {
          if (!stillEligible) endSession("eligibility-loss")
        },
        () => endSession("eligibility-loss"),
      )
    }
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("pageshow", onPageShow)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("pageshow", onPageShow)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [eligible, endSession, onEligibilityRefresh])

  // Layout cleanup is the synchronous secondary stop path when a display edge
  // removes the relay in the same commit.
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      endSession("unmount")
    }
  }, [endSession])

  const openDialog = async (mode: Exclude<DialogMode, null>) => {
    setTerminalNotice(null)
    let refresh: Promise<boolean>
    try {
      refresh = onEligibilityRefresh ? onEligibilityRefresh() : Promise.resolve(eligible)
    } catch {
      endSession("eligibility-loss")
      return
    }
    // The controller synchronously clears an old session before returning its
    // refresh promise. Capture the attempt only after that boundary action.
    const openGeneration = pendingOpenGenerationRef.current
    let stillEligible: boolean
    try {
      stillEligible = await refresh
    } catch {
      endSession("eligibility-loss")
      return
    }
    if (
      !stillEligible ||
      !mountedRef.current ||
      openGeneration !== pendingOpenGenerationRef.current
    ) {
      endSession("eligibility-loss")
      return
    }
    endSession("close")
    setDialogMode(mode)
  }

  const handleCapturedText = useCallback(
    (original: string, generation: number) => {
      if (generation !== sessionGenerationRef.current || !mountedRef.current) {
        return
      }
      const previous = captureSetRef.current
      const parsed = parseRelayFrameSet([original], previous)
      if (!parsed.ok) {
        setCaptureError(PARSE_ERROR_KEYS[parsed.code])
        return
      }

      captureSetRef.current = parsed.set
      setCaptureSet(parsed.set)
      setCaptureError(null)
      if (previous.metadata === null && parsed.set.metadata !== null) {
        beginLifetime()
      }
      const missing = missingRelayIndexes(parsed.set)
      if (
        parsed.set.metadata !== null &&
        missing.length === 0 &&
        parsed.set.receivedByteLength === parsed.set.metadata.totalByteLength
      ) {
        const joined = orderedRelayEntries(parsed.set)
          .map(({ original: value }) => value)
          .join("\n")
        joinedTextRef.current = joined
        setJoinedText(joined)
        stopCameraOnly()
      }
    },
    [beginLifetime, stopCameraOnly],
  )

  const startCamera = () => {
    if (
      !cameraAvailable ||
      cameraActive ||
      startupAbortRef.current !== null ||
      liveHandleRef.current !== null ||
      joinedTextRef.current.length > 0
    ) {
      return
    }
    setCaptureError(null)
    const generation = ++sessionGenerationRef.current
    const abortController = new AbortController()
    startupAbortRef.current = abortController
    setCameraActive(true)
    const video = videoRef.current
    if (video === null) {
      endSession("camera-error")
      setTerminalNotice(errorMessageKey("CAMERA_NOT_AVAILABLE"))
      return
    }

    const onError = (error: AppError) => {
      if (generation !== sessionGenerationRef.current || abortController.signal.aborted) {
        return
      }
      endSession("camera-error")
      if (mountedRef.current) setTerminalNotice(errorMessageKey(error.code))
    }

    let startPromise: Promise<QrScanHandle>
    try {
      startPromise = startQrScan(
        video,
        (text) => handleCapturedText(text, generation),
        onError,
        { once: false, signal: abortController.signal },
      )
    } catch {
      endSession("camera-error")
      setTerminalNotice(errorMessageKey("CAMERA_NOT_AVAILABLE"))
      return
    }

    void startPromise
      .then((handle) => {
        if (
          generation !== sessionGenerationRef.current ||
          abortController.signal.aborted
        ) {
          handle.stop()
          return
        }
        liveHandleRef.current = handle
      })
      .catch((error: unknown) => {
        if (
          generation !== sessionGenerationRef.current ||
          abortController.signal.aborted
        ) {
          return
        }
        endSession("camera-error")
        const appError =
          error instanceof AppError ? error : new AppError("CAMERA_NOT_AVAILABLE")
        if (mountedRef.current) {
          setTerminalNotice(errorMessageKey(appError.code))
        }
      })
  }

  const copyCaptureText = async () => {
    if (joinedTextRef.current.length === 0) return
    setCaptureError(null)
    try {
      await copyTextToClipboard(joinedTextRef.current)
    } catch {
      setCaptureError("relay.error.copy")
    }
  }

  const showPlayback = async () => {
    const input = playbackTextRef.current
    const operation = ++playbackOperationRef.current
    const generation = sessionGenerationRef.current
    const parsed = parseRelayText(input)
    if (!parsed.ok) {
      setPlaybackError(PARSE_ERROR_KEYS[parsed.code])
      setPlaybackMissingIndexes(parsed.missingIndexes ?? [])
      return
    }
    // Re-encoding is a canonical round-trip check; retain only the decoded
    // frame objects after every original string matches byte-for-byte.
    if (
      parsed.frames.some(
        (frame, index) => encodeFrameToPayload(frame) !== parsed.originals[index],
      )
    ) {
      setPlaybackError("relay.error.invalidFrame")
      setPlaybackMissingIndexes([])
      return
    }
    try {
      await Promise.all(
        parsed.frames.map((frame) =>
          renderQrDataUrl(encodeFrameToPayload(frame), {
            ecLevel: "Q",
            size: env.qrRenderSize,
          }),
        ),
      )
    } catch {
      if (
        operation !== playbackOperationRef.current ||
        generation !== sessionGenerationRef.current ||
        !mountedRef.current
      ) {
        return
      }
      endSession("render-error")
      if (mountedRef.current) {
        setTerminalNotice(errorMessageKey("QR_TOO_LARGE"))
      }
      return
    }
    if (
      operation !== playbackOperationRef.current ||
      generation !== sessionGenerationRef.current ||
      !mountedRef.current
    ) {
      return
    }
    playbackAnimationAbortRef.current?.abort()
    const animationAbort = new AbortController()
    playbackAnimationAbortRef.current = animationAbort
    playbackFramesRef.current = parsed.frames
    setPlaybackFrames(parsed.frames)
    setPlaybackAnimationSignal(animationAbort.signal)
    setPlaybackError(null)
    setPlaybackMissingIndexes([])
    beginLifetime()
  }

  if (!eligible) return null

  const captureMissing = missingRelayIndexes(captureSet)
  const captureCount = captureSet.metadata?.frameCount ?? 0

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <MessageSquareText aria-hidden="true" className="size-5" />
              {t("relay.card.title")}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("relay.card.description")}
          </p>
          <Alert>
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{t("relay.boundary.title")}</AlertTitle>
            <AlertDescription>{t("relay.boundary.body")}</AlertDescription>
          </Alert>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 cursor-pointer focus-visible:ring-2"
              disabled={!cameraAvailable}
              onClick={() => void openDialog("capture")}
            >
              <ScanLine aria-hidden="true" />
              {t("relay.capture.open")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 cursor-pointer focus-visible:ring-2"
              onClick={() => void openDialog("playback")}
            >
              <QrCode aria-hidden="true" />
              {t("relay.playback.open")}
            </Button>
          </div>
          {!cameraAvailable && (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <CameraOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t("relay.capture.unavailable")}
            </p>
          )}
        </CardContent>
      </Card>

      {terminalNotice && (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t("relay.error.title")}</AlertTitle>
          <AlertDescription>{t(terminalNotice)}</AlertDescription>
        </Alert>
      )}

      <Dialog
        open={dialogMode === "capture"}
        onOpenChange={(open) => {
          if (!open) endSession("close")
        }}
      >
        <DialogContent className="grid max-h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="grid min-h-0 gap-4 overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("relay.capture.title")}</DialogTitle>
              <DialogDescription>{t("relay.capture.description")}</DialogDescription>
            </DialogHeader>

            <video
              ref={videoRef}
              aria-label={t("relay.capture.video.ariaLabel")}
              className="aspect-square w-full rounded-lg border bg-black object-cover"
              muted
              playsInline
            />
            <Button
              type="button"
              className="h-11 cursor-pointer focus-visible:ring-2"
              disabled={cameraActive || joinedText.length > 0}
              onClick={startCamera}
            >
              <Camera aria-hidden="true" />
              {cameraActive
                ? t("relay.capture.cameraActive")
                : t("relay.capture.startCamera")}
            </Button>

            {captureSet.metadata !== null && (
              <div className="space-y-1" aria-live="polite">
                <p className="font-mono text-sm tabular-nums">
                  {t("relay.capture.progress", {
                    collected: captureSet.entries.size,
                    total: captureCount,
                  })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("relay.capture.missing", {
                    indexes: formatFramePositions(captureMissing, language),
                  })}
                </p>
              </div>
            )}

            {captureError && (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>{t("relay.error.title")}</AlertTitle>
                <AlertDescription>{t(captureError)}</AlertDescription>
              </Alert>
            )}

            {joinedText.length > 0 && (
              <div className="space-y-3">
                <Label htmlFor="relay-captured-text">
                  {t("relay.capture.output.label")}
                </Label>
                <Textarea
                  id="relay-captured-text"
                  className="min-h-36 font-mono text-xs"
                  readOnly
                  value={joinedText}
                />
                <p className="text-sm text-muted-foreground">{t("relay.copy.warning")}</p>
                <Button
                  type="button"
                  className="h-11 w-full cursor-pointer focus-visible:ring-2"
                  onClick={() => void copyCaptureText()}
                >
                  <ClipboardCopy aria-hidden="true" />
                  {t("relay.capture.copy")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogMode === "playback"}
        onOpenChange={(open) => {
          if (!open) endSession("close")
        }}
      >
        <DialogContent className="grid max-h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="grid min-h-0 gap-4 overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("relay.playback.title")}</DialogTitle>
              <DialogDescription>{t("relay.playback.description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="relay-playback-text">{t("relay.playback.input.label")}</Label>
              <Textarea
                id="relay-playback-text"
                className="min-h-36 font-mono text-xs"
                value={playbackText}
                onChange={(event) => {
                  playbackOperationRef.current += 1
                  playbackTextRef.current = event.target.value
                  setPlaybackText(event.target.value)
                  setPlaybackMissingIndexes([])
                }}
              />
            </div>
            <Button
              type="button"
              className="h-11 cursor-pointer focus-visible:ring-2"
              onClick={() => void showPlayback()}
            >
              <QrCode aria-hidden="true" />
              {t("relay.playback.show")}
            </Button>

            {playbackError && (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>{t("relay.error.title")}</AlertTitle>
                <AlertDescription>{t(playbackError)}</AlertDescription>
              </Alert>
            )}

            {playbackMissingIndexes.length > 0 && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {t("relay.playback.missing", {
                  indexes: formatFramePositions(playbackMissingIndexes, language),
                })}
              </p>
            )}

            {playbackFrames.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("relay.playback.screenCaptureWarning")}
                </p>
                <AnimatedQrFrames
                  frames={playbackFrames}
                  frameIntervalMs={FRAME_INTERVAL_MS_DEFAULT}
                  outputName="relay"
                  title={t("relay.playback.qrTitle")}
                  exportsEnabled={false}
                  {...(playbackAnimationSignal
                    ? { animationSignal: playbackAnimationSignal }
                    : {})}
                />
                <p className="text-sm text-muted-foreground">
                  {t("relay.playback.noDownloadControls")}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
