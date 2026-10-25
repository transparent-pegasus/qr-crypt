import type { OnlineRelayProps } from "@/components/online-relay"

export const acquireLocalRelaySession: NonNullable<
  OnlineRelayProps["onSessionAcquire"]
> = async (signal) => (signal.aborted ? null : { release: () => undefined })
