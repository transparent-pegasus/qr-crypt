import { useCallback, useEffect, useRef } from "react"
import { registerPqCryptoClientForWipe } from "@/app/boot/wipe-coordinator"
import { createPqCryptoClient, type PqCryptoClient } from "@/crypto/pq/worker-client"

export function usePqCryptoClient(): () => PqCryptoClient {
  const clientRef = useRef<PqCryptoClient | null>(null)
  const unregisterRef = useRef<(() => void) | null>(null)

  const getClient = useCallback(() => {
    if (clientRef.current === null) {
      const client = createPqCryptoClient()
      clientRef.current = client
      unregisterRef.current = registerPqCryptoClientForWipe(client)
    }
    return clientRef.current
  }, [])

  useEffect(
    () => () => {
      unregisterRef.current?.()
      unregisterRef.current = null
      clientRef.current?.dispose()
      clientRef.current = null
    },
    [],
  )

  return getClient
}
