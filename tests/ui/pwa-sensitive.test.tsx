import "./helpers/module-mocks"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  fakeFeatures,
  fakePwa,
  updateServiceWorker,
  useFakeRegisterSW,
} from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

describe("SensitiveSession update gating", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("disables updates while a secret is visible or crypto is busy", async () => {
    fakePwa.needRefresh = true
    const { AppProviders, useSensitiveSession } = await import("@/app/providers")

    function Controls() {
      const { setSensitiveSession } = useSensitiveSession()
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              setSensitiveSession({ secretVisible: true, cryptoBusy: false })
            }
          >
            秘密表示
          </button>
          <button
            type="button"
            onClick={() =>
              setSensitiveSession({ secretVisible: false, cryptoBusy: true })
            }
          >
            暗号処理
          </button>
        </div>
      )
    }

    render(
      <AppProviders features={{ ...fakeFeatures }} pwaHook={useFakeRegisterSW}>
        <Controls />
      </AppProviders>,
    )
    const user = userEvent.setup()
    const update = screen.getByRole("button", { name: "更新する" })

    await user.click(screen.getByRole("button", { name: "秘密表示" }))
    expect(update).toBeDisabled()
    expect(
      screen.getByText("秘密情報の表示中は更新できません。表示を閉じてください。"),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "暗号処理" }))
    expect(update).toBeDisabled()
    expect(
      screen.getByText("暗号処理中は更新できません。処理が終わるまでお待ちください。"),
    ).toBeInTheDocument()
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })
})
