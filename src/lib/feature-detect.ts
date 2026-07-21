// 機能検出(spec §31)。結果はゲート表示と機能別 disable に使う(plan §12-8)。

export interface FeatureSupport {
  webCrypto: boolean
  indexedDb: boolean
  camera: boolean
  serviceWorker: boolean
}

export function detectFeatures(): FeatureSupport {
  const hasNavigator = typeof navigator !== "undefined"
  return {
    webCrypto:
      typeof crypto !== "undefined" &&
      typeof crypto.subtle !== "undefined" &&
      typeof crypto.getRandomValues === "function",
    indexedDb: typeof indexedDB !== "undefined",
    camera: hasNavigator && typeof navigator.mediaDevices?.getUserMedia === "function",
    serviceWorker: hasNavigator && "serviceWorker" in navigator,
  }
}
