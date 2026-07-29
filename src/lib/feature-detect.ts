// Feature detection. Use results for gate display and per-feature disabling.

export interface FeatureSupport {
  webCrypto: boolean
  indexedDb: boolean
  camera: boolean
  serviceWorker: boolean
}

const EMPTY_WEBASSEMBLY_MODULE = Uint8Array.of(
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
)

let webAssemblyRuntimeProbe: Promise<boolean> | undefined
let webAssemblyRuntimeResolved: boolean | undefined

// The auto-clear delay is chosen at the moment the app is backgrounded, which can be before
// the probe settles. Callers that cannot await need the settled answer or an honest
// "not yet" — undefined means the stricter primary delay applies.
export function webAssemblyRuntimeSupport(): boolean | undefined {
  return webAssemblyRuntimeResolved
}

export function hasWebAssemblyInstantiationApi(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      WebAssembly !== null &&
      typeof WebAssembly.instantiate === "function"
    )
  } catch {
    return false
  }
}

// API presence and validate() do not prove that the effective CSP permits Wasm.
// Instantiating a valid empty module exercises the browser's actual policy boundary.
export function probeWebAssemblyRuntime(): Promise<boolean> {
  const existing = webAssemblyRuntimeProbe
  if (existing !== undefined) return existing

  const probe = (async () => {
    let available = false
    if (hasWebAssemblyInstantiationApi()) {
      try {
        await WebAssembly.instantiate(EMPTY_WEBASSEMBLY_MODULE)
        available = true
      } catch {
        // Leave the runtime marked unavailable.
      }
    }
    webAssemblyRuntimeResolved = available
    return available
  })()
  webAssemblyRuntimeProbe = probe
  return probe
}

export function detectFeatures(): FeatureSupport {
  const hasNavigator = typeof navigator !== "undefined"
  // Start the policy-sensitive probe at boot without delaying the synchronous gate.
  void probeWebAssemblyRuntime()
  return {
    webCrypto:
      typeof crypto !== "undefined" &&
      typeof crypto.subtle !== "undefined" &&
      typeof crypto.getRandomValues === "function",
    indexedDb: typeof indexedDB !== "undefined",
    camera: hasNavigator && typeof navigator.mediaDevices?.getUserMedia === "function",
    serviceWorker: hasNavigator && "serviceWorker" in navigator,
  }
}
