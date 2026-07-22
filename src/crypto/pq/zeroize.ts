// 秘密バイト列の消去(spec2 §4)。JS では GC・内部コピー・最適化のため
// 完全なメモリー消去は保証できない — その事実はセキュリティ画面へ明記する。
// detached(Transfer 済み)バッファーへの fill は no-op のため黙って握る。

export function zeroize(...views: (Uint8Array | undefined)[]): void {
  for (const view of views) {
    if (view === undefined) continue
    try {
      view.fill(0)
    } catch {
      // detached ArrayBuffer 等。消去対象が既に移動済みであれば何もできない
    }
  }
}

// fn の完了(例外含む)後に必ず views を消去する
export async function withZeroize<T>(
  views: (Uint8Array | undefined)[],
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn()
  } finally {
    zeroize(...views)
  }
}
