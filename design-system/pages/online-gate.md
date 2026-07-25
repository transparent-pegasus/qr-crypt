# OnlineGate — オンライン導入・暗号文リレー画面

機能検出ゲートの次、通常ルーターの前に配置する全画面ゲート。オンライン中は `/encrypt`・`/keys`・`/saved`・`/settings` を一切表示せず、PWA の導入情報と、保存領域が空であることを fail-closed に確認できた場合だけ暗号文 QR リレーを表示する。鍵を保持する端末をオンラインにしない運用は変わらない。

## 表示内容

- アプリアイコンとアプリ名
- ネットワーク状態バッジ（オンライン）
- PWA インストール状態（インストール済み / 未インストール）
- `beforeinstallprompt` を捕捉できた場合の「PWAをインストール」ボタン
- iOS Safari では共有メニューの「ホーム画面に追加」手順
- Service Worker の offlineReady（準備完了 / 準備中）
- boot の破壊判断完了後に限る「暗号文QRリレー」カード
  - 「スキャン → テキスト」: ボタンでダイアログを開き、さらに明示操作した時だけカメラを取得する
  - 「テキスト → QR」: 改行区切りの OCF2 フレーム一式を貼り付け、既存の animated QR で再表示する
  - ダイアログ自身に上端・下端の safe-area padding を持たせる
  - 44 px 操作、`focus-visible:ring-2`、lucide のアイコン＋テキストを使う
- 「オフライン（機内モード）に切り替えると全機能が利用できます」という主案内

## 状態遷移と保護

- relay は `network-confirmed/eligible` かつ表示状態も online の時だけ表示する。decision pending、`wiping`、`partial-failure`、maintenance token で鍵が残った場合、`wipeOnOnline:false` で鍵が残った場合、保存領域を読み切れない場合は表示しない。
- `keys`・`pqIdentities`・Vault key metadata・preferences は boot の同一 readonly transaction で確認し、open/store/count/get/transaction のどの失敗も `indeterminate` として fail-closed に扱う。
- online→offline: relay の命令的 `endSession` を同期実行してからゲートを閉じる。通常ページは既存の acknowledgement 条件を満たすまで表示しない。
- offline→online: 通常ページを即時隠し、同時に TransientClear を発火して平文・復号結果・結果ペイロードを消去する。
- relay を開く直前と visible への `visibilitychange` で空状態を再確認する。cross-tab の排他 lease は持たないため、確認直後に別タブが鍵を作る stale-policy race は残る。
- camera startup の AbortController と取得済み `QrScanHandle.stop()` は別々に保持し、close、unmount、hidden、pagehide、BFCache pageshow、表示/eligibility 喪失、local/peer wipe、timeout、terminal error のすべてで両方を終了する。BFCache 復帰時に自動再取得しない。
- Web Crypto または IndexedDB が不足する場合は、OnlineGate より先に `UNSUPPORTED_BROWSER` を表示する。
- オフライン表示は運用上の機能許可条件であり、安全性の証明として表現しない。

## リレー境界の表現

- 受け入れるのは「信頼できない外側ヘッダーが `pq-message` と表明する正規 OCF2 フレーム」。inner type、全体 hash、AEAD、署名、送信者、真正性、安全性をリレーは検証しない。受信側オフライン端末を authority とし、鍵交換は対面を推奨運用として示す。
- フレーム文字列は検証後も verbatim で保持し、順序だけ index 昇順にして LF で結合する。再組立・再分割・density control は行わない。
- Copy は clipboard への意図的 export であり、アプリ外に残存・同期し得る警告を表示する。QR は長押し保存、印刷、screenshot、画面録画を防げない。
- enforceable な UI 制約は「アプリ提供のファイル download control がないこと」。frame-derived 値を app-managed IndexedDB/localStorage/CacheStorage/URL/history/log や frame-bearing network request に意図的に書き込まない。shell 固有の固定 storage/network 動作は別に存在する。
