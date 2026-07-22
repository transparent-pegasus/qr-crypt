// ローカルデータのベストエフォート初期化(plan2.1 §B3/§B4 — WP-BOOT)。
// 名称に "secure" / "wipe" を使わない(物理消去は保証不能: LevelDB 追記型・
// SSD ウェアレベリング。確実な消去は端末の完全フォーマットのみ)。
//
// 順序(WipeCoordinator が単一所有。凍結):
//   1. 新規 UI/crypto/storage 操作を fail-closed
//   2. Worker cancel/terminate、app 所有秘密バッファーと Vault 鍵キャッシュ drop
//   3. transient/SensitiveSession を非表示・reset
//   4. navigator.locks(fallback あり)+ BroadcastChannel("qrypt-wipe")で
//      全タブへ停止/close 要求
//   5. Vault 配下の EncryptedSecret を先に削除 → Vault 鍵レコード削除
//      (暗号シュレッディング。非抽出 CryptoKey の byte 上書きは主張しない)
//   6. 全 DB(pqIdentities/pqPublicBundles 含む)+ oc-* localStorage を削除
//   7. DB 不在を再確認して barrier 維持(deleteDB({blocked}) に timeout+UI)
//
// churn(resetChurnMb)は既定 0 の実験オプション。消去保証にならない
// (idle/quota 上限/AbortSignal/失敗記録付き。QuotaExceeded は握って続行)。
export interface BestEffortResetArgs {
  reason: "online-detected" | "user-requested"
  resetChurnMb: number // 0–512(limits.ts)
  signal?: AbortSignal
}

export interface BestEffortResetReport {
  ok: boolean
  // 完了表示は「論理削除を試行しました(物理消去は未保証)」。
  // 部分失敗は成功文言にせず RESET_FAILED として提示する
  failedSteps: readonly string[]
}

export function bestEffortLocalReset(
  args: BestEffortResetArgs,
): Promise<BestEffortResetReport> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-BOOT bestEffortLocalReset")
}
