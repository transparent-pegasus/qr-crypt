import { useCallback, useEffect, useState } from "react"
import type { MessageKey } from "@/i18n"
import { env } from "@/schemas/env-schema"
import type { Preferences } from "@/schemas/domain"
import { PQ_PREFERENCE_DEFAULTS } from "@/schemas/domain"
import {
  getPreferences,
  updatePreferences as savePreferences,
} from "@/storage/preferences-repository"

const DEFAULT_PREFERENCES: Preferences = {
  ...PQ_PREFERENCE_DEFAULTS,
  defaultAlgorithm: env.defaultAlgorithm,
  defaultPqProfile: env.defaultPqProfile,
  requireSignature: env.requireSignature,
  qrErrorCorrection: env.qrErrorCorrection,
  autoClearPlaintextAfterEncrypt: true,
  backgroundClearEnabled: true,
  frameBytes: env.qrFrameBytes,
  frameIntervalMs: env.qrFrameIntervalMs,
}

export interface UsePreferencesResult {
  preferences: Preferences
  loading: boolean
  error: MessageKey | null
  updatePreferences: (patch: Partial<Preferences>) => Promise<Preferences>
}

export function usePreferences(): UsePreferencesResult {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MessageKey | null>(null)

  useEffect(() => {
    let active = true
    void getPreferences()
      .then((loaded) => {
        if (active) setPreferences(loaded)
      })
      .catch(() => {
        if (active) setError("hooks.preferences.loadFailed")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const updatePreferences = useCallback(async (patch: Partial<Preferences>) => {
    const updated = await savePreferences(patch)
    setPreferences(updated)
    return updated
  }, [])

  return { preferences, loading, error, updatePreferences }
}
