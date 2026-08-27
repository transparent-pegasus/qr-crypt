import { vi } from "vitest"
import type { FeatureSupport } from "@/lib/feature-detect"
import { registerFakeReset } from "./reset"

export const fakeFeatures: FeatureSupport = {
  webCrypto: true,
  indexedDb: true,
  camera: true,
  serviceWorker: true,
}

export const detectFeatures = vi.fn(() => ({ ...fakeFeatures }))
let webAssemblyRuntimeSettled: boolean | undefined
let webAssemblyProbeGeneration = 0
export const probeWebAssemblyRuntime = vi.fn(async () => true)
export const webAssemblyRuntimeSupport = vi.fn(
  (): boolean | undefined => webAssemblyRuntimeSettled,
)

export function mockWebAssemblyProbe(
  result: boolean | Promise<boolean>,
): void {
  const generation = ++webAssemblyProbeGeneration
  webAssemblyRuntimeSettled = undefined
  const promise = Promise.resolve(result)
  probeWebAssemblyRuntime.mockReturnValue(promise)
  void promise.then((value) => {
    if (generation === webAssemblyProbeGeneration) {
      webAssemblyRuntimeSettled = value
    }
  })
}

registerFakeReset(() => {
  Object.assign(fakeFeatures, {
    webCrypto: true,
    indexedDb: true,
    camera: true,
    serviceWorker: true,
  } satisfies FeatureSupport)
  webAssemblyProbeGeneration += 1
  webAssemblyRuntimeSettled = undefined
  probeWebAssemblyRuntime.mockImplementation(async () => true)
  webAssemblyRuntimeSupport.mockImplementation(() => webAssemblyRuntimeSettled)
})
