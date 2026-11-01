import { useState } from "react"
import type { RegisterSwOptions, RegisterSwResult } from "@/hooks/use-register-sw"
import { registerFakeReset } from "./reset"

export const fakePwa = {
  offlineReady: false,
}

export function useFakeRegisterSW(options: RegisterSwOptions): RegisterSwResult {
  void options
  const [offlineReady] = useState(fakePwa.offlineReady)
  return { offlineReady }
}

registerFakeReset(() => {
  fakePwa.offlineReady = false
})
