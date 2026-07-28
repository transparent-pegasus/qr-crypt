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
    if (!hasWebAssemblyInstantiationApi()) return false
    try {
      await WebAssembly.instantiate(EMPTY_WEBASSEMBLY_MODULE)
      return true
    } catch {
      return false
    }
  })()
  webAssemblyRuntimeProbe = probe
  void probe.then((available) => {
    webAssemblyRuntimeResolved = available
  })
  return probe
}

// The resolved probe result, or undefined while it is still in flight. Callers that
// cannot await must treat undefined as "not yet known" and choose the safe branch.
export function webAssemblyRuntimeSupport(): boolean | undefined {
  return webAssemblyRuntimeResolved
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
