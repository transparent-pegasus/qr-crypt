# OnlineGate — オンライン導入画面

機能検出ゲートの次、通常ルーターの前に配置する全画面ゲート。オンライン中は `/encrypt`・`/keys`・`/saved`・`/settings` を一切表示せず、PWA の新規導入に必要な情報だけを表示する。

## 表示内容

- アプリアイコンとアプリ名
- ネットワーク状態バッジ（オンライン）
- PWA インストール状態（インストール済み / 未インストール）
- `beforeinstallprompt` を捕捉できた場合の「PWAをインストール」ボタン
- iOS Safari では共有メニューの「ホーム画面に追加」手順
- Service Worker の offlineReady（準備完了 / 準備中）
- 「オフライン（機内モード）に切り替えると全機能が利用できます」という主案内

## 状態遷移と保護

- online→offline: ゲートを即時閉じ、現在 URL の通常ページを表示する。
- offline→online: 通常ページを即時隠し、同時に TransientClear を発火して平文・復号結果・結果ペイロードを消去する。
- Web Crypto または IndexedDB が不足する場合は、OnlineGate より先に `UNSUPPORTED_BROWSER` を表示する。
- オフライン表示は運用上の機能許可条件であり、安全性の証明として表現しない。
