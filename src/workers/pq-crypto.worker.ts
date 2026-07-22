// PQ 暗号 Worker RPC ホスト(spec2 §4、WP-11)。
// 同期プロバイダー(provider-noble)は本 Worker 内でのみ保持する。
// 秘密素材(seed / 展開済み秘密鍵 / 共有秘密 / 導出鍵バイト)は
// postMessage で外へ返さず、各操作の finally で zeroize する(plan2.1 §F)。
// RPC プロトコル(correlation ID・エラー sanitize)は worker-client.ts と対。
//
// Vite は new Worker(new URL("./pq-crypto.worker.ts", import.meta.url),
// { type: "module" }) の形をビルドへ含め、PWA の precache 対象になる(spec2 §17)。

self.addEventListener("message", () => {
  // WP-11 実装まで: いかなる RPC も受理しない(fail-closed)
  self.postMessage({ type: "error", error: "NOT_IMPLEMENTED: WP-11 pq-crypto.worker" })
})

export {}
