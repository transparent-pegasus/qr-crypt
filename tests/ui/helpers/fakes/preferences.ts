import { vi } from "vitest"
import type { Preferences } from "@/schemas/domain"
import { PQ_PREFERENCE_DEFAULTS } from "@/schemas/domain"
import { registerFakeReset } from "./reset"

export const fakePreferences: Preferences = {
  ...PQ_PREFERENCE_DEFAULTS,
  defaultAlgorithm: "A256GCM",
  frameBytes: 1_000,
  frameIntervalMs: 200,
  autoClearPlaintextAfterEncrypt: true,
  backgroundClearEnabled: true,
}
const defaultPreferencesSnapshot: Preferences = { ...fakePreferences }

function defaultFakePreferences(): Preferences {
  return { ...defaultPreferencesSnapshot }
}

export const defaultPreferences = vi.fn(defaultFakePreferences)
export const getPreferences = vi.fn(async () => ({ ...fakePreferences }))
export const updatePreferences = vi.fn(async (patch: Partial<Preferences>) => {
  Object.assign(fakePreferences, patch)
  return { ...fakePreferences }
})

registerFakeReset(() => {
  Object.assign(fakePreferences, {
    ...PQ_PREFERENCE_DEFAULTS,
    defaultAlgorithm: "A256GCM",
    frameBytes: 1_000,
    frameIntervalMs: 200,
    autoClearPlaintextAfterEncrypt: true,
    backgroundClearEnabled: true,
  } satisfies Preferences)
  defaultPreferences.mockImplementation(defaultFakePreferences)
})
