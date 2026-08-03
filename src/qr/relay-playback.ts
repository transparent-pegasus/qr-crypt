import { renderQrDataUrl } from "@/qr/encode"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import { parseRelayText, type RelayParseErrorCode } from "@/qr/relay-frames"
import type { QrFrameV2 } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"

export type PreparedRelayPlayback =
  | { ok: true; frames: readonly QrFrameV2[] }
  | {
      ok: false
      reason: "parse"
      code: RelayParseErrorCode
      missingIndexes: readonly number[]
    }
  | { ok: false; reason: "render" }

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
 * Holds no UI state and starts nothing that outlives the returned promise, so the caller
 * owns re-checking its own session and operation generations after awaiting.
 */
export async function prepareRelayPlayback(
  text: string,
): Promise<PreparedRelayPlayback> {
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
    await Promise.all(
      parsed.frames.map((frame) =>
        renderQrDataUrl(encodeFrameToPayload(frame), {
          ecLevel: "Q",
          size: env.qrRenderSize,
        }),
      ),
    )
  } catch {
    return { ok: false, reason: "render" }
  }
  return { ok: true, frames: parsed.frames }
}
