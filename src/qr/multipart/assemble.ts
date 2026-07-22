// OCF2 フレーム組立(spec2 §12、plan2.1 §D4 — WP-12)。
//
// 不変条件(凍結):
//   - index は 0..frameCount-1。first frame で immutable metadata
//     (transferId/artifactType/frameCount/totalByteLength/payloadSha256)を凍結
//   - 同 index は「完全一致」のみ idempotent duplicate として無視。
//     1 byte でも差異 → FRAME_MISMATCH(session 汚染扱い)
//   - 別 transferId 混入 → FRAME_MISMATCH
//   - 完成時: index coverage・合計長 = totalByteLength・
//     SHA-256(artifact 生バイト) = payloadSha256・artifactType と復元 artifact
//     の type 一致 を検証してから complete へ遷移
//   - SHA-256 は転送整合性であり送信者 authenticity ではない(UI 表示注意)
//   - タイムアウト(expiresAt)/明示破棄/完成/エラーで chunk state を解放
import type { TransferState } from "@/qr/multipart/transfer-state"

export interface TransferAssemblerOptions {
  transferTimeoutMinutes: number
  now?: () => number // テスト用 seam(既定 Date.now)
}

export class TransferAssembler {
  constructor(options: TransferAssemblerOptions) {
    void options
    throw new Error("NOT_IMPLEMENTED: WP-12 TransferAssembler")
  }

  // フレーム文字列(OCF2:…)を 1 枚受け取り、遷移後の状態を返す。
  // 完成時の SHA-256 照合に WebCrypto を使うため async。
  add(frameText: string): Promise<TransferState> {
    void frameText
    throw new Error("NOT_IMPLEMENTED: WP-12 TransferAssembler.add")
  }

  state(): TransferState {
    throw new Error("NOT_IMPLEMENTED: WP-12 TransferAssembler.state")
  }

  // 明示破棄(読取 UI の「破棄」ボタン・unmount・タイムアウト処理から)
  discard(): void {
    throw new Error("NOT_IMPLEMENTED: WP-12 TransferAssembler.discard")
  }
}
