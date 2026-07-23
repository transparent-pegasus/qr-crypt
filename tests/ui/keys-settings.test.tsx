import "./helpers/module-mocks"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  PostQuantumIdentity,
  PublicIdentityBundleV2,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import {
  armMaintenanceToken,
  confirmBundleFingerprint,
  deleteKeyRecord,
  emitScannedPayload,
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodePublicIdentityBundleV2,
  fakeArtifacts,
  fakeBundles,
  fakeIdentities,
  fakeKeys,
  fakePreferences,
  saveBundle,
  saveQrArtifact,
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

  it("shows four tabs, hides legacy RSA keys, and provides their deletion route", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    for (const name of ["共通鍵", "ポスト量子ID", "相手の公開鍵", "鍵を読み取る"]) {
      expect(await screen.findByRole("tab", { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole("tab", { name: "受信公開鍵" })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "署名公開鍵" })).not.toBeInTheDocument()
    expect(
      screen.getByText(/旧形式のRSA鍵 2 件は v2 で使用不可、復元できません/),
    ).toBeInTheDocument()
    expect(screen.queryByText("受信鍵B")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "旧形式の鍵を削除" }))
    await waitFor(() => expect(deleteKeyRecord).toHaveBeenCalledTimes(2))
    expect(fakeKeys.every((key) => key.kind === "symmetric")).toBe(true)
  })

  it("blocks immediately on OCI2 fingerprint comparison and can save unverified", async () => {
    const user = userEvent.setup()
    const originalCount = fakeBundles.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "鍵を読み取る" }))
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
    await user.click(await screen.findByRole("tab", { name: "鍵を読み取る" }))
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
    await user.click(await screen.findByRole("tab", { name: "鍵を読み取る" }))
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
    await user.click(await screen.findByRole("tab", { name: "鍵を読み取る" }))
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

  it("exposes maximum identity fingerprints, lifecycle actions, and all OCF2 outputs", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "ポスト量子ID" }))
    expect(screen.getByText("experimental・未独立監査")).toBeInTheDocument()
    expect(screen.queryByText(/balanced/i)).not.toBeInTheDocument()
    expect(screen.getByText("3".repeat(64))).toBeInTheDocument()
    expect(screen.getByText("1".repeat(64))).toBeInTheDocument()
    expect(screen.getByText("2".repeat(64))).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ローテーション" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "この端末で失効" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "公開鍵セットQR" }))
    const qrDialog = await screen.findByRole("dialog", { name: /公開鍵セット/ })
    expect(within(qrDialog).getByText(/OCF2フレーム/)).toBeInTheDocument()
    expect(within(qrDialog).getByRole("button", { name: "一時停止" })).toBeInTheDocument()
    expect(
      within(qrDialog).getByRole("button", { name: /ZIPで出力/ }),
    ).toBeInTheDocument()
    expect(fakeIdentities).toHaveLength(1)
  })

  it("collapses rotated generations under the active identity card", async () => {
    const user = userEvent.setup()
    const head = fakeIdentities[0]!
    const rotated: PostQuantumIdentity = {
      ...head,
      id: "O".repeat(22),
      kem: { ...head.kem, keyId: "L".repeat(22), fingerprint: "4".repeat(64) },
      signing: { ...head.signing, keyId: "M".repeat(22), fingerprint: "5".repeat(64) },
      identityFingerprint: "6".repeat(64),
      status: "rotated",
      createdAt: head.createdAt - 1_000,
      rotatedAt: head.createdAt,
    }
    fakeIdentities.splice(
      0,
      fakeIdentities.length,
      { ...head, rotatedFromId: rotated.id },
      rotated,
    )

    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "ポスト量子ID" }))
    expect(await screen.findByText("3".repeat(64))).toBeInTheDocument()
    expect(screen.getAllByText("active")).toHaveLength(1)
    expect(screen.queryByText("rotated")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /旧世代 1 件、復号専用/ }))
    expect(screen.getByText("rotated")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "署名検証用単鍵QR" })).toHaveLength(2)
  })

  it("retains duplicate handling for saved key QR without introducing message persistence", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("button", { name: "秘密鍵QRを表示" }))
    const dialog = await screen.findByRole("dialog", { name: "共通鍵QR" })
    await user.click(
      within(dialog).getByRole("checkbox", { name: "リスクを理解しました" }),
    )
    const save = within(dialog).getByRole("button", { name: "保存済み鍵QRへ保存" })
    await user.click(save)
    await waitFor(() => expect(saveQrArtifact).toHaveBeenCalledTimes(1))
    expect(fakeArtifacts).toHaveLength(1)

    await user.click(save)
    const duplicate = await screen.findByRole("alertdialog", {
      name: "同じ内容の鍵QRが保存済みです",
    })
    await user.click(within(duplicate).getByRole("button", { name: "重複して保存" }))
    await waitFor(() => expect(fakeArtifacts).toHaveLength(2))
    expect(fakeArtifacts.every((artifact) => artifact.kind === "symmetric-key")).toBe(
      true,
    )
  })

  it("keeps single-frame OCK1 camera import behind a secret-key confirmation", async () => {
    const user = userEvent.setup()
    const originalCount = fakeKeys.length
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "鍵を読み取る" }))
    expect(startQrScan).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
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
    expect(frameInterval).toHaveAttribute("min", "150")
    expect(frameInterval).toHaveAttribute("max", "2000")
    expect(transferTimeout).toHaveAttribute("min", "1")
    expect(transferTimeout).toHaveAttribute("max", "120")
    fireEvent.change(frameBytes, { target: { value: "900" } })
    fireEvent.change(frameInterval, { target: { value: "150" } })
    fireEvent.change(transferTimeout, { target: { value: "120" } })
    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({ frameBytes: 900 })
      expect(updatePreferences).toHaveBeenCalledWith({ frameIntervalMs: 150 })
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
})
