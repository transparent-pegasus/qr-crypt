# OnlineGate — オンライン導入・OCF2 フレーム中継タブ

機能検出ゲートの次、通常ルーターの前に配置する全画面ゲート。オンライン中は `/encrypt`・`/keys`・`/saved`・`/settings` を一切表示せず、PWA の導入情報と、鍵・PQ 身元・Vault 鍵の各ストアが読めた上で 1 行も無いと確認できた場合（読み取り失敗は不許可側に倒す fail-closed）だけ OCF2 フレーム中継を表示する。オンラインシェル自体の固定 localStorage 書き込み（`oc-theme` / `oc-lang` / ack マーカー / 最後に開いたタブ `oc-online-tab`）は従来どおり行われるため「保存領域が空」ではない。鍵を保持する端末をオンラインにしない運用は変わらない。

## 表示内容

- 言語選択、アプリアイコン、アプリ名、ネットワーク状態バッジ（オンライン）はトップ / リレーの両ページに共通して表示する。
- トップページ:
  - PWA インストール状態（インストール済み / 未インストール）
  - `beforeinstallprompt` を捕捉できた場合の「PWAをインストール」ボタン
  - iOS Safari では共有メニューの「ホーム画面に追加」手順
  - Service Worker の offlineReady（準備完了 / 準備中）
  - 「オフライン（機内モード）に切り替えると暗号化・復号・鍵管理・設定が利用できます」という主案内（オフライン表示は安全性の証明として表現しない）
- リレーページ:
  - boot の破壊判断完了後に限る「OCF2 メッセージヘッダー QR 中継」カード（外側ヘッダの申告のみ確認するため、中身が暗号文だとは表示しない）
  - 「スキャン → テキスト」: ボタンでダイアログを開き、さらに明示操作した時だけカメラを取得する
  - 「テキスト → QR」: 改行区切りの OCF2 フレーム一式を貼り付け、既存の animated QR で再表示する
  - ダイアログ自身に上端・下端の safe-area padding を持たせる
  - 44 px 操作、`focus-visible:ring-2`、lucide のアイコン＋テキストを使う
- relay eligible の時だけ、共通下部シェルにアイコンのみの「トップ」「リレー」2 項目を表示する。選択したリレータブの eligibility が一時的に pending になった間もナビを消さないため、表示条件 `navVisible` は `relayEligible || tab === "relay"` とする。固定ナビ表示中は本文に `pb-content-safe` を付ける。
- 下部操作は offline ナビと同じ `<nav>` + 各 `<button aria-current="page">` のページナビとして扱い、`role="tablist"` は使わない。
- ナビを押した時だけ選択タブを localStorage `oc-online-tab`（`top` / `relay` の 2 値のみ）へ保存し、次回起動はその値で開く。未設定・未知の値は `top`。オンライン専用端末が毎回リレーを選び直さずに済むことが目的で、一度も押していない端末は書き込まない。`oc-*` 全削除で消えるため wipe / 全初期化後はトップに戻る。

## 状態遷移と保護

- relay は `network-confirmed/eligible` かつ表示状態も online の時だけ表示する。decision pending、`wiping`、`partial-failure`、maintenance token で鍵が残った場合、`wipeOnOnline:false` で鍵が残った場合、保存領域を読み切れない場合は表示しない。
- 選択状態 `tab` は eligibility 変化でリセットしない。表示パネルだけを `activeTab = relayEligible ? tab : "top"` でトップへ fail-closed し、トップとリレーの wrapper は `hidden` 属性で切り替える。
- `OnlineRelay` のコンポーネント instance はトップ / リレーのどちらを表示している間も常に mount し、eligibility が false の時も条件付き mount にしない。これにより `visibilitychange` / `pagehide` / `pageshow` の監視と session-end handler 登録を維持し、`openDialog` 内で eligibility refresh が同期的に pending を emit しても pending-open generation を失わず、判断完了後にダイアログを開ける。
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
