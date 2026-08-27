import { useState } from "react"
import type { RegisterSWOptions } from "virtual:pwa-register/react"
import { registerFakeReset } from "./reset"

export const fakePwa = {
  offlineReady: false,
}

export function useFakeRegisterSW(_options?: RegisterSWOptions) {
  void _options
  const offlineReadyState = useState(fakePwa.offlineReady)
  return {
    offlineReady: offlineReadyState,
  }
}

registerFakeReset(() => {
  fakePwa.offlineReady = false
})
