import { useCallback, useEffect, useState } from "react"
import type { MessageKey } from "@/i18n"
import type { StoredKeyRecord } from "@/schemas/domain"
import { listKeyRecords } from "@/storage/key-repository"

export interface UseKeysResult {
  keys: StoredKeyRecord[]
  loading: boolean
  error: MessageKey | null
  refresh: () => Promise<void>
}

export function useKeys(): UseKeysResult {
  const [keys, setKeys] = useState<StoredKeyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MessageKey | null>(null)

  const refresh = useCallback(async () => {
    try {
      const records = await listKeyRecords()
      setKeys(records)
      setError(null)
    } catch {
      setError("hooks.keys.loadFailed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  return { keys, loading, error, refresh }
}
