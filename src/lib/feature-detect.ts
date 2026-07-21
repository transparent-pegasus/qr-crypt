// 機能検出(spec §31)。結果はゲート表示と機能別 disable に使う(plan §12-8)。

export interface FeatureSupport {
  webCrypto: boolean
  indexedDb: boolean
  camera: boolean
  serviceWorker: boolean
}

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function detectFeatures(): FeatureSupport {
  return notImplemented()
}
