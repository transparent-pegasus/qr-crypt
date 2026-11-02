import { renderQrDataUrl } from "@/qr/encode"
import { encodeFrameToPayload } from "@/qr/wire-codec"
import { parseRelayText, type RelayParseErrorCode } from "@/qr/relay-frames"
import type { QrFrameV2 } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"

type PreparedRelayPlayback =
  | { ok: true; frames: readonly QrFrameV2[] }
  | {
      ok: false
      reason: "parse"
      code: RelayParseErrorCode
      missingIndexes: readonly number[]
    }
  | { ok: false; reason: "render" }
  | { ok: false; reason: "cancelled" }

/**
 * Proves relay text can be played back before any of it reaches the screen: every line
 * parses, every frame re-encodes to the exact string it came from, and every frame
 * renders at the configured size.
 *
 * The re-encode is a canonical round-trip check — a frame whose payload does not
 * reproduce its original byte-for-byte is rejected rather than displayed — and only the
 * decoded frame objects survive it. Rendering runs here, ahead of display, so a set that
 * cannot be shown fails as one operation instead of part-way through the animation.
 *
 * Renders one frame at a time, discards each data URL, and yields a timer task between
 * frames so the caller can cancel work when its input or session ends. The caller also
 * owns re-checking its session and operation generations after awaiting.
 */
export async function prepareRelayPlayback(
  text: string,
  signal?: AbortSignal,
): Promise<PreparedRelayPlayback> {
  if (signal?.aborted) return { ok: false, reason: "cancelled" }
  const parsed = parseRelayText(text)
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "parse",
      code: parsed.code,
      missingIndexes: parsed.missingIndexes ?? [],
    }
  }
  if (
    parsed.frames.some(
      (frame, index) => encodeFrameToPayload(frame) !== parsed.originals[index],
    )
  ) {
    return {
      ok: false,
      reason: "parse",
      code: "invalid-frame",
      missingIndexes: [],
    }
  }
  try {
    for (const [index, frame] of parsed.frames.entries()) {
      if (signal?.aborted) return { ok: false, reason: "cancelled" }
      await renderQrDataUrl(encodeFrameToPayload(frame), {
        ecLevel: "Q",
        size: env.qrRenderSize,
      })
      if (signal?.aborted) return { ok: false, reason: "cancelled" }
      if (index < parsed.frames.length - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
  } catch {
    return { ok: false, reason: signal?.aborted ? "cancelled" : "render" }
  }
  return { ok: true, frames: parsed.frames }
}
