# /decrypt — 復号ページ

MASTER.md を継承。本ページ固有の規則のみ記す。暗号化は別ルート `/encrypt`(`encrypt.md`)。

## 構成

- 入力: 「暗号文QRを読み取る」ボタン(`QrScannerModal`、対象=暗号文、単発とマルチフレームの両方)+ ペイロード貼り付け Textarea
- 貼り付け: 種別確認行(方式・受信鍵ID)を表示して**自動復号しない**。「復号する」ボタンで実行
- 読み取り: スキャナを閉じた時点で読めたペイロードをそのまま復号する。カメラを向ける操作自体が明示的な指示なので、確認ステップを挟まない
- 復号鍵はペイロードの鍵IDから解決する。選択 UI は無い。対応する鍵が無ければ `KEY_NOT_FOUND` を表示してボタンを無効化する
- マルチフレーム完了時は組み立て済みバイトを取り出したうえで `MultipartScanSession` を `discard()` し、アセンブラ側の複製を残さない
- 署名鍵はストレージからの正確な index 解決(`findBundleBySigningKeyId`)。一覧キャッシュや「最新取り込み優先」は使わない。失効行は未知扱い
- 復号結果モーダルの契約:
  - `first-seen`: 平文をモーダルで表示(選択可能テキスト)。**メモリーのみ・保存しない**
  - `already-received`: ラベル付き破壊的 replay アラートを出し、明示的な「それでも表示する」操作まで平文を出さない
  - `MESSAGE_ID_REUSED`: エラー文言のみ。結果モーダルは**開かない**
  - 署名有効かつ `fingerprint-confirmed`: 署名行に成功色、本人確認行も成功
  - 署名有効だが未確認: 署名行は中立色。平文の上に破壊的 identity-unconfirmed アラート(タイトルと本文は `encrypt.result.identityUnconfirmed.*`、続けて identityCheck 文言)
  - PQ 成功時は送信端末の申告時刻行(`encrypt.result.senderCreatedAt`)を出す。鮮度として扱わない
  - セキュリティ Alert はタイトルに id を付け `aria-labelledby` で結ぶ。複数アラートを名前で区別できること
- 署名鍵が未知の場合はモーダルを開かず、`SIGNING_KEY_NOT_FOUND` のアラートと `/keys` への導線だけを出す(部分平文表示禁止)

## 平文の扱い

- 復号結果は自動保存・復元しない(state のみ)
- セッションレシート(`src/features/receipt-cache.ts`)は平文とは別のセッションメモリー構造。認証済みメッセージごとの bounded Map で、document 寿命で消え、reload では生き残らない。IndexedDB / localStorage / CacheStorage には書かない
- 既定 ON の「バックグラウンド移行後に自動消去」が有効な場合、visibilitychange hidden から env 固定の約5分経過で暗号文入力・復号結果を消去し、スキャンセッションを破棄する
- `oc:clear-transient` イベント(設定ページ「すべての平文を消去」)で即時消去。レシートも wipe / transient-clear 経路で `clearReceipts()` される
- ページのアンマウント時にも `MultipartScanSession` を破棄する。ルートが分かれたことでアンマウントが日常的に起きる
