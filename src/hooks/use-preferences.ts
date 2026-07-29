import { useCallback, useEffect, useState } from "react"
import type { MessageKey } from "@/i18n"
import type { Preferences } from "@/schemas/domain"
import {
  defaultPreferences,
  getPreferences,
  updatePreferences as savePreferences,
} from "@/storage/preferences-repository"

export interface UsePreferencesResult {
  preferences: Preferences
  loading: boolean
  error: MessageKey | null
  updatePreferences: (patch: Partial<Preferences>) => Promise<Preferences>
}

export function usePreferences(): UsePreferencesResult {
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences)
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
