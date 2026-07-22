import { useCallback, useEffect, useState } from "react"
import type { PostQuantumIdentity, PqPublicBundleRecord } from "@/schemas/domain"
import { listBundles } from "@/storage/pq-bundle-repository"
import { listIdentities } from "@/storage/pq-identity-repository"

export interface UsePqRecordsResult {
  identities: PostQuantumIdentity[]
  bundles: PqPublicBundleRecord[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function usePqRecords(): UsePqRecordsResult {
  const [identities, setIdentities] = useState<PostQuantumIdentity[]>([])
  const [bundles, setBundles] = useState<PqPublicBundleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextIdentities, nextBundles] = await Promise.all([
        listIdentities(),
        listBundles(),
      ])
      setIdentities(nextIdentities)
      setBundles(nextBundles)
      setError(null)
    } catch {
      setError("ポスト量子IDと公開鍵を読み込めませんでした。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  return { identities, bundles, loading, error, refresh }
}
