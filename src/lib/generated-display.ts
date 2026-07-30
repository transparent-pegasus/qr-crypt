import { minimumFrameBytesForArtifact } from "@/lib/limits"
import type { Preferences } from "@/schemas/domain"
import {
  COMPATIBLE_GENERATED_DISPLAY_PAIR,
  DEFAULT_GENERATED_DISPLAY_PAIR,
  type GeneratedDisplayPair,
} from "@/schemas/domain"

// The stored pair is one of exactly two admitted combinations; anything else has
// already been canonicalized to the default by the preferences repository.
export function selectedGeneratedDisplayPair(
  preferences: Pick<Preferences, "frameBytes" | "frameIntervalMs">,
): GeneratedDisplayPair {
  return preferences.frameBytes === COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes &&
    preferences.frameIntervalMs ===
      COMPATIBLE_GENERATED_DISPLAY_PAIR.frameIntervalMs
    ? COMPATIBLE_GENERATED_DISPLAY_PAIR
    : DEFAULT_GENERATED_DISPLAY_PAIR
}

export function effectiveGeneratedDisplay(
  preferences: Pick<Preferences, "frameBytes" | "frameIntervalMs">,
  artifactByteLength: number | null,
): {
  frameBytes: number
  frameIntervalMs: number
  compatibilityEnabled: boolean
  densityRaised: boolean
} {
  const pair = selectedGeneratedDisplayPair(preferences)
  const compatibilityEnabled = pair === COMPATIBLE_GENERATED_DISPLAY_PAIR
  const frameBytes =
    artifactByteLength === null
      ? pair.frameBytes
      : Math.max(
          pair.frameBytes,
          minimumFrameBytesForArtifact(artifactByteLength),
        )
  return {
    frameBytes,
    frameIntervalMs: pair.frameIntervalMs,
    compatibilityEnabled,
    densityRaised:
      compatibilityEnabled &&
      frameBytes > COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes,
  }
}
