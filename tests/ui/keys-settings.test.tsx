import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  PublicIdentityBundleV2,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import {
  armMaintenanceToken,
  clearAllIdentities,
  clearAllKeys,
  confirmBundleFingerprint,
  createIdentity,
  createSymmetricKeyRecord,
  deleteKeyRecord,
  emitScannedPayload,
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodePublicIdentityBundleV2,
  fakeBundles,
  fakeIdentities,
  fakeKeys,
  fakePreferences,
  saveBundle,
  startQrScan,
  updatePreferences,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

describe("key management v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    env.requireSignature = false
    resetUi()
  })

  it("shows noun-form tabs and separated camera/paste import cards", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    for (const name of ["作成", "読込"]) {
      expect(await screen.findByRole("tab", { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(screen.getByRole("tab", { name: "作成" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByRole("tablist")).toHaveClass(
      "grid",
      "h-11",
      "w-full",
      "grid-cols-2",
    )
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveClass("h-9", "cursor-pointer", "px-1", "text-sm")
      await user.click(tab)
      expect(screen.getByRole("tabpanel")).toHaveClass("mt-6")
    }
    const cameraHeading = screen.getByRole("heading", { name: "カメラで読み取る" })
    const pasteHeading = screen.getByRole("heading", {
      name: "ペイロードを貼り付ける",
    })
    const cameraCard = cameraHeading.parentElement?.parentElement
    const pasteCard = pasteHeading.parentElement?.parentElement
    expect(cameraCard).toBeInstanceOf(HTMLDivElement)
    expect(pasteCard).toBeInstanceOf(HTMLDivElement)
    expect(cameraCard).not.toBe(pasteCard)
    expect(
      within(cameraCard as HTMLDivElement).getByRole("button", {
        name: "鍵QRを読み取る",
      }),
    ).toBeInTheDocument()
    expect(
      within(pasteCard as HTMLDivElement).getByLabelText("鍵ペイロード"),
    ).toBeInTheDocument()
    const exampleCaption = screen.getByText(
      "相手の画面の輝度を上げてもらい、カメラを15〜20cmほど離してピントが合うまで静止すると読み取りやすくなります。",
    )
    const scanIcon = exampleCaption.parentElement!.querySelector(
      "svg.lucide-scan-line",
    )!
    expect(scanIcon).toHaveAttribute("aria-hidden", "true")
    expect(exampleCaption.parentElement!.querySelector("img")).toBeNull()
    expect(
      screen.queryByText(
        "上のQR読取またはペイロード貼付から公開鍵セットを取り込めます。",
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("取り込んだ公開鍵セットがありません。"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("確認済みの相手")).not.toBeInTheDocument()
    expect(
      screen.getByText(/旧形式のRSA鍵 2 件は v2 で使用不可、復元できません/),
    ).toBeInTheDocument()
    expect(screen.queryByText("受信鍵B")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "旧形式の鍵を削除" }))
    await waitFor(() => expect(deleteKeyRecord).toHaveBeenCalledTimes(2))
    expect(fakeKeys.every((key) => key.kind === "symmetric")).toBe(true)
  })

  it("creates the selected key kind through the embedded type select", async () => {
    const user = userEvent.setup()
    const identityCount = fakeIdentities.length
    const symmetricCount = fakeKeys.filter((key) => key.kind === "symmetric").length
    await renderApp("/keys")

    // defaultAlgorithm=A256GCM(fakes)なので既定種類は共通鍵
    expect(await screen.findByLabelText("共通鍵名")).toBeInTheDocument()
    expect(screen.queryByText("experimental・未独立監査")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "共通鍵を作成" })).toBeDisabled()
    await user.type(screen.getByLabelText("共通鍵名"), "新しい共通鍵")
    await user.click(screen.getByRole("button", { name: "共通鍵を作成" }))
    await waitFor(() => expect(createSymmetricKeyRecord).toHaveBeenCalledOnce())
    expect(fakeKeys.filter((key) => key.kind === "symmetric")).toHaveLength(
      symmetricCount + 1,
    )
    let dialog = await screen.findByRole("dialog", { name: "新しい共通鍵" })
    expect(within(dialog).getByText("AES-256-GCM")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(screen.getByRole("combobox", { name: "種類" }))
    await user.click(
      screen.getByRole("option", { name: "ポスト量子ID ML-KEM-1024 + ML-DSA-87" }),
    )
    expect(await screen.findByText("experimental・未独立監査")).toBeInTheDocument()
    const auditNote = screen.getByRole("note")
    expect(auditNote).toHaveClass(
      "inline-flex",
      "h-11",
      "w-full",
      "items-center",
      "justify-center",
      "gap-2",
    )
    expect(auditNote.tagName).toBe("DIV")
    await user.type(screen.getByLabelText("ポスト量子ID名"), "新しいPQ ID")
    await user.click(screen.getByRole("button", { name: "ポスト量子IDを作成" }))
    await waitFor(() => expect(createIdentity).toHaveBeenCalledOnce())
    expect(fakeIdentities).toHaveLength(identityCount + 1)
    dialog = await screen.findByRole("dialog", { name: "新しいPQ ID" })
    expect(within(dialog).getByText("3".repeat(64))).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    expect(screen.queryByText(/maximum IDを作成/)).not.toBeInTheDocument()
  })

  it("blocks immediately on OCI2 fingerprint comparison and can save unverified", async () => {
    const user = userEvent.setup()
    const originalCount = fakeBundles.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "読込" }))
    await user.type(screen.getByLabelText("鍵ペイロード"), "OCI2:fake")
    await user.click(screen.getByRole("button", { name: "鍵を読み取る" }))

    const dialog = await screen.findByRole("dialog", {
      name: "別経路で指紋を比較してください",
    })
    expect(within(dialog).getByText("9".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("7".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("8".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "確認して保存" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(
      screen.getByRole("dialog", { name: "別経路で指紋を比較してください" }),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "未確認のまま保存" }))
    await waitFor(() => expect(saveBundle).toHaveBeenCalledTimes(1))
    expect(confirmBundleFingerprint).not.toHaveBeenCalled()
    expect(fakeBundles).toHaveLength(originalCount + 1)
    expect(fakeBundles[0]?.trust).toBe("unverified")
  })

  it("confers fingerprint-confirmed trust only after the explicit checkbox", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "読込" }))
    await user.type(screen.getByLabelText("鍵ペイロード"), "OCI2:fake")
    await user.click(screen.getByRole("button", { name: "鍵を読み取る" }))
    const dialog = await screen.findByRole("dialog", {
      name: "別経路で指紋を比較してください",
    })
    await user.click(
      within(dialog).getByRole("checkbox", { name: "別経路で一致を確認した" }),
    )
    await user.click(within(dialog).getByRole("button", { name: "確認して保存" }))
    await waitFor(() => expect(confirmBundleFingerprint).toHaveBeenCalledTimes(1))
    expect(fakeBundles[0]?.trust).toBe("fingerprint-confirmed")
  })

  it("rejects a balanced OCI2 bundle before the fingerprint/import flow", async () => {
    const legacyBundle: PublicIdentityBundleV2 = {
      version: 2,
      type: "pq-public-identity",
      identityId: "B".repeat(22),
      kem: {
        algorithm: "ML-KEM-768",
        keyId: "K".repeat(22),
        publicKey: new Uint8Array(1184),
      },
      signing: {
        algorithm: "ML-DSA-65",
        keyId: "S".repeat(22),
        publicKey: new Uint8Array(1952),
      },
      createdAt: 1_700_000_000_000,
    }
    encodePublicIdentityBundleV2(legacyBundle)
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "読込" }))
    await user.type(screen.getByLabelText("鍵ペイロード"), "OCI2:legacy-balanced")
    await user.click(screen.getByRole("button", { name: "鍵を読み取る" }))

    expect(await screen.findByText("対応していない暗号方式です。")).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "別経路で指紋を比較してください" }),
    ).not.toBeInTheDocument()
    expect(saveBundle).not.toHaveBeenCalled()
  })

  it("rejects balanced OCP2 and OCS2 single keys before exposing fingerprints", async () => {
    const legacyKem: KemPublicKeyEnvelopeV2 = {
      version: 2,
      type: "pq-kem-public-key",
      identityId: "B".repeat(22),
      algorithm: "ML-KEM-768",
      keyId: "K".repeat(22),
      publicKey: new Uint8Array(1184),
      createdAt: 1_700_000_000_000,
    }
    const legacyDsa: DsaPublicKeyEnvelopeV2 = {
      version: 2,
      type: "pq-dsa-public-key",
      identityId: "B".repeat(22),
      algorithm: "ML-DSA-65",
      keyId: "S".repeat(22),
      publicKey: new Uint8Array(1952),
      createdAt: 1_700_000_000_000,
    }
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "読込" }))
    const input = screen.getByLabelText("鍵ペイロード")

    encodeKemPublicKeyEnvelopeV2(legacyKem)
    await user.type(input, "OCP2:legacy-balanced")
    await user.click(screen.getByRole("button", { name: "鍵を読み取る" }))
    expect(await screen.findByText("対応していない暗号方式です。")).toBeInTheDocument()
    expect(screen.queryByText("単鍵を読み取りました")).not.toBeInTheDocument()

    await user.clear(input)
    encodeDsaPublicKeyEnvelopeV2(legacyDsa)
    await user.type(input, "OCS2:legacy-balanced")
    await user.click(screen.getByRole("button", { name: "鍵を読み取る" }))
    expect(await screen.findByText("対応していない暗号方式です。")).toBeInTheDocument()
    expect(screen.queryByText("単鍵を読み取りました")).not.toBeInTheDocument()
  })

  it("keeps single-frame OCK1 camera import behind a secret-key confirmation", async () => {
    const user = userEvent.setup()
    const originalCount = fakeKeys.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "読込" }))
    expect(startQrScan).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "鍵QRを読み取る" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await act(async () => emitScannedPayload("OCK1:imported-key-000001"))

    const dialog = await screen.findByRole("dialog", { name: "共通鍵を取り込みます" })
    const save = within(dialog).getByRole("button", { name: "共通鍵を保存" })
    expect(save).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "この鍵の共有経路を信頼しています",
      }),
    )
    await user.click(save)
    await waitFor(() => expect(fakeKeys).toHaveLength(originalCount + 1))
  })
})

describe("settings v2", () => {
  beforeEach(resetUi)
  afterEach(() => {
    env.requireSignature = false
    resetUi()
  })

  it("persists every numeric boundary and shows wipe/reset warnings", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const frameBytes = await screen.findByLabelText(/1フレームの生データ/)
    const frameInterval = screen.getByLabelText(/フレーム切替間隔/)
    const transferTimeout = screen.getByLabelText(/読取状態の期限/)
    expect(frameBytes).toHaveAttribute("min", "400")
    expect(frameBytes).toHaveAttribute("max", "900")
    expect(frameInterval).toHaveAttribute("min", "1000")
    expect(frameInterval).toHaveAttribute("max", "3000")
    expect(frameInterval).toHaveAttribute("step", "500")
    expect(transferTimeout).toHaveAttribute("min", "1")
    expect(transferTimeout).toHaveAttribute("max", "120")
    fireEvent.change(frameBytes, { target: { value: "900" } })
    fireEvent.change(frameInterval, { target: { value: "2250" } })
    expect(updatePreferences).not.toHaveBeenCalledWith({ frameIntervalMs: 2_250 })
    fireEvent.change(frameInterval, { target: { value: "3000" } })
    fireEvent.change(transferTimeout, { target: { value: "120" } })
    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({ frameBytes: 900 })
      expect(updatePreferences).toHaveBeenCalledWith({ frameIntervalMs: 3_000 })
      expect(updatePreferences).toHaveBeenCalledWith({ transferTimeoutMinutes: 120 })
    })

    const wipe = screen.getByRole("switch", {
      name: "オンライン確定時にローカルデータを初期化",
    })
    expect(wipe).toBeChecked()
    await user.click(wipe)
    expect(await screen.findByText("ローカルデータが残り続けます")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Advanced: reset churn/ }))
    const resetChurn = screen.getByLabelText(/reset churn/)
    expect(resetChurn).toHaveAttribute("min", "0")
    expect(resetChurn).toHaveAttribute("max", "512")
    fireEvent.change(resetChurn, { target: { value: "512" } })
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ resetChurnMb: 512 }),
    )
    expect(screen.getByText(/churnは消去保証にならず/)).toBeInTheDocument()
    expect(
      screen.getByText(/JavaScript実装はサイドチャネル耐性を保証しません/),
    ).toBeInTheDocument()
    expect(screen.getByText(/物理消去は保証しません/)).toBeInTheDocument()
  })

  it("enforces the environment signature floor", async () => {
    env.requireSignature = true
    fakePreferences.requireSignature = true
    await renderApp("/settings")
    const signature = await screen.findByRole("switch", { name: "署名を必須にする" })
    expect(signature).toBeChecked()
    expect(signature).toBeDisabled()
    expect(
      screen.getByText(/環境設定で必須化されているため解除できません/),
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByLabelText("デフォルト暗号方式"))
    expect(
      screen.queryByRole("option", { name: /^ポスト量子 ML-KEM/ }),
    ).not.toBeInTheDocument()
  })

  it("arms the one-shot maintenance token only after strong offline confirmation", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    const button = await screen.findByRole("button", {
      name: "次の一回だけ鍵を保持して更新",
    })
    expect(button).toBeEnabled()
    await user.click(button)
    const dialog = await screen.findByRole("alertdialog", {
      name: "次の一回だけ鍵を保持して更新",
    })
    const action = within(dialog).getByRole("button", { name: "maintenance tokenをarm" })
    expect(action).toBeDisabled()
    await user.type(within(dialog).getByLabelText("確認文字列"), "鍵を保持して更新")
    await user.click(within(dialog).getByRole("checkbox", { name: /一回限り/ }))
    expect(action).toBeEnabled()
    await user.click(action)
    await waitFor(() => expect(armMaintenanceToken).toHaveBeenCalledTimes(1))
  })

  it("clears symmetric keys and post-quantum identities together", async () => {
    const user = userEvent.setup()
    await renderApp("/settings")
    expect(fakeKeys.length).toBeGreaterThan(0)
    expect(fakeIdentities.length).toBeGreaterThan(0)

    await user.click(await screen.findByRole("button", { name: "すべての鍵を消去" }))
    const dialog = await screen.findByRole("alertdialog", {
      name: "すべての鍵を消去",
    })
    const action = within(dialog).getByRole("button", { name: "論理削除を実行" })
    expect(action).toBeDisabled()
    await user.type(within(dialog).getByLabelText("確認文字列"), "全削除")
    await user.click(action)

    await waitFor(() => {
      expect(clearAllKeys).toHaveBeenCalledOnce()
      expect(clearAllIdentities).toHaveBeenCalledOnce()
    })
    expect(fakeKeys).toHaveLength(0)
    expect(fakeIdentities).toHaveLength(0)
  })
})
