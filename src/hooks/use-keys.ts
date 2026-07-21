import { useCallback, useEffect, useState } from "react"
import type { StoredKeyRecord } from "@/schemas/domain"
import { listKeyRecords } from "@/storage/key-repository"

export interface UseKeysResult {
  keys: StoredKeyRecord[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useKeys(): UseKeysResult {
  const [keys, setKeys] = useState<StoredKeyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const records = await listKeyRecords()
      setKeys(records)
      setError(null)
    } catch {
      setError("鍵を読み込めませんでした。保存領域を確認してください。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  return { keys, loading, error, refresh }
}
