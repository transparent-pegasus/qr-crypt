import type { MessageCatalog } from "@/i18n/messages"

export const ja = {
  "language.field": "言語",
  "language.en": "English",
  "language.ja": "日本語",

  "common.operationFailed": "操作を完了できません",
  "common.cancel": "キャンセル",
  "common.close": "閉じる",
  "common.supported.yes": "利用できます",
  "common.supported.no": "利用できません",
  "common.featureUnavailable": "この機能は利用できません: {feature}",
  "common.unused": "未使用",
  "common.none": "なし",
  "common.copyFailed":
    "コピーできませんでした。ブラウザーの権限を確認してください。",
  "common.copy": "コピー",
  "common.download": "ダウンロード",
  "common.delete": "削除",
  "common.deleteAriaLabel": "{name}を削除",
  "common.created": "作成: {datetime}",
  "common.identityFingerprint": "公開鍵セット指紋",
  "common.supplementalFingerprints": "補足のKEM鍵・署名鍵指紋",
  "common.fingerprintCompare": "比較表示: {value}",
  "common.loading": "読込中",
  "common.openKeysPage": "鍵ページを開く",
  "common.pastePayload": "ペイロードを貼り付ける",
  "common.na": "なし",
  "common.yes": "あり",

  "validation.name.required": "名前を入力してください",
  "validation.name.maxLength": "名前は80文字以内にしてください",
  "validation.name.invalidChars": "使用できない文字が含まれています",

  "presentation.framePosition": "{position}枚目",
  "presentation.frameSeparator": "、",

  "feature.camera": "カメラ",
  "network.online": "オンライン",
  "network.offline": "オフライン",
  "network.srLabel": "通信状態",

  "nav.encrypt": "暗号化",
  "nav.decrypt": "復号",
  "nav.keys": "鍵",
  "nav.settings": "設定",
  "nav.ariaLabel": "メインナビゲーション",
  "nav.top": "トップ",
  "nav.relay": "リレー",
  "nav.onlineAriaLabel": "オンラインナビゲーション",

  "errors.UNSUPPORTED_BROWSER":
    "このブラウザーでは必要な機能を利用できません。対応ブラウザーで開いてください。",
  "errors.INVALID_QR_PREFIX": "このQRコードは本アプリの形式ではありません。",
  "errors.INVALID_QR_PAYLOAD":
    "QRコードの内容を読み取れませんでした。形式が不正か、破損しています。",
  "errors.UNSUPPORTED_PROTOCOL_VERSION":
    "新しいバージョンのアプリで作成されたQRコードです。このインストールでは読み取れません。",
  "errors.UNSUPPORTED_ALGORITHM": "対応していない暗号方式です。",
  "errors.KEY_NOT_FOUND": "対応する鍵が見つかりません。",
  "errors.KEY_TYPE_MISMATCH": "選択した鍵はこの操作に使用できません。",
  "errors.ENCRYPTION_FAILED": "暗号化に失敗しました。入力内容を確認してください。",
  "errors.DECRYPTION_FAILED":
    "復号できませんでした。鍵、暗号方式、または暗号文が一致していません。",
  "errors.QR_TOO_LARGE":
    "データ量が多いため、この誤り訂正レベルではQRコードを生成できません。",
  "errors.STORAGE_FAILED": "保存領域の操作に失敗しました。",
  "errors.CAMERA_PERMISSION_DENIED":
    "カメラの使用が許可されていません。ブラウザーの設定で許可してください。",
  "errors.CAMERA_NOT_AVAILABLE": "カメラを利用できません。",
  "errors.QR_DECODE_PROGRESS_TIMEOUT":
    "この端末でQR復号パイプラインの進行が停止しました。",
  "errors.QR_READER_BLOCKED":
    "このブラウザーではQRコードリーダーがブロックされています。iPhoneではSafari 16以降を使用してください。",
  "errors.DUPLICATE_KEY": "同じ内容の鍵がすでに保存されています。",
  "errors.DUPLICATE_QR": "同じ内容のQRコードがすでに保存されています。",
  "errors.KEY_ID_CONFLICT":
    "この鍵IDのいずれかは、保存済みバンドルによってすでに予約されています。そのバンドルは利用停止済みで一覧に表示されていない場合もあります。取り込みを中止しました。",
  "errors.MESSAGE_ID_REUSED":
    "このメッセージは、このアプリウィンドウを読み込んでから既に確認したメッセージと同じ識別子を持ちながら、暗号文が異なります。平文は表示していません。この確認は同じアプリの別のタブやウィンドウとは共有されず、一時消去またはローカルデータの全消去でもリセットされ、件数に上限があるため古い記録から削除されます。",
  "errors.SIGNATURE_INVALID":
    "署名を検証できませんでした。送信者の署名鍵、または内容が一致していません。",
  "errors.SIGNING_KEY_NOT_FOUND":
    "この署名に対応する送信者の署名鍵が見つかりません。先に署名検証用の公開鍵を取り込んでください。",
  "errors.FRAME_MISMATCH":
    "異なる転送のQRコードが混在しています。読み取り状態を破棄してやり直してください。",
  "errors.WORKER_UNAVAILABLE":
    "この端末では暗号処理を安全に実行できませんでした。対応ブラウザーで開き直してください。",
  "errors.RESET_FAILED":
    "ローカルデータの初期化中に一部の操作が完了しませんでした。",

  "browser.unsupported.title": "このブラウザーでは利用できません",
  "browser.unsupported.body":
    "暗号化と端末内保存に必要な機能が不足しています。Web CryptoとIndexedDBに対応した最新のブラウザーで開いてください。",
  "browser.featureList.ariaLabel": "ブラウザー機能一覧",

  "boot.probing.status": "ネットワーク到達性とローカルデータを確認しています…",
  "boot.networkSuspected.title": "ネットワーク接続を検出しました",
  "boot.networkSuspected.body":
    "この端末はネットワークに接続されている可能性があり、接続がないことを確認できませんでした。秘密操作は閉じたままにします。VPN やコンテナブリッジなどの仮想インターフェースを含めてネットワークを切断し、再読み込みしてください。保存済みの鍵は変更も削除もされていません。",
  "boot.deploymentFailed.title": "サーバのセキュリティヘッダーが不正です",
  "boot.deploymentFailed.body":
    "サーバは応答しましたが、その応答に必要なセキュリティヘッダーが含まれていませんでした。このインストールは秘密操作に使用できません。_headers を適用する構成で配信し直してから再読み込みしてください。保存済みの鍵は変更も削除もされていません。",
  "boot.deploymentUnverified.title": "インストールが未検証です",
  "boot.deploymentUnverified.body":
    "このアドレスに対するサーバ検査の記録がないため、正しくインストールされたことを確認できません。初回インストール前とデータ初期化後には正常な状態です。サーバから一度アプリケーションを読み込み、その後ネットワークを切断して再読み込みしてください。サーバに異常はなく、保存済みの鍵も変更・削除されていません。",
  "boot.blocked.reload": "再読み込み",
  "boot.wiping.title": "ローカルデータを初期化しています",
  "boot.wiping.body": "完了するまでこの画面を閉じないでください。",
  "boot.wiped.title": "オンラインを検出したため、ローカルデータを初期化しました",
  "boot.wiped.body": "論理削除を試行しました。物理消去は保証されません。",
  "boot.wiped.backOnline": "オンラインページへ戻る",
  "boot.partialFailure.retryHint":
    "このタブを閉じてください。再び利用するには、端末を完全フォーマットしてからアプリを導入し直してください。",

  "gate.install.error":
    "インストールを開始できませんでした。ブラウザーのメニューから操作してください。",
  "gate.appIcon.alt": "{appName}のアプリアイコン",
  "gate.mode.label": "オンライン導入・メッセージリレー",
  "gate.heading": "PWAの導入",
  "gate.description":
    "オンラインでこのアプリを導入し、利用はオフラインで行ってください。暗号・復号、鍵、設定はオフライン専用です。",
  "pwa.installState.label": "PWAインストール状態",
  "pwa.installState.installed": "インストール済み",
  "pwa.installState.notInstalled": "未インストール",
  "pwa.offlineReady.label": "オフライン利用準備状態",
  "pwa.offlineReady.ready": "準備完了",
  "pwa.offlineReady.preparing": "準備中",
  "pwa.registerError": "Service Workerを登録できませんでした。",
  "pwa.offlineReady.toast": "オフライン利用の準備ができました",
  "gate.install.progress": "インストール中…",
  "gate.install.button": "PWAをインストール",
  "gate.install.iosHint":
    "Safariの共有メニューから「ホーム画面に追加」を選んでください。",
  "gate.install.otherHint":
    "ブラウザーのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。",
  "gate.switchOffline.title": "オフラインに切り替えてください",
  "gate.switchOffline.body":
    "暗号機能を使うには、機内モードなどでこの端末をオフラインにし、表示されるリスク確認に同意してください。オフラインにしても、侵害された端末が安全になるわけではありません。",
  "gate.about.link": "このアプリでできること",

  "relay.card.title": "メッセージリレー",
  "relay.card.description":
    "QRコードとテキストで、メッセンジャーとオフライン端末の間で暗号化済みメッセージを受け渡します。走査で鍵・PQ identity・Vaultが無いと確認できた端末でのみ使え、復号は行わず、鍵も使いません。",
  "relay.boundary.title": "信頼しない中継境界",
  "relay.boundary.body":
    "このリレーは暗号化済みメッセージフレーム(OCF2のpq-messageまたはsym-message)だけを受け入れます。形式だけを検査し、復号や検証は行いません。フレームはこのページのメモリーにセッション中だけ保持され、アプリが管理する永続化は行いません。ペイロードを含むネットワークリクエストは行いません。コピー操作ではテキストがシステムのクリップボードに置かれ、その後はアプリの制御外になります。送信者が決めた値(暗号文・transferId・IV・createdAt)は隠れたデータを運べ、受信側のオフライン端末が認証するまで信頼できません。鍵の交換は必ず対面で行い、このリレーでは行わないでください。",
  "relay.capture.open": "QR → テキスト",
  "relay.capture.unavailable":
    "この端末ではカメラを利用できません。テキストからQRへの再生は利用できます。",
  "relay.capture.title": "QRをテキスト化",
  "relay.capture.description":
    "カメラを開始し、オフライン端末に表示されるQRフレームをすべて読み取ってください。",
  "relay.capture.video.ariaLabel": "メッセージリレーのカメラプレビュー",
  "relay.capture.startCamera": "カメラを開始",
  "relay.capture.cameraActive": "カメラ動作中",
  "relay.capture.progress": "{collected} / {total} フレーム収集済み",
  "relay.capture.missing": "不足フレーム: {indexes}",
  "relay.capture.output.label": "中継テキスト",
  "relay.capture.copy": "中継テキストをコピー",
  "relay.copy.warning":
    "コピーすると中継テキストをシステムのクリップボードへ書き出します。内容はアプリ外に残存・同期する可能性があり、アプリのresetでは消去されません。",
  "relay.playback.open": "テキスト → QR",
  "relay.playback.title": "中継テキストをQR化",
  "relay.playback.description":
    "受け取った中継テキストをそのまま貼り付け、QRコードをオフライン端末に見せてください。",
  "relay.playback.input.label": "中継テキスト",
  "relay.playback.show": "QRを表示",
  "relay.playback.missing": "不足フレーム: {indexes}",
  "relay.playback.screenCaptureWarning":
    "表示したQR画像は長押し保存、印刷、スクリーンショット、画面録画で保存される可能性があります。",
  "relay.playback.qrTitle": "中継されたメッセージフレーム",
  "relay.playback.noDownloadControls":
    "このリレーはアプリによるファイルダウンロード操作を提供しません。",
  "relay.image.open": "QR → QR",
  "relay.image.hint":
    "QR → QR は、メッセージアプリが画像の貼り付けに対応し、メッセージが1枚のQRコードに収まる場合だけ使えます。",
  "relay.image.title": "QRをQR画像化",
  "relay.image.description":
    "カメラを開始し、オフライン端末に表示されるQRコードを読み取ってください。画像として中継できるのは1フレームのメッセージだけです。",
  "relay.image.alt": "中継メッセージのQRコード",
  "relay.image.copy": "QR画像をコピー",
  "relay.image.copyWarning":
    "コピーするとQR画像をシステムのクリップボードへ書き出します。内容はアプリ外に残存・同期する可能性があり、アプリのresetでは消去されません。",
  "relay.error.title": "中継入力を拒否しました",
  "relay.error.empty": "1つ以上のOCF2フレームを入力・スキャンしてください。",
  "relay.error.prefix":
    "正規OCF2フレーム文字列だけを受け入れます。",
  "relay.error.kindMismatch":
    "1回の中継が運ぶのはpq-messageかsym-messageのどちらか一方のフレームだけです。",
  "relay.error.outerType":
    "フレームの外側ヘッダーがpq-messageまたはsym-messageを表明していません。",
  "relay.error.invalidFrame": "正規OCF2フレームではありません。",
  "relay.error.mismatch":
    "この中継セッションが既に受理した内容に属さないペイロードです。",
  "relay.error.length": "表明された長さと収集した長さが一致しません。",
  "relay.error.incomplete":
    "フレーム一式が不完全です。再生前に不足フレームをすべて追加してください。",
  "relay.error.inputSize": "中継テキストがプロトコル上限を超えています。",
  "relay.error.timeout":
    "中継セッションが時間切れになり、アプリが保持していたペイロード参照を解放しました。",
  "relay.error.busy":
    "この端末のローカル保存領域を別の操作が使用中です。終了してからやり直してください。",
  "relay.error.copy": "中継テキストをコピーできませんでした。",
  "relay.error.multiFrame":
    "このメッセージは複数のQRフレームに分かれています。QR → テキストを使ってください。",
  "relay.error.copyImage": "QR画像をコピーできませんでした。",

  "offlineAck.status": "オフラインへ切り替わりました",
  "offlineAck.title": "続行前の確認",
  "offlineAck.body.assumption":
    "このアプリは「ネットワークに接続した端末は常に侵害されうる」という前提で設計されています。オンライン状態から機内モードやネットワーク切断を選んでも、それによって端末が信頼できる状態に戻るわけではありません。オンライン中に侵害されたコード・鍵・データは、オフライン化後もそのまま残り得ます。",
  "offlineAck.body.riskPrefix":
    "リスクを抑えるには、ネットワークから物理的に遮断し、",
  "offlineAck.body.neverReconnect": "二度と接続しない",
  "offlineAck.body.riskSuffix":
    "専用端末として運用する必要があります。それ以外に、完全に安全にメッセージの暗号化を行う方法はありません。",
  "offlineAck.body.noGuarantee":
    "それでも、端末や導入済みコードを含めた完全な安全を本アプリが保証するものではありません。",
  "offlineAck.ackLabel":
    "上記を理解した上で、リスクを受け入れてこの端末で続行します",
  "offlineAck.ackHint":
    "このチェックは端末の安全性を検証・回復するものではありません",
  "offlineAck.continue": "リスクを理解してオフライン機能を表示",
  "offlineAck.reload": "再読み込みして続行",

  "algorithm.A256GCM": "共有鍵 AES-256-GCM",
  "algorithm.MLKEM1024_MLDSA87_A256GCM":
    "公開鍵 ML-KEM-1024 + ML-DSA-87 + AES-256-GCM",

  "qrDisplay.defaultTitle": "QRコード",
  "qrDisplay.notQrCryptPayload":
    "本アプリのペイロードではないためQRコードを生成できません。",
  "qrDisplay.error.title": "QRコードを生成できません",
  "qrDisplay.image.alt": "{title}の画像",
  "qrDisplay.generating": "QRコードを生成しています…",
  "qrDisplay.fullscreen.button": "全画面表示",
  "qrDisplay.fullscreen.title": "{title}を全画面表示",
  "qrDisplay.fullscreen.desc": "白い背景にQRコードを全画面で表示します。",
  "qrDisplay.fullscreen.imageAlt": "{title}の全画面画像",

  "animatedQr.defaultTitle": "複数QR",
  "animatedQr.empty.title": "表示できるフレームがありません",
  "animatedQr.empty.body": "複数QRを作り直してください。",
  "animatedQr.section.ariaLabel": "{title}フレーム表示",
  "animatedQr.missing.title": "フレームが欠損しています",
  "animatedQr.missing.body":
    "欠損フレーム: {indexes}。欠損したままでは復元できません。",
  "animatedQr.frameTitle": "{title} {current} / {total}",
  "animatedQr.prev": "前へ",
  "animatedQr.play": "再生",
  "animatedQr.pause": "一時停止",
  "animatedQr.next": "次へ",
  "animatedQr.compatibility.label": "互換モード",
  "animatedQr.densityRaised":
    "フレーム数の上限内に収めるため、フレーム密度をこれ以上下げられませんでした。",
  "animatedQr.export.error.title": "フレームを出力できません",

  "keyDetail.rename.label": "鍵の名前",
  "keyDetail.rename.submit": "改名",
  "keyDetail.rename.saved": "鍵を改名しました",
  "keyDetail.qr.outputName": "{title}-{date}",
  "keyDetail.toast.rotated": "公開鍵をローテーションしました",
  "keyDetail.toast.symmetricRotated": "共有鍵をローテーションしました",
  "keyDetail.toast.revoked": "この端末で公開鍵を失効しました",
  "keyDetail.toast.symmetricDeleted": "共有鍵を削除しました",
  "keyDetail.toast.identityDeleted": "公開鍵を削除しました",
  "keyDetail.toast.supersededDestroyed": "旧世代の鍵素材を破棄しました",
  "keyDetail.toast.copied":
    "コピーしました。クリップボード同期に注意してください。",
  "keyDetail.symmetricQr.title": "共有鍵QR",
  "keyDetail.identityQr.title": "{name} 公開鍵",
  "keyDetail.identityQr.desc":
    "このQRには暗号化と署名検証に使う公開鍵が含まれます。",
  "keyDetail.symmetricQr.desc":
    "このQRには暗号化と復号に使える秘密鍵が含まれます。",
  "keyDetail.backToDetail": "詳細に戻る",
  "keyDetail.delete.titleNamed": "「{name}」を削除しますか?",
  "keyDetail.delete.titleGeneric": "鍵を削除しますか?",
  "keyDetail.delete.body.identity":
    "この公開鍵宛の暗号文は復号できなくなります。失効と異なり元に戻せません。",
  "keyDetail.delete.body.symmetric":
    "この鍵で暗号化した暗号文は復号できなくなります。元に戻せません。",
  "keyDetail.delete.confirm": "削除する",
  "keyDetail.destroy.title": "旧世代 {count} 件を破棄しますか?",
  "keyDetail.destroy.body":
    "作成日時: {dates}。このアプリがこれらの世代のために開いたままにしている復号経路を閉じます。これらの鍵宛に送られ、まだ復号していないメッセージは、ここでは開けなくなります。論理削除のため記録媒体からバイト列が消える保証はなく、既に別タブへ読み込まれた複製はこの操作の対象外です。",
  "keyDetail.destroy.confirm": "破棄する",
  "keyDetail.badge.legacyProfile": "非対応（旧プロファイル）",
  "keyDetail.identity.legacyNote":
    "非対応（旧プロファイル）: 暗号処理とQR再出力はできません。",
  "keyDetail.identity.oldNote": "旧世代: 復号/検証専用",
  "keyDetail.identity.activeNote": "暗号化・署名に使用可能",
  "keyDetail.identity.kemFingerprintLabel": "暗号化用公開鍵 {algorithm}",
  "keyDetail.identity.signingFingerprintLabel": "署名検証用公開鍵 {algorithm}",
  "keyDetail.button.showPublicKeyQr": "公開鍵QRを表示",
  "keyDetail.button.rotate": "ローテーション",
  "keyDetail.button.revoke": "この端末で失効",
  "keyDetail.revokeNote":
    "失効はこの公開鍵での署名と、現在の宛先としての公開をこの端末で止めるもので、外部の相手には伝播しません。この公開鍵での復号は止まりません。鍵素材を手放すには削除を使ってください。",
  "keyDetail.previous.toggle": "旧世代 {count} 件、復号専用",
  "keyDetail.previous.destroyAll": "旧世代 {count} 件の鍵素材を破棄",
  "keyDetail.symmetric.fingerprintLabel": "鍵指紋",
  "keyDetail.button.showSecretQr": "秘密鍵QRを表示",

  "keyStatus.active": "有効",
  "keyStatus.rotated": "更新済み",
  "keyStatus.revoked": "失効",

  "keyList.action.create": "鍵を作成",
  "keyList.action.import": "鍵QRを読み取る",
  "keyList.error.identity": "公開鍵を読み込めません",
  "keyList.error.symmetric": "共有鍵を読み込めません",
  "keyList.error.peer": "相手の鍵を更新できません",
  "keyList.tab.own": "自分の鍵",
  "keyList.tab.peer": "相手の鍵",
  "keyList.filter.label": "種別",
  "keyList.filter.all": "すべて",
  "keyList.filter.pqIdentity": "公開鍵",
  "keyList.filter.symmetric": "共有鍵",
  "keyList.item.identityMeta": "公開鍵 · {datetime}",
  "keyList.item.supersededWarning": "旧世代 {count} 件が復号可能",
  "keyList.item.symmetricMeta": "共有鍵 · {datetime}",
  "keyList.empty.ownAll": "自分の鍵がありません。",
  "keyList.empty.ownFiltered": "選択した種別の鍵がありません。",
  "keyList.bundle.empty": "取り込んだ公開鍵セットがありません。",
  "keyList.bundle.itemMeta": "取り込み {datetime}",
  "keyList.bundle.nameConfirmed": "確認済み公開鍵",
  "keyList.bundle.nameUnverified": "未確認の公開鍵",
  "keyList.bundle.badge.confirmed": "人物確認済み",
  "keyList.bundle.badge.unverified": "未確認",
  "keyList.bundle.fingerprintKem": "受信公開鍵 {algorithm}",
  "keyList.bundle.fingerprintSigning": "署名公開鍵 {algorithm}",
  "keyList.bundle.legacyNote":
    "非対応（旧プロファイル）のため、削除以外の操作はできません。",
  "keyList.bundle.revoke": "利用停止",
  "keyList.bundle.revokeTitle": "この公開鍵セットを利用停止にしますか?",
  "keyList.bundle.revokeBody":
    "利用停止にするとこの行は非表示になり、このインストールでは署名鍵IDとKEM鍵IDの両方が永久に予約されます。元に戻せず、その後この画面からバンドルを削除することもできません。予約を解除できるのはローカルデータの全消去だけです。両方のIDを解放する必要がある場合は、利用停止せずにバンドルを削除してください。",
  "keyList.bundle.revokeConfirm": "利用停止にする",
  "keyList.bundle.confirmOpen": "指紋を比較して確認する",
  "keyList.bundle.confirmTitle": "この識別子の指紋を確認しますか?",
  "keyList.bundle.confirmBody":
    "公開鍵セット指紋の16進数64桁すべてを、意図した相手本人の端末に表示された値と、通話や対面など独立した別経路で照合してください。KEM鍵・署名鍵の指紋は補足情報です。確認するとその事実が記録され、この識別子が暗号化の宛先として選べるようになります。比較そのものをアプリが検証することはできません。",
  "keyList.bundle.confirmCheck":
    "公開鍵セット指紋の16進数64桁すべてを、意図した相手本人と独立した別経路で照合し、すべて一致することを確認しました",
  "keyList.bundle.confirmSubmit": "確認する",
  "keyList.toast.bundleConfirmed": "指紋を確認しました",

  "keys.validation.keyNameFallback": "鍵名を確認してください。",
  "keys.validation.idNameFallback": "公開鍵名を確認してください。",
  "keys.toast.symmetricCreated": "共有鍵を作成しました",
  "keys.toast.identityCreated": "公開鍵を作成しました",
  "keys.toast.symmetricImported": "共有鍵を取り込みました",
  "keys.toast.bundleConfirmed": "指紋確認済みで保存しました",
  "keys.toast.bundleUnverified": "未確認のまま保存しました",
  "keys.import.symmetricDefaultName": "取込共有鍵-{date}",
  "keys.tab.create": "作成",
  "keys.tab.import": "読込",
  "keys.import.cameraTitle": "カメラで読み取る",
  "keys.import.scanTrigger": "鍵QRを読み取る",
  "keys.import.payloadLabel": "鍵ペイロード",
  "keys.import.payloadPlaceholder": "OCK2: / OCI2: を貼り付け",
  "keys.import.readButton": "鍵を読み取る",
  "keys.bundle.dialogTitle": "別経路で指紋を比較してください",
  "keys.bundle.dialogDesc":
    "取込を完了する前に、公開鍵セット指紋の16進数64桁すべてを、意図した相手本人と通話・対面など独立した別経路で照合してください。KEM鍵・署名鍵の指紋は補足情報です。自己署名だけでは人物を証明しません。未確認のまま保存した識別子は暗号化の宛先に選べませんが、保存済み鍵の画面から後で指紋を確認できます。",
  "keys.bundle.fingerprintKem": "ML-KEM鍵指紋",
  "keys.bundle.fingerprintSigning": "ML-DSA鍵指紋",
  "keys.bundle.confirmLabel":
    "公開鍵セット指紋の16進数64桁すべてを、意図した相手本人と独立した別経路で照合し、すべて一致することを確認しました",
  "keys.bundle.saveUnverified": "未確認のまま保存",
  "keys.bundle.saveConfirmed": "確認して保存",
  "keys.symmetricImport.dialogTitle": "共有鍵を取り込みます",
  "keys.symmetricImport.dialogDesc":
    "このペイロードには暗号化と復号に使える秘密鍵が含まれます。",
  "keys.symmetricImport.warnTitle": "共有経路を確認してください",
  "keys.symmetricImport.warnBody":
    "第三者が同じ鍵を持つと、暗号文を復号されるおそれがあります。",
  "keys.symmetricImport.nameLabel": "鍵名",
  "keys.symmetricImport.fingerprintHint":
    "この共有鍵指紋の16進数64桁すべてを、意図した送信者本人と独立した別経路で照合してください",
  "keys.symmetricImport.ackLabel":
    "この共有鍵指紋の16進数64桁すべてを、意図した送信者本人と独立した別経路で照合し、すべて一致することを確認しました",
  "keys.symmetricImport.saveButton": "共有鍵を保存",
  "keys.demo.hint":
    "相手の画面の輝度を上げてもらい、カメラを15〜20cmほど離してピントが合うまで静止すると読み取りやすくなります。",
  "keys.create.nameLabel.pq": "公開鍵名",
  "keys.create.nameLabel.symmetric": "共有鍵名",
  "keys.create.button.pq": "公開鍵を作成",
  "keys.create.button.symmetric": "共有鍵を作成",
  "keys.create.kindLabel": "鍵の種類",
  "keys.create.kind.pqIdentity": "公開鍵 ML-KEM-1024 + ML-DSA-87",
  "keys.create.experimentalNote": "experimental・未独立監査",

  "encrypt.toast.autoCleared": "平文と一時結果を自動消去しました",
  "encrypt.output.suggestedName": "暗号結果-{date}",
  "encrypt.toast.plaintextClearedByPref":
    "設定に従って平文を消去しました",
  "encrypt.toast.payloadCopied": "ペイロードをコピーしました",
  "encrypt.validation.outputNameFallback": "出力名を確認してください。",
  "encrypt.srHeading": "暗号化",
  "decrypt.srHeading": "復号",
  "decrypt.cameraTitle": "カメラで読み取る",
  "decrypt.scanTrigger": "暗号文QRを読み取る",
  "decrypt.payloadLabel": "暗号文ペイロード",
  "decrypt.payloadPlaceholder":
    "OCA2: または OCM2: ペイロードを貼り付けてください",
  "decrypt.invalidTitle": "暗号文を確認できません",
  "decrypt.invalidBody":
    "対応するOCA2/OCM2暗号文を入力してください。",
  "decrypt.button.busy": "復号中…",
  "decrypt.button.idle": "復号する",
  "decrypt.pqUnsupported.body":
    "この暗号文は現在利用できない旧ポスト量子プロファイルです。",
  "decrypt.signingKeyId": " 鍵ID: {id}",
  "decrypt.importSigningKey": "署名鍵を取り込む",
  "decrypt.result.modalTitle": "復号が完了しました",
  "decrypt.result.symmetric": "共有鍵メッセージ",
  "decrypt.result.signatureValid": "署名はこの鍵に対して有効です",
  "decrypt.result.senderSigningKeyId": "送信者署名鍵ID: {id}",
  "decrypt.result.identityCheck.label": "人物確認:",
  "decrypt.result.identityCheck.confirmed": "人物確認済み",
  "decrypt.result.identityCheck.unverified":
    "未確認。鍵の有効性と人物確認は別です。",
  "decrypt.result.identityUnconfirmed.title": "送信者の本人確認が取れていません",
  "decrypt.result.identityUnconfirmed.body":
    "署名が有効であることは、このメッセージがこの鍵で署名されたことだけを示します。その鍵を誰が持っているかは示しません。内容に従って行動する前に、対面でフィンガープリントを確認してください。",
  "decrypt.result.senderCreatedAt":
    "送信端末の申告時刻: {time}(送信側の申告であり検証されていません)",
  "decrypt.result.replay.title": "このセッションで受信済みです",
  "decrypt.result.replay.body":
    "この暗号文は {time} にこのアプリウィンドウで復号済みです。単なる再読の場合もあれば、古いメッセージを再送されている場合もあります。中の指示は未確認として扱ってください。この確認の範囲は、このアプリウィンドウを読み込んでからの記録だけです。同じアプリの別のタブやウィンドウとは共有されず、一時消去またはローカルデータの全消去でもリセットされ、件数に上限があるため古い記録から削除されます。",
  "decrypt.result.replay.reveal": "それでも表示する",
  "decrypt.result.invisibleCharacters.title": "不可視文字が検出されました",
  "decrypt.result.invisibleCharacters.body":
    "このメッセージには不可視文字または文字方向を変えるUnicode文字が含まれています。検出数: {count}。内容に従って行動する前に、表示された文章を注意して確認してください。",
  "decrypt.result.memoryOnly":
    "復号結果はメモリー内だけに保持し、保存しません。",
  "encrypt.algorithmLabel": "暗号化方式",
  "encrypt.keyLabel": "使用鍵",
  "encrypt.recipientLabel": "受信者のML-KEM公開鍵",
  "encrypt.recipient.confirmed": "確認済み",
  "encrypt.recipient.needsConfirmation":
    "確認済みの宛先がありません。公開識別子は、相手と別の経路で指紋を比較し、保存済み鍵の画面で確認したものだけがここで選べるようになります。",
  "encrypt.senderLabel": "自分のML-DSA署名ID",
  "encrypt.plaintextLabel": "平文",
  "encrypt.clearPlaintext": "平文を消去",
  "encrypt.plaintextPlaceholder": "暗号化する文章を入力してください",
  "encrypt.charCount": "{count} 文字",
  "encrypt.overLimit.title": "平文の上限を超えています",
  "encrypt.overLimit.body":
    "UTF-8で{max}バイト以内に短くしてください。",
  "encrypt.encryptButton.busy": "暗号化中…",
  "encrypt.encryptButton.idle": "暗号化する",
  "encrypt.detail.method": "方式",
  "encrypt.detail.recipientKeyId": "受信者鍵ID",
  "encrypt.result.modalTitle": "暗号化が完了しました",
  "encrypt.result.copyPayload": "ペイロードをコピー",
  "encrypt.result.qrTitle": "暗号文QR",
  "encrypt.result.pqTitle": "暗号文",
  "encrypt.result.outputNameLabel": "出力名",
  "encrypt.result.detailAria": "暗号結果詳細",
  "encrypt.result.detailTitle": "結果詳細",
  "encrypt.detail.suite": "使用暗号スイート",
  "encrypt.detail.senderSigningKeyId": "送信者署名鍵ID",
  "encrypt.detail.totalBytes": "総データ量",
  "encrypt.detail.frameCount": "QRフレーム数",
  "encrypt.detail.frameCountValue": "{count} 枚",
  "encrypt.detail.encryptedAt": "暗号化日時",
  "encrypt.detail.signature": "署名",
  "encrypt.detail.pqProfile": "ポスト量子プロファイル",
  "encrypt.detail.notApplicable": "対象外",
  "encrypt.detail.wholeSha256": "全体SHA-256",
  "encrypt.recordSelect.loading": "読み込み中…",
  "encrypt.recordSelect.placeholder": "選択してください",
  "encrypt.recordSelect.noKeys": "使用できる鍵がありません。",

  "scanner.payloadLabel.foreign": "本アプリ以外",
  "scanner.acceptedLabel.multipart": "複数QR",
  "scanner.mismatch":
    "受理対象外のQRです({actual})。この画面では{accepted}を読み取れます。",
  "scanner.defaultTitle": "QRコードを読み取る",
  "scanner.stopHint.multipart":
    "カメラ画像は保存されません。閉じる・破棄ボタン・画面離脱で停止します。",
  "scanner.status.idlePrompt": "起動ボタンを押すとカメラを開始します",
  "scanner.status.deliverFailed": "取り込みを完了できませんでした",
  "scanner.status.delivering": "取り込み中です…",
  "scanner.status.allFramesRead": "全フレームを読み取りました",
  "scanner.error.videoNotReady":
    "カメラ画面を準備できませんでした。ページを開き直してください。",
  "scanner.status.videoNotReady": "カメラ画面を準備できませんでした",
  "scanner.status.preparing": "カメラを準備しています…",
  "scanner.status.readerLoading": "QRリーダーを読み込んでいます…",
  "scanner.reader.reloadHint":
    "QRリーダーを準備できませんでした。ページを再読み込みしてからやり直してください。",
  "scanner.status.multipartReading": "複数QRを読み取り中です",
  "scanner.status.multipartError":
    "複数QRの読取状態にエラーがあります",
  "scanner.error.expiredDiscarded":
    "読取期限を過ぎたため、一時読取状態を破棄しました。",
  "scanner.status.stateDiscarded": "読取状態を破棄しました",
  "scanner.status.multipartReadingUnordered":
    "複数QRを順不同で読み取り中です",
  "scanner.status.unacceptedRejected": "受理対象外のQRを拒否しました",
  "scanner.status.cameraError": "カメラでエラーが発生しました",
  "scanner.status.startFailed": "カメラを起動できませんでした",
  "scanner.status.readUnordered": "QRコードを順不同で読み取れます",
  "scanner.status.discardedCanStart":
    "読取状態を破棄しました。起動ボタンでカメラを開始できます",
  "scanner.error.hiddenStopped":
    "画面が非表示になったためカメラを停止しました。再起動ボタンで再開できます。",
  "scanner.status.leftScreenStopped":
    "画面離脱によりカメラを停止しました",
  "scanner.error.cameraUnavailable":
    "この端末ではカメラを利用できません。ペイロードを貼り付けてください。",
  "scanner.status.cameraUnavailable": "カメラを利用できません",
  "scanner.error.stateDiscardedGeneric": "読取状態が破棄されました。",
  "scanner.video.ariaLabel": "QRコード読取用カメラ映像",
  "scanner.button.restart": "カメラを再起動",
  "scanner.button.start": "カメラを起動",
  "scanner.button.reload": "再読み込み",
  "scanner.progress.ariaLabel": "複数QR読取進捗",
  "scanner.progress.received": "受信 {received} / {total}",
  "scanner.progress.missingIndex": "欠損フレーム: {indexes}",
  "scanner.progress.expiresAt": "読取期限: {time}",
  "scanner.frameSetComplete":
    "必要な全フレームを受信しました。フレームのメタデータ・フレーム番号・合計長・形式の整合性を確認しました。",
  "scanner.frameSetNotice":
    "この確認は転送中の欠損・重複・他転送の混在を検出するものです。成果物の内容は検証せず、送信者の真正性も証明しません。",
  "scanner.error.title": "読み取りを完了できません",
  "scanner.button.discard": "読取状態を破棄",
  "scanner.closed.multipartProgress":
    "複数QR読取中: 受信 {received} / {total}",
  "scanner.closed.frameSetImported": "複数QRの全フレームを受信し、取り込みました。",

  "settings.error.saveFailed":
    "設定を保存できませんでした。保存領域を確認してください。",
  "settings.toast.plaintextCleared": "すべての平文を消去しました",
  "settings.toast.keysCleared": "すべての鍵を消去しました",
  "settings.error.deleteFailed":
    "データを消去できませんでした。保存領域を確認してください。",
  "settings.toast.maintenanceArmed":
    "次の一回だけ鍵を保持する設定を arm しました",
  "settings.error.maintenanceFailed":
    "maintenance tokenを設定できませんでした。オフライン状態を確認してください。",
  "settings.title": "設定",
  "settings.card.display": "表示",
  "settings.field.theme": "テーマ",
  "settings.theme.system": "システム",
  "settings.theme.light": "ライト",
  "settings.theme.dark": "ダーク",
  "settings.card.defaults": "既定値",
  "settings.field.defaultAlgorithm": "デフォルト暗号方式",
  "settings.card.pqMessage": "ポスト量子メッセージ",
  "settings.field.transferTimeout":
    "読取状態の期限 {min}〜{max} 分",
  "settings.frameEc.hint": "OCF2フレームの誤り訂正は常にQです。",
  "settings.card.plaintext": "平文の扱い",
  "settings.autoClearAfterEncrypt.label": "暗号化後に平文を自動消去",
  "settings.backgroundClear.label": "バックグラウンド移行後に自動消去",
  "settings.backgroundClear.desc":
    "有効時はバックグラウンド移行から{normalSeconds}秒後に平文を消去します。QRリーダーが必要とするWebAssemblyランタイムが使えない場合は、代わりに{fallbackSeconds}秒後に消去します。",
  "settings.clearAllPlaintext": "すべての平文を消去",
  "settings.card.onlineProtection": "オンライン検出時の保護",
  "settings.wipeOnOnline.label":
    "オンライン確定時にローカルデータを初期化",
  "settings.wipeOnOnline.hint":
    "既定ON。専用sentinelの本文一致後だけ実行します。",
  "settings.wipeOnOnline.offTitle": "ローカルデータが残り続けます",
  "settings.wipeOnOnline.offBody":
    "永続OFFでは、接続を検出しても鍵とローカルデータを自動初期化しません。",
  "settings.wipeOff.title": "オンライン確定時の自動初期化を無効にしますか？",
  "settings.wipeOff.body":
    "この設定をOFFにすると、オンライン接続が確定しても鍵とローカルデータは自動初期化されません。「DISABLE WIPE」と入力し、この結果を確認してください。",
  "settings.wipeOff.acknowledge":
    "オンライン接続が確定しても鍵とローカルデータが自動初期化されなくなることを理解しました",
  "settings.wipeOff.confirm": "自動初期化を無効にする",
  "settings.wipeOff.cancel": "キャンセル",
  "settings.maintenance.button": "次のオンライン確定時だけ鍵を保持",
  "settings.maintenance.hint":
    "オフライン中だけ arm できます。暗号文保存の救済経路ではなく、次の verified transition 後に必ず失効します。",
  "settings.maintenance.onlineDisabled": "オンライン中は設定できません。",
  "settings.advanced.title": "Advanced: reset churn",
  "settings.advanced.field": "reset churn ({min}–{max} MB)",
  "settings.resetChurn.warning":
    "既定は0です。churnは消去保証にならず、物理データの回収不能を保証しません。",
  "settings.dataDeletion.title": "データの消去",
  "settings.deleteAllKeys": "すべての鍵を消去",
  "settings.resetAllData": "全ローカルデータ初期化",
  "settings.dataDeletion.note":
    "全初期化はIndexedDBの全ストア、oc-*のlocalStorage、メモリー内の一時データを消去します。オフライン起動を維持するためService Workerのキャッシュは保持します。",
  "settings.card.pwaInfo": "PWAアプリ情報",
  "settings.pwa.browserView": "ブラウザー表示中",
  "settings.sw.unavailable":
    "この機能は利用できません: Service Worker。オフライン起動を利用できません。",
  "settings.pwa.noUpdatePolicy":
    "アプリの更新は行わない方針です。新しいバージョンの利用には端末の完全フォーマット後の再インストールが必要です。",
  "settings.info.version": "バージョン",
  "settings.info.build": "ビルド",
  "settings.pwa.offlineReadyNote":
    "オフライン利用準備状態は、このページがインストール済みの Service Worker によって制御されていることを示します。安全性を示すものではありません。",
  "settings.card.featureDetect": "機能検出",
  "settings.featureDetect.note":
    "Web CryptoまたはIndexedDBが利用できない場合はUNSUPPORTED_BROWSER画面で全機能を停止します。",
  "settings.security.title": "セキュリティについて",
  "settings.security.scope":
    "このアプリが保証するのは、アプリケーションが意図的に平文や秘密鍵を外部送信しないことまでです。",
  "settings.security.outOfScope.heading": "防御対象外:",
  "settings.security.outOfScope.1": "OS・ブラウザー・ファームウェアの侵害",
  "settings.security.outOfScope.2":
    "キーロガー・画面録画・スクリーンショット",
  "settings.security.outOfScope.3":
    "カメラフレームを取得するマルウェア",
  "settings.security.outOfScope.4":
    "PWA初回取得時・再インストール時の供給網侵害",
  "settings.security.outOfScope.5": "端末の物理的な窃取",
  "settings.security.outOfScope.6":
    "ユーザー自身による秘密QRの誤共有",
  "settings.security.outOfScope.7":
    "ブラウザーデータ削除による鍵の消失",
  "settings.security.offlineDisplayNote":
    "オフライン表示は現在のネットワーク状態を示す補助情報であり、安全性の証明ではありません。",
  "settings.security.caveat.1":
    "採用している noble の本アプリ統合は独立監査を完了していません。",
  "settings.security.caveat.2":
    "JavaScript実装はサイドチャネル耐性を保証しません。",
  "settings.security.caveat.3":
    "JavaScriptとGCのため、メモリー上の秘密値を完全消去できる保証はありません。",
  "settings.security.caveat.4":
    "resetはローカルデータの論理削除を試行します。LevelDB・SSDウェアレベリングを含め、物理消去は保証しません。",
  "settings.security.wipeOnOnlineNote":
    "wipe-on-onlineは、接続後に現在のコードが実行できた場合の残存データ低減です。同一オリジンの悪意あるコード、物理回収、現在のコードより前に実行された侵害コードを防ぎません。",
  "settings.maintenance.dialogDesc":
    "次のオンライン確定時にwipeを一度だけ抑止します。実行するには「KEEP KEYS」と入力し、注意事項を確認してください。",
  "settings.confirmationLabel": "確認文字列",
  "settings.maintenance.ackLabel":
    "一回限りであり、その移行後に動作するコードや端末状態の安全性を保証しないことを理解しました",
  "settings.maintenance.armButton": "maintenance tokenをarm",
  "settings.delete.desc.keys":
    "すべての暗号文が復号できなくなります。削除を実行するには「DELETE ALL」と入力してください。",
  "settings.delete.desc.reset":
    "IndexedDBとoc-*設定、一時データを消去します。Service Workerキャッシュは保持します。実行するには「DELETE ALL」と入力してください。",
  "settings.delete.working": "消去中…",
  "settings.delete.execute": "論理削除を実行",
  "hooks.preferences.loadFailed":
    "設定を読み込めませんでした。既定値を使用します。",
  "hooks.keys.loadFailed":
    "鍵を読み込めませんでした。保存領域を確認してください。",
  "hooks.pqRecords.loadFailed": "公開鍵を読み込めませんでした。",
} as const satisfies MessageCatalog
