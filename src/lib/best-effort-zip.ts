// store-only ZIP(無圧縮)出力(spec2 §12 の ZIP 一括出力 — WP-12)。
// 依存追加はしない(fflate は provenance 無しのため不採用。plan2 §0)。
//
// 制約(plan2.1 C24 由来・凍結):
//   - entry 名は内部生成の ASCII のみ(zip-slip 対象外だが検証はする)
//   - 固定タイムスタンプ(決定的出力)
//   - entry 数・合計サイズに上限を置き、ZIP32 超過は明示拒否
//   - CRC32 / local+central directory offset の unit test 必須
//   - 暗号成果物の生成経路から分離(ZIP 失敗で暗号結果を失わない)
export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function storeOnlyZip(entries: readonly ZipEntry[]): Blob {
  void entries
  throw new Error("NOT_IMPLEMENTED: WP-12 storeOnlyZip")
}
