# ブラウザー検証マトリクス

spec §31 の対象環境と主要検証項目の対応表です。

**実機確認は本リポジトリ外の手動作業です。** CI の Playwright（chromium / webkit）は近似カバレッジであり、実機の PWA インストール・カメラ・OS 固有の鍵永続などを代替しません。セルの初期値は `automated (e2e)`（リポジトリ内 e2e でカバー予定）または `manual-pending`（実機手動）です。

| 検証項目 | Android Chrome | iOS Safari | Windows Chrome | macOS Safari | Edge |
| --- | --- | --- | --- | --- | --- |
| PWA インストール | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| オフライン起動 | automated (e2e) | manual-pending | automated (e2e) | manual-pending | manual-pending |
| 鍵生成 | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| 暗号化 | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| QR 表示 | automated (e2e) | automated (e2e) | automated (e2e) | automated (e2e) | manual-pending |
| QR 読取 | manual-pending | manual-pending | manual-pending | manual-pending | manual-pending |
| 非抽出 CryptoKey の IndexedDB 永続（生成→タブ終了→復元→復号） | automated (e2e) | manual-pending | automated (e2e) | automated (e2e) | manual-pending |

## 注記

* **iOS Safari**: 非抽出 `CryptoKey` の IndexedDB 永続（生成→タブ終了→復元→復号）は必須の実機手動項目です。`fake-indexeddb` 上の成功を十分条件としません。
* **オフライン起動 / カメラ読取**: chromium e2e で一部を自動化予定。Android / Windows の実機、および Safari / Edge は手動。
* **Edge**: 実機手動行（plan C7）。スクリーンリーダー検証も手動。
* **macOS Safari / iOS Safari**: Playwright webkit でコア（起動・AES 暗号化復号・鍵永続再読込）を automated とする想定。PWA インストール・カメラ・iOS 固有永続は manual-pending。

## v2 ポスト量子・実機計測（release gate）

balanced プロファイル（ML-KEM-768 / ML-DSA-65）の実機計測欄です。値は手動記入。未計測のセルは **未計測** と明記します。

**実測は `release-approved` の必須条件です。** timeout / crash / OOM / UI フリーズのいずれかが発生した計測は fail とします。Node 上の `aube bench:pq` は参考値であり、本表の代替にはなりません。release gate の最低対象は **Android Chrome** と **iOS Safari** です（デスクトップは併記）。

記録列（各環境で共通）: 端末 / OS / ブラウザー版 / ビルド hash（`VITE_BUILD_SHA` 等）。

### Android Chrome（release gate）

| 項目 | 値 |
| --- | --- |
| 端末 | 未計測 |
| OS | 未計測 |
| ブラウザー版 | 未計測 |
| ビルド hash | 未計測 |
| keygen 時間 | 未計測 |
| Encaps 時間 | 未計測 |
| Decaps 時間 | 未計測 |
| 署名時間 | 未計測 |
| 検証時間 | 未計測 |
| シード再展開時間 | 未計測 |
| ピークメモリー | 未計測 |
| QR フレーム描画完了時間 | 未計測 |
| QR 読取完了時間 | 未計測 |
| オフライン再読込後の Worker 読込確認 | 未計測 |

### iOS Safari（release gate）

| 項目 | 値 |
| --- | --- |
| 端末 | 未計測 |
| OS | 未計測 |
| ブラウザー版 | 未計測 |
| ビルド hash | 未計測 |
| keygen 時間 | 未計測 |
| Encaps 時間 | 未計測 |
| Decaps 時間 | 未計測 |
| 署名時間 | 未計測 |
| 検証時間 | 未計測 |
| シード再展開時間 | 未計測 |
| ピークメモリー | 未計測 |
| QR フレーム描画完了時間 | 未計測 |
| QR 読取完了時間 | 未計測 |
| オフライン再読込後の Worker 読込確認 | 未計測 |

### デスクトップ（参考・併記）

Windows Chrome / macOS Safari / Edge など。release gate の必須対象ではないが、同項目を記録する。

| 項目 | Windows Chrome | macOS Safari | Edge |
| --- | --- | --- | --- |
| 端末 | 未計測 | 未計測 | 未計測 |
| OS | 未計測 | 未計測 | 未計測 |
| ブラウザー版 | 未計測 | 未計測 | 未計測 |
| ビルド hash | 未計測 | 未計測 | 未計測 |
| keygen 時間 | 未計測 | 未計測 | 未計測 |
| Encaps 時間 | 未計測 | 未計測 | 未計測 |
| Decaps 時間 | 未計測 | 未計測 | 未計測 |
| 署名時間 | 未計測 | 未計測 | 未計測 |
| 検証時間 | 未計測 | 未計測 | 未計測 |
| シード再展開時間 | 未計測 | 未計測 | 未計測 |
| ピークメモリー | 未計測 | 未計測 | 未計測 |
| QR フレーム描画完了時間 | 未計測 | 未計測 | 未計測 |
| QR 読取完了時間 | 未計測 | 未計測 | 未計測 |
| オフライン再読込後の Worker 読込確認 | 未計測 | 未計測 | 未計測 |
