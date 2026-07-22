// Boot 状態機械の契約(plan2.1 §B1/§B2 — 型は WP-A2 凍結、実装は WP-BOOT)。
//
// 分離(凍結):
//   - 表示用オンライン: navigator.onLine + 既存 reachability probe
//     (/manifest.webmanifest)。OnlineGate の表示切替のみ。破壊操作の根拠にしない
//   - 破壊用(network-confirmed): 専用 sentinel を no-store GET し
//     「本文一致まで確認」した場合だけオンライン確定
//
// offline-confirmed になるまで Router / usePreferences / 各 repository を
// mount しない。boot controller だけが最初に DB を開き、wipe 設定と機微データ
// 存在を読む(設定読取失敗時の fail-safe は wipe 側)。
// 破壊トリガーは network-confirmed のみ。世代番号+AbortSignal で stale probe
// 無効化、同一遷移で一度だけ、StrictMode 二重 mount 冪等。

export const REACHABILITY_SENTINEL_PATH = "/reachability-sentinel.txt"
export const REACHABILITY_SENTINEL_BODY = "QRYPT-REACHABLE"
export const WIPE_BROADCAST_CHANNEL = "qrypt-wipe"

export type BootState =
  | { kind: "unknown" }
  | { kind: "probing"; generation: number }
  | { kind: "offline-confirmed" }
  | { kind: "network-confirmed" }
  | { kind: "wiping" }
  | { kind: "wiped" }
  | { kind: "partial-failure"; failedSteps: readonly string[] }

// install ゲート経路(機微データ皆無)では wipe しない(plan2.1 §B5)。
// maintenance token: オフライン中に強確認で設定し、1 回の verified transition
// 後に必ず失効して wipeOnOnline=ON へ復帰する(「次の一回だけ鍵を保持して更新」)。
export interface WipeDecisionInput {
  wipeOnOnline: boolean
  sensitiveDataExists: boolean
  maintenanceTokenArmed: boolean
}
