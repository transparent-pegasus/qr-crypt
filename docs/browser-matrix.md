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
