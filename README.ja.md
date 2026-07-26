# QR Crypt

English version: [README.md](README.md)

## 概要

> 一度オンラインにした端末は侵害されている可能性がある。鍵交換・暗号化・復号は、
> 完全にオフラインのままの端末で行わなければならない。

オフライン端末として導入した端末は、二度とオンラインにしません。使用をやめるときは、媒体に応じた
sanitization 手順（例: NIST SP 800-88）を実施するか、媒体を物理破壊します。アプリ自身の wipe では
足りない理由は下の免責事項を参照してください。

QR Crypt は、恒久的にオフラインで使う端末へ導入する Progressive Web App です。メッセージを
入力するとその端末上で暗号化し、暗号文を QR コードとして画面に表示します。普段使いのオンライン
端末でその QR を読み取ると文字列に戻るので、あとは任意のメッセンジャーで送ります。受信側は逆の
手順をたどります。本当のメッセージを見るのは 2 台のオフライン端末だけです（ただしメッセンジャーを
見ている者には、大きさと分割数は分かります）。

**すること**: オフライン端末上での暗号化・復号（AES-256-GCM またはポスト量子スイート
ML-KEM / ML-DSA）、鍵生成・管理、QR の表示・読取、PWA としてのオフライン起動。

**しないこと**: 平文や秘密鍵の外部送信、クラウド上の鍵保管、独自暗号アルゴリズム、CDN 依存の
ランタイム、オフライン表示を安全性の証明として扱うこと、メッセージ暗号文のアプリ内保持。
利用者自身が出力した PNG やフレームの ZIP、クリップボードの内容はアプリの管理外であり、wipe の
対象外です。

### 他の暗号化アプリとの違い

1 点だけです。完全オフラインで運用すること。それは次の 2 つの習慣に分かれます。

* **鍵交換をオフラインで行う。** 鍵と公開鍵は QR コードとして対面で交換します。間にサーバーは
  なく、クラウドの鍵預託もアカウント同期もありません。鍵はオフライン端末の IndexedDB にのみ
  存在します。
* **オフライン端末とオンライン端末の間は QR コードでデータを移す。** その境界を越えるのは光だけ
  です。片方の画面の QR コードと、もう片方のカメラ。

アルゴリズム自体は標準のものです。主張しているのは、それをどこで動かすかです。

## 動作環境

* **1 人あたり 2 台。** QR Crypt を動かす恒久オフライン端末と、暗号文を運ぶだけの普段使いの
  オンライン端末。
* **ブラウザー。** 主対象は Android Chrome と iOS Safari です。Windows Chrome / macOS Safari /
  Edge は参考環境として記録します（[docs/develop/browser-matrix.md](docs/develop/browser-matrix.md)）。
  Web Crypto または IndexedDB が利用できない環境では起動時の画面で停止し、どの機能も使えません。
* **配信元。** `https://`、またはローカルの `http://localhost` / `http://127.0.0.1` から配信
  する必要があります。`index.html` を `file://` で直接開く方法と、LAN アドレス上の平文 HTTP は
  非対応です（カメラと Service Worker が利用できません）。
* **WebAssembly。** カメラでの QR 読み取りは WebAssembly のデコーダーを使い、JavaScript の
  代替経路はありません。
  * WebAssembly が無効・遮断された環境では、カメラ自体は開くものの最初のデコードで失敗し、
    カメラが利用できない旨を表示します。読み取りは一切できません。
  * WebAssembly が JIT なしで動く環境（一部の堅牢化・ロックダウン構成）では、デコードは大幅に
    遅くなると見込まれます。どの程度遅くなるかは実機で未計測です
    （[docs/develop/browser-matrix.md](docs/develop/browser-matrix.md)）。
  * QR の表示も同じ判定に従い、利用者が設定することはありません。デコーダーが使える場合は密な
    フレームを短い表示時間で（1,000 B を 200 ms ごと）、使えない場合は小さなフレームを長く
    表示します（100 B を 2,000 ms ごと。収まらない成果物のときだけ密度を上げます）。
  * その場合に残る入力手段は、本文の手入力・貼り付けだけです。この入力欄が受け付けるのは完結した
    ペイロード文字列であって個々の QR フレームではありません。ポスト量子メッセージは複数フレームに
    分割され、ポスト量子の公開鍵と識別情報も常にフレームとして運ばれるため、カメラが使えない環境
    ではポスト量子のメッセージ受信も鍵交換も実用になりません。AES-256 の鍵とメッセージは単一の
    ペイロード文字列のままです。

## 使い方

### 導入方式A: PWA

1. オフラインで使う端末のブラウザーでアプリの URL を開きます。
2. ブラウザーの **インストール** / **ホーム画面に追加** で導入します。
3. 導入画面の **オフライン利用準備状態** が **準備完了** になるまで待ちます。
4. その端末をすべてのネットワークから切り離し、以後その状態を保ちます。
5. オフラインになると表示される通常画面から利用します。

### 導入方式B: 署名付き ZIP

オフライン端末をアプリの配信元に一切接触させたくない場合はこちらを使います。

1. 信頼できる PC で、リリースの 3 つの資産をダウンロードします。`qr-crypt-…-static-install.zip`
   本体、その `.sigstore.json` バンドル、`SHA256SUMS`。
2. **検証に使う値は別の経路で入手したものを使い**、ダウンロードしたファイル自身から取らないで
   ください。

   ```bash
   cosign verify-blob qr-crypt-<tag>-static-install.zip \
     --bundle qr-crypt-<tag>-static-install.zip.sigstore.json \
     --trusted-root /independently/provisioned/trusted_root.json \
     --certificate-identity "https://github.com/transparent-pegasus/qr-crypt/.github/workflows/github-release.yml@refs/heads/main" \
     --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
     --certificate-github-workflow-repository "transparent-pegasus/qr-crypt" \
     --certificate-github-workflow-ref "refs/heads/main" \
     --certificate-github-workflow-sha "<期待するソースコミット>" \
     --certificate-github-workflow-trigger "push"

   sha256sum -c SHA256SUMS
   ```

3. 検証済みのアーカイブをオフライン端末へ移します。運搬に使う媒体（USB メモリー、SD カード）も
   信頼できる必要があります。ストレージを書き換えられる者は、アプリも書き換えられます。
4. 展開します。ZIP はディレクトリを 1 つ作り、それがドキュメントルートになります。
5. あらかじめ信頼できる経路でオフライン端末に導入しておいた静的サーバーで、`127.0.0.1` /
   `localhost` のみにバインドして配信します。同梱の `_headers` / `_redirects` の意味を満たすこと
   が必要です。セキュリティヘッダー、正しい MIME タイプ、`/index.html` への SPA フォールバック、
   到達性 sentinel の `no-store`。
6. `http://localhost` を開き、オフライン利用の準備完了が表示されるまで待ちます。
7. サーバーを停止し、運搬媒体を外し、物理的にネットワークを切断します。秘密の入力・復元は、
   QR Crypt がオフラインと表示していることを確認してから行ってください。導入用サーバーの
   sentinel は、そのオリジンを到達可能として扱わせる設計です。稼働中に秘密を入力しないでください。

アーカイブ内の `INSTALL.txt` にも、導入作業者向けに同じ手順が入っています。

### オンライン端末を介してメッセージを送る

2 台のオフライン端末が同じ場所にある必要はありません。3 台目のオンライン端末が、QR フレームを
文字列として任意のメッセンジャーで運びます。QR Crypt の鍵を持ったことがないオンライン端末を
使ってください。

1. **送信側オフライン端末** — 通常どおり暗号化し、QR フレームを表示します。
2. **送信側オンライン端末** — **リレー** 画面を開き、**読取 → テキスト** で全フレームを集め、
   連結されたテキストをコピーします。このクリップボードの内容はアプリの外・wipe の外に残り得ます。
3. **受信側オンライン端末** — **リレー** 画面を開き、**テキスト → QR** に貼り付けて、同じフレーム
   を受信側のカメラへ再生します。
4. **受信側オフライン端末** — フレームを読み取ります。組み立てと暗号学的な検証を行うのは、この
   端末だけです。

公開鍵と識別情報の交換は対面のままです。リレーが転送するのは、**信頼できない**外側ヘッダーが
メッセージだと宣言している正規の QR フレーム文字列です。組み立ても内側の型の検証も行わず、復号も
しません。運ぶバイト列を解釈することはありませんが、それが何であるかを判別することもできません。
メッセージとしてラベルを付け替えた成果物は、鍵素材を含むものであってもフィルターを通過し、
オフライン端末が組み立てた後にはじめて拒否されます。成果物を認証するのはオフライン端末だけです
（[docs/security/threat-model.md](docs/security/threat-model.md) T19）。

## 暗号化方式

| 方式 | 使いどころ |
| --- | --- |
| **AES-256-GCM**（既定） | 日常のメッセージ。QR は 1 枚、鍵は対面で手渡します。 |
| **ML-KEM-1024**（+ HKDF-SHA256 + AES-256-GCM） | 数十年単位で秘密を保つ必要があるメッセージ。将来の量子計算機に耐える設計です。重いため、メッセージは複数の QR コードになります。 |
| **ML-KEM-1024 + ML-DSA-87** | 上と同じ構成に署名を付け、受信側が送信者を検証できるようにしたものです。 |

ポスト量子スイートは **experimental** かつ **独立監査を受けていません**。FIPS 203 / FIPS 204 の
アルゴリズムの実装を採用しているだけであり、「FIPS 認証済み」「完全に安全」とは主張しません。
現在の状態とブロッカー: [docs/security/security-review.md](docs/security/security-review.md)。

## ドキュメント

* [docs/spec/qr-protocol.md](docs/spec/qr-protocol.md) — QR プロトコル仕様（v1）
* [docs/spec/qr-protocol-v2.md](docs/spec/qr-protocol-v2.md) — QR プロトコル仕様（v2・ポスト量子）。QR 密度と表示間隔もこちら
* [docs/spec/boot-and-reset-v2.md](docs/spec/boot-and-reset-v2.md) — 起動 / wipe-on-online 契約
* [docs/security/threat-model.md](docs/security/threat-model.md) — 脅威モデル
* [docs/security/security-review.md](docs/security/security-review.md) — セキュリティレビュー記録（v2・監査区分）
* [docs/develop/development.md](docs/develop/development.md) — 技術スタック、セットアップ、コマンド、環境変数
* [docs/develop/deployment.md](docs/develop/deployment.md) — Cloudflare Pages へのデプロイと CI の流れ
* [docs/develop/browser-matrix.md](docs/develop/browser-matrix.md) — ブラウザー検証マトリクスと参考計測値
* [docs/develop/deviations.md](docs/develop/deviations.md) — 仕様からの管理された逸脱
* [SECURITY.md](SECURITY.md) — 脆弱性の報告
* [design-system/](design-system/) — ui-ux-pro-max 由来のデザインシステム
* [LICENSE](LICENSE) — 本プロジェクトの配布条件（Apache License 2.0）
* [design-system/PROVENANCE.md](design-system/PROVENANCE.md) — アーカイブされた design-system 出力の来歴（MIT ライセンスの生成物を含む）

## セキュリティ免責事項

このアプリが保証するのは、アプリケーションが意図的に平文や秘密鍵を外部送信しないことまでです。

以下は防御対象外であり、アプリ内の「セキュリティについて」画面にも明記しています。

* OS、ブラウザー、ファームウェアの侵害
* キーロガー、画面録画、スクリーンショット
* カメラフレームを取得するマルウェア
* PWA 初回取得時または再インストール時の供給網侵害
* 端末の物理的な窃取
* ユーザー自身による秘密 QR の誤共有
* ブラウザーデータ削除による鍵の消失

**オフライン表示は安全性の証明ではありません。** 現在のネットワーク状態を示す補助情報にすぎません。

**オンラインにするのは導入とリレー画面のためだけです。** オンライン中は暗号化・復号・鍵管理・
保存・設定をブロックしたままです。利用中にオンラインへ遷移した場合、平文と復号結果は即時に
消去されます。

**wipe-on-online**（既定 ON）は network-confirmed のときにのみ発火し、ローカルデータの
*論理*削除を試行します。物理消去は保証しません（LevelDB は追記型、SSD はウェアレベリング）。
端末の完全フォーマットでも flash 媒体では消去を保証できません。確実性が必要な場合は、媒体に
応じた sanitization 手順（例: NIST SP 800-88）を用いるか、媒体を物理破壊してください。詳細:
[docs/spec/boot-and-reset-v2.md](docs/spec/boot-and-reset-v2.md)。

**更新機構はありません。** 新しいバージョンを使うには、端末を sanitize してから新規に導入します。
鍵・識別情報・平文を含む状態を保持している（または保持していた）端末は、sanitize せずに
オンラインへ戻さないでください。

本プロジェクトは Apache License 2.0（[LICENSE](LICENSE)）で配布しています。
