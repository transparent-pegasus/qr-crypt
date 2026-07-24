import "./helpers/module-mocks"
import { render, screen } from "@testing-library/react"
import { useEffect, useState } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeFeatures } from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

function useOfflineReadyAfterMount() {
  const offlineReady = useState(false)
  const setOfflineReady = offlineReady[1]
  useEffect(() => setOfflineReady(true), [setOfflineReady])
  return { offlineReady }
}

describe("PWA offline readiness", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("notifies when offline assets are ready without rendering update controls", async () => {
    const { AppProviders } = await import("@/app/providers")

    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useOfflineReadyAfterMount}>
        <p>アプリ本体</p>
      </AppProviders>,
    )

    expect(
      await screen.findByText("Offline use is ready"),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("アプリ更新通知")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "更新する" })).not.toBeInTheDocument()
  })
})
