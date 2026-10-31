import { createContext, useContext } from "react"

export interface MaintenanceTokenState {
  // null means unknown. A failed refresh retains a previously armed warning.
  armed: boolean | null
  readFailed: boolean
}

interface MaintenanceTokenContextValue extends MaintenanceTokenState {
  refresh: () => Promise<void>
}

export const MaintenanceTokenContext = createContext<MaintenanceTokenContextValue | null>(
  null,
)

export function useMaintenanceToken(): MaintenanceTokenContextValue {
  const value = useContext(MaintenanceTokenContext)
  if (!value) throw new Error("useMaintenanceToken requires MaintenanceTokenProvider")
  return value
}
