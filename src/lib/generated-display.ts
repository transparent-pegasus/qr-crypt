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
