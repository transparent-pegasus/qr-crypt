import { createContext, useContext, type ReactNode } from "react"
import type { FeatureSupport } from "@/lib/feature-detect"

const FeatureSupportContext = createContext<FeatureSupport | null>(null)

export function FeatureSupportProvider({
  children,
  features,
}: {
  children: ReactNode
  features: FeatureSupport
}) {
  return (
    <FeatureSupportContext.Provider value={features}>
      {children}
    </FeatureSupportContext.Provider>
  )
}

export function useFeatureSupport(): FeatureSupport {
  const value = useContext(FeatureSupportContext)
  if (!value) {
    throw new Error("useFeatureSupport must be used inside FeatureSupportProvider")
  }
  return value
}
