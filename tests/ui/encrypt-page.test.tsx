import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AppError, userMessageFor } from "@/crypto/errors"
import type { MlKemMessageEnvelopeV2 } from "@/schemas/domain"
import {
  decodeQrImageFile,
  encryptPq,
  decryptPqMessage,
  fakeBundles,
  fakeIdentities,
  fakePqDecrypt,
  renderQrDataUrl,
  startQrScan,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string | RegExp,
) {
  await user.click(await screen.findByLabelText(label))
  await user.click(await screen.findByRole("option", { name: option }))
}

describe("encrypt page v2", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("offers the three active suites and never exposes RSA", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByLabelText("暗号化方式"))
    expect(
      await screen.findByRole("option", { name: /共通鍵.*AES-256-GCM/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", {
        name: /^ポスト量子 ML-KEM-1024 \+ AES-256-GCM$/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /署名付きポスト量子/ })).toBeInTheDocument()
    expect(screen.queryByText(/RSA/)).not.toBeInTheDocument()
  })

  it("shows pending state, produces controllable OCF2 frames, and has no persistence UI", async () => {
    const user = userEvent.setup()
    let resolveEncryption: ((value: MlKemMessageEnvelopeV2) => void) | undefined
    encryptPq.mockImplementationOnce(
      () =>
        new Promise<MlKemMessageEnvelopeV2>((resolve) => {
          resolveEncryption = resolve
        }),
    )
    await renderApp("/encrypt")
    await chooseSelectOption(user, "暗号化方式", /署名付きポスト量子/)
    await chooseSelectOption(user, "受信者のML-KEM公開鍵", /確認済みの相手/)
    await chooseSelectOption(user, "自分のML-DSA署名ID", "自分のPQ ID")
    await user.type(screen.getByLabelText("平文"), "署名付き短文")
    await user.click(screen.getByRole("button", { name: "暗号化する" }))

    expect(screen.getByRole("button", { name: "暗号化中…" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "暗号化中…" }).closest("section"),
    ).toHaveAttribute("aria-busy", "true")

    await act(async () => {
      resolveEncryption?.({
        version: 2,
        type: "pq-message",
        suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
        recipientKemKeyId: fakeBundles[0]!.kem.keyId,
        kemCiphertext: new Uint8Array(1568),
        hkdfSalt: new Uint8Array(32),
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(3_600),
      })
    })

    const result = await screen.findByRole("region", { name: "暗号結果" })
    expect(within(result).getByText("暗号化が完了しました")).toBeInTheDocument()
    expect(within(result).getByLabelText("出力名")).toBeInTheDocument()
    for (const label of [
      "使用暗号スイート",
      "受信者鍵ID",
      "送信者署名鍵ID",
      "総データ量",
      "QRフレーム数",
      "暗号化日時",
      "署名",
      "ポスト量子プロファイル",
      "全体SHA-256",
    ]) {
      expect(within(result).getByText(label)).toBeInTheDocument()
    }
    expect(within(result).getByText("maximum")).toBeInTheDocument()
    expect(within(result).getByRole("button", { name: "一時停止" })).toBeInTheDocument()
    expect(
      within(result).getByRole("button", { name: "次のフレーム" }),
    ).toBeInTheDocument()
    expect(within(result).getByLabelText("表示速度")).toBeInTheDocument()
    expect(
      within(result).getByRole("button", { name: /PNGを一括出力/ }),
    ).toBeInTheDocument()
    expect(within(result).getByRole("button", { name: /ZIPで出力/ })).toBeInTheDocument()
    expect(within(result).getByRole("button", { name: "全画面表示" })).toBeInTheDocument()
    await user.click(within(result).getByRole("button", { name: "次のフレーム" }))
    expect(within(result).getByText(/^2 \/ /)).toBeInTheDocument()
    await user.click(within(result).getByRole("button", { name: "一時停止" }))
    expect(within(result).getByRole("button", { name: "再生" })).toBeInTheDocument()
    fireEvent.change(within(result).getByLabelText("表示速度"), {
      target: { value: "150" },
    })
    expect(within(result).getByText("150 ms")).toBeInTheDocument()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(renderQrDataUrl.mock.calls.at(-1)?.[0]).toMatch(/^OCF2:/)
    const fullscreen = within(result).getByRole("button", { name: "全画面表示" })
    await waitFor(() => expect(fullscreen).toBeEnabled())
    await user.click(fullscreen)
    expect(
      screen.getByRole("dialog", { name: /暗号文 2 \/ .*を全画面表示/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "閉じる" }))

    expect(within(result).queryByRole("button", { name: "保存" })).not.toBeInTheDocument()
    expect(
      within(result).queryByText(/保存済み|重複して保存|鍵QRを保存/),
    ).not.toBeInTheDocument()
  })

  it("uses only primary image import for QR decryption and does not persist", async () => {
    decodeQrImageFile.mockResolvedValueOnce("OCM1:sym-key-00000001")
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "復号" }))
    expect(
      screen.getByRole("heading", { name: "画像で読み取る" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "暗号文QRを読み取る" }),
    ).not.toBeInTheDocument()
    const imageImport = screen.getByRole("button", {
      name: "QR画像を読み込む",
    })
    expect(imageImport).toHaveClass("bg-primary")
    expect(imageImport).not.toHaveClass("bg-secondary")
    expect(startQrScan).not.toHaveBeenCalled()
    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      new File(["png"], "ciphertext.png", { type: "image/png" }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText("暗号文ペイロード")).toHaveValue(
        "OCM1:sym-key-00000001",
      ),
    )
    expect(startQrScan).not.toHaveBeenCalled()
    await user.click(await screen.findByRole("button", { name: "復号する" }))
    expect(await screen.findByText("復号済み平文")).toBeInTheDocument()
    expect(screen.getByText(/メモリー内だけに保持し、保存しません/)).toBeInTheDocument()
    expect(
      screen.queryByText(/保存済み鍵QR|鍵QRを保存/),
    ).not.toBeInTheDocument()
  })

  it("wires QR image import into the decrypt payload without starting a camera", async () => {
    decodeQrImageFile.mockResolvedValueOnce("OCM1:sym-key-00000001")
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "復号" }))

    await user.upload(
      screen.getByLabelText("QR画像ファイル"),
      new File(["png"], "ciphertext.png", { type: "image/png" }),
    )

    await waitFor(() =>
      expect(screen.getByLabelText("暗号文ペイロード")).toHaveValue(
        "OCM1:sym-key-00000001",
      ),
    )
    expect(startQrScan).not.toHaveBeenCalled()
    expect(
      screen.getByText(/画像 1 件中: 取り込み 1/),
    ).toBeInTheDocument()
  })

  it("distinguishes signature validity from person trust and hides unknown-signer plaintext", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "復号" }))
    fireEvent.change(screen.getByLabelText("暗号文ペイロード"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "復号する" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    await waitFor(() => expect(decryptPqMessage).toHaveBeenCalledOnce())
    expect(await screen.findByText("署名はこの鍵に対して有効です")).toBeInTheDocument()
    expect(screen.getByText(/人物確認済み/)).toBeInTheDocument()

    fakePqDecrypt.kind = "signed-key-unknown"
    await user.click(screen.getByRole("button", { name: "復号する" }))
    expect(await screen.findByText("SIGNING_KEY_NOT_FOUND")).toBeInTheDocument()
    expect(screen.queryByText("署名済みPQ復号結果")).not.toBeInTheDocument()
  })

  it("labels unsigned plaintext and suppresses it after a signature failure", async () => {
    const user = userEvent.setup()
    fakePqDecrypt.kind = "unsigned"
    await renderApp("/encrypt")
    await user.click(await screen.findByRole("tab", { name: "復号" }))
    fireEvent.change(screen.getByLabelText("暗号文ペイロード"), {
      target: { value: "OCM2:fake" },
    })
    const decryptButton = screen.getByRole("button", { name: "復号する" })
    await waitFor(() => expect(decryptButton).toBeEnabled())
    await user.click(decryptButton)
    expect(await screen.findByText("署名なし")).toBeInTheDocument()
    expect(screen.getByText("PQ復号済み平文")).toBeInTheDocument()

    decryptPqMessage.mockRejectedValueOnce(new AppError("SIGNATURE_INVALID"))
    await user.click(decryptButton)
    expect(
      await screen.findByText(userMessageFor("SIGNATURE_INVALID")),
    ).toBeInTheDocument()
    expect(screen.queryByText("PQ復号済み平文")).not.toBeInTheDocument()
  })

  it("fails closed with the worker-unavailable user message", async () => {
    const user = userEvent.setup()
    encryptPq.mockRejectedValueOnce(new AppError("WORKER_UNAVAILABLE"))
    await renderApp("/encrypt")
    await chooseSelectOption(user, "暗号化方式", /ポスト量子 ML-KEM-1024 \+ AES/)
    await chooseSelectOption(user, "受信者のML-KEM公開鍵", /確認済みの相手/)
    await user.type(screen.getByLabelText("平文"), "worker failure")
    await user.click(screen.getByRole("button", { name: "暗号化する" }))

    expect(
      await screen.findByText(userMessageFor("WORKER_UNAVAILABLE")),
    ).toBeInTheDocument()
    expect(encryptPq).toHaveBeenCalledOnce()
    expect(screen.queryByText("暗号化が完了しました")).not.toBeInTheDocument()
  })

  it("keeps UTF-8 limits and clears plaintext after success", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    await chooseSelectOption(user, "使用鍵", "共通鍵A")
    const plaintext = screen.getByLabelText("平文")
    fireEvent.change(plaintext, { target: { value: "a".repeat(4097) } })
    expect(screen.getByText("平文の上限を超えています")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "暗号化する" })).toBeDisabled()
    fireEvent.change(plaintext, { target: { value: "既定で消去される平文" } })
    await user.click(screen.getByRole("button", { name: "暗号化する" }))
    expect(await screen.findByText("暗号化が完了しました")).toBeInTheDocument()
    expect(plaintext).toHaveValue("")
    expect(fakeIdentities).toHaveLength(1)
  })
})
