interface AbortableReachabilityProbe extends Promise<boolean> {
  abort: () => void
}

let fallbackNonce = 0

function reachabilityNonce(): string {
  if (globalThis.crypto?.getRandomValues) {
    const values = globalThis.crypto.getRandomValues(new Uint32Array(2))
    return Array.from(values, (value) => value.toString(36)).join("")
  }
  fallbackNonce += 1
  return `${Date.now().toString(36)}-${fallbackNonce.toString(36)}`
}

export function probeReachability(timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: ((reason: DOMException) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => {
    rejectAbort?.(new DOMException("Reachability probe aborted", "AbortError"))
  }
  controller.signal.addEventListener("abort", onAbort, { once: true })

  const probe = (async () => {
    timeoutId = setTimeout(() => controller.abort(), Math.max(0, timeoutMs))
    try {
      await Promise.race([
        fetch(`/manifest.webmanifest?reach=${reachabilityNonce()}`, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        }),
        aborted,
      ])
      return true
    } catch {
      return false
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      controller.signal.removeEventListener("abort", onAbort)
      rejectAbort = undefined
    }
  })() as AbortableReachabilityProbe

  Object.defineProperty(probe, "abort", {
    value: () => controller.abort(),
  })
  return probe
}
