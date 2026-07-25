# QR Crypt

English version: [README.md](README.md)

オフライン暗号化 QR PWA。端末上で平文を暗号化し、暗号文・鍵素材を QR として表示・読取する Progressive Web App です。アプリ管理下の IndexedDB/localStorage にはメッセージ暗号文を永続化しません。利用者が明示した PNG/SVG/ZIP ダウンロードとクリップボードは OS・ブラウザー・同期先に残り得て、wipe/purge の対象外です。

**すること**: オフライン時の AES-256-GCM および v2 ポスト量子スイート（ML-KEM / ML-DSA）による暗号化、鍵生成・管理、QR 表示・読取、PWA としてのオフライン起動。

**しないこと**: 平文や秘密鍵の外部送信、クラウド上の鍵保管、独自暗号アルゴリズム、CDN 依存のランタイム、オフライン表示を安全性の証明として扱うこと、メッセージ暗号文のアプリ内永続化（オーナー要件。セッション表示と利用者明示のエクスポートのみ）。

## 他の暗号化アプリとの違い

単に「文字列を暗号化・復号する」だけのアプリは数多くあります。QR Crypt が狙うのは暗号アルゴリズムの新しさではなく、**平文と鍵が端末の外へ出る経路そのものを設計段階で塞ぐこと**です。暗号化が正しくても、鍵や平文の取り扱い・配送経路・実行環境に穴があれば安全にはなりません。QR Crypt はそこを主眼に置きます。

* **データ流出経路をランタイムから排除** — アプリ機能としての外部通信を持ちません（サードパーティやクロスオリジンのクライアント不使用）。許可されるランタイムリクエストは wipe-on-online を制御する同一オリジンの `GET /reachability-sentinel.txt` probe、表示用の同一オリジン `HEAD /manifest.webmanifest?reach=…`（定期）、および静的/PWA 資産の取得・再検証のみで、いずれもユーザーデータやフレームデータを載せません。外部フォント・CDN・アナリティクス・エラーレポート SDK・リモート設定を読み込みません。CSP（`connect-src 'self'` ほか）でブラウザーレベルでも外部送信を遮断します。一般的な「暗号化 Web アプリ」が CDN やフォント、計測タグを読み込む＝潜在的な持ち出し面を持つのに対し、QR Crypt はリクエストを同一オリジンかつ非ペイロードに留めます。
* **オフライン専用の暗号処理＋狭いオンラインゲート** — オンライン中は暗号化・復号・鍵管理・保存・設定をブロックしたままです。オンライン画面は PWA 導入に加え、機微ストア走査がエラーなく完了した論理的にクリーンなオリジンに限り、外側ヘッダーが `pq-message` と宣言する正規 `OCF2:` 文字列をそのまま転送する光学リレーを提供します（組み立て・復号なし、フレーム由来のアプリ永続化なし、フレームを載せるネットワーク要求なし。脅威モデル T19 参照）。wipe-on-online（既定 ON）は network-confirmed（到達性 sentinel 本文一致）でのみ発火し、ローカルデータの論理削除を試行します（物理消去は未保証）。残余リスクは脅威モデル（T18: probe false-negative window、T19: 信頼できないリレー段）に記載します。
* **サーバーを介さないエアギャップ鍵交換** — 鍵・公開鍵は QR として対面で交換します。メッセージ暗号文も QR フレーム化され、専用のオンライン・リレー経由で正規 OCF2 テキストとして運ぶこともできます。クラウドの鍵預託やアカウント同期は用いません。鍵は端末内の IndexedDB のみに置き、アプリ自身は鍵を外部送信も外部保存もしません。鍵素材が端末を出る唯一の経路は、強確認付きのユーザー主導による鍵 QR のエクスポートです（脅威モデル T3 参照）。アプリ管理下の IndexedDB/localStorage にはメッセージ暗号文を永続化せず、その場の表示と利用者明示の PNG/SVG/ZIP・クリップボード出力のみです（後者は OS・ブラウザー・同期先に残り得て wipe/purge の対象外）。
* **認証付き暗号と厳格な失敗挙動** — AEAD（AES-GCM）と AAD による改竄検知を用い、認証に失敗した場合は部分的な平文を一切表示しません。復号の内部例外は利用者向けの定型メッセージへ正規化し、鍵素材やスタックを画面・ログへ出しません。単純な暗号アプリで起こりがちな「未認証モード」「失敗時の中途半端な出力」を排します。
* **平文を残さない** — 平文・復号結果を永続化せず、React メモリー上のみで扱います。暗号化成功後の自動消去とバックグラウンド移行後の自動消去を既定で有効にします。QR 生成ライブラリへ平文を渡さず、暗号化完了後の暗号文のみを扱います。
* **標準アルゴリズムのみ・独自暗号なし** — 乱数は CSPRNG（`crypto.getRandomValues`）、暗号処理は Web Crypto を基本とし、IV 再利用や固定 IV、独自の鍵結合を禁止します。暗号コードは専用モジュール（`src/crypto/*`）に隔離し、UI ページはそれらの高水準操作を呼び、Web Crypto の primitive や鍵素材に直接触れません。
* **配送経路（サプライチェーン）まで含めた防御** — 依存はロックファイルをコミットし、CI は凍結ロックで導入、レジストリの脆弱性 advisory と provenance を確認して危険なパッケージを排除しています（実際に検出・処置した事例は [docs/threat-model.md](docs/threat-model.md) §5.1）。暗号コードを CDN から実行時に取得する構成を採りません。
* **検証可能性と正直な脅威モデル** — ソースコード・QR プロトコル仕様・脅威モデルを公開し、往復・改竄・誤鍵・IV 一意性などをテストで担保します。そして **何を守らないかを明記します**（下記「セキュリティ上の前提と免責」）。過大な安全性の主張をしないこと自体を設計方針とします。

これらは「アルゴリズムが強い」という主張ではありません。**運用モデル（保護素材を持つ端末でのオフライン暗号処理・エアギャップ鍵交換・ユーザー/フレームデータを載せないネットワーク要求・正直な限界表示）が、平文を扱う実運用での現実的な安全性を左右する**、という考え方に基づく差別化です。専用のクリーンオリジン・リレー端末は鍵/平文を持つエンドポイントではなく、外側ヘッダーが `pq-message` と宣言する OCF2 文字列の転送のためだけにオンラインに留めます。限界については必ず次節を参照してください。

## セキュリティ上の前提と免責

このアプリが保証するのは、アプリケーションが意図的に平文や秘密鍵を外部送信しないことまでとする。

以下は防御対象外であり、アプリ内の「セキュリティについて」画面に明記する。

* OS、ブラウザー、ファームウェアの侵害
* キーロガー、画面録画、スクリーンショット
* カメラフレームを取得するマルウェア
* PWA初回取得時または再インストール時の供給網侵害
* 端末の物理的な窃取
* ユーザー自身による秘密QRの誤共有
* ブラウザーデータ削除による鍵の消失

**オフライン表示は安全性の証明ではない。** 「オフライン表示」は安全性の証明として扱わず、単に現在のネットワーク状態を示す補助情報として扱う。

平文は既定で暗号化成功後に自動消去する。バックグラウンド移行後の自動消去も既定で有効とし、設定可能なのは ON/OFF のみ。遅延は `VITE_AUTO_CLEAR_SECONDS=300` の固定値（約5分）を使用する。

**オンライン状態は PWA の新規導入と、狭いクリーンオリジン光学リレーのためです。** オンライン中は暗号化・復号・鍵管理・保存・設定をブロックしたままです。導入画面は、機微ストア走査がエラーなく完了し、鍵行・PQ identity 行・Vault 鍵が無いオリジンに限り、外側ヘッダーが `pq-message` と宣言する正規 OCF2 文字列をそのまま転送する光学リレーも提供できます。リレーは成果物・全体ハッシュ・内側型・AEAD・署名を組み立て・検証せず、フレーム由来の値をアプリ管理ストレージや CacheStorage に書かず、フレームを載せるネットワーク要求もしません。明示的なクリップボードのコピー/貼り付けはアプリ外や wipe 外に残り得ます。表示中の QR 画像はブラウザーや OS に捕捉され得ます。利用中にオンラインへ遷移した場合は、平文・復号結果・結果ペイロードを即時消去します。

**wipe-on-online**（設定既定 ON）は表示用オンライン判定ではなく、network-confirmed（`/reachability-sentinel.txt` の本文一致）でのみ発火します。install ゲート経路（機微データ皆無）では発火しません。実行時の表現は「ローカルデータの論理削除を試行。物理消去は保証しない」（LevelDB 追記型・SSD ウェアレベリング）。端末の完全フォーマットでも flash/SSD 媒体では消去を保証できません。確実性が必要な場合は媒体に応じた sanitization 手順（例: NIST SP 800-88）を用いるか、媒体を物理破壊します。詳細は [docs/boot-and-reset-v2.md](docs/boot-and-reset-v2.md)。

## ポスト量子暗号（v2・experimental）

v2 は **experimental** です。リポジトリ内の実装・テスト・文書が揃った状態を `implementation-complete`、独立第三者による選定バージョンとアプリ全体のレビュー記録後を `release-approved` と区分します（[docs/security-review.md](docs/security-review.md)）。現状は独立監査未了のため `release-approved` には到達しておらず、UI・README・CI は experimental・未独立監査の表示を維持します。FIPS 203/204 準拠実装の採用であり、「FIPS 認証済み」「完全に安全」とは主張しません。

### 提供スイート

| スイート | 内容 | 備考 |
| --- | --- | --- |
| AES-256-GCM | 対称暗号のみ | **既定**（`A256GCM`） |
| ML-KEM-1024 + HKDF-SHA256 + AES-256-GCM | ポスト量子 KEM ハイブリッド | 選択可（`MLKEM1024_A256GCM`） |
| 上記 + ML-DSA-87 署名 | sign-then-encrypt | 署名付きメッセージ |

現在の active policy は **maximum**（1024/87）のみです。wire 契約では 4 suite
（768/65 と 1024/87、各々の署名なし・署名付き）を維持しますが、balanced
（768/65）は型・suite コードの予約に降格しており、運用境界では
`UNSUPPORTED_ALGORITHM` として拒否します。

### PQ ベンチ参考値

2026-07-25 に `aube bench:pq`（Vitest 4.1.10、Linux x86_64、
Intel Core i7-10870H）を 1 回実行した値です。`hz` は 1 秒あたりの処理回数、
mean は 1 処理あたりの平均ミリ秒です。

| 処理 | node hz | node mean (ms) | ui (jsdom) hz | ui (jsdom) mean (ms) |
| --- | ---: | ---: | ---: | ---: |
| ML-KEM-1024 keygen | 1,090.15 | 0.9173 | 1,031.95 | 0.9690 |
| ML-KEM-1024 encapsulate | 1,025.61 | 0.9750 | 979.89 | 1.0205 |
| ML-KEM-1024 decapsulate | 787.64 | 1.2696 | 781.58 | 1.2795 |
| ML-DSA-87 sign | 83.4877 | 11.9778 | 96.8792 | 10.3221 |
| ML-DSA-87 verify | 295.14 | 3.3883 | 285.53 | 3.5025 |

これは開発機上の参考値であり、実ブラウザー・低性能端末での実測や
`release-approved` 判定の代替ではありません。

### 複数 QR（OCF2）

大きなペイロードは `OCF2` フレームに分割して表示・読取します。

* 表示: 自動切替（既定間隔あり・一時停止/前後/速度調整可）
* 読取: 順不同・重複無視。欠損フレームは UI で明示。別 transfer 混入は `FRAME_MISMATCH`
* 出力: フレーム PNG 一括および store-only ZIP（無圧縮。依存追加なし）

詳細は [docs/qr-protocol-v2.md](docs/qr-protocol-v2.md)。

### シード Vault

ポスト量子 identity は展開済み秘密鍵を永続化せず、**シードのみ**（KEM 64B / DSA 32B）を Vault（非抽出 AES-256-GCM `CryptoKey`）で暗号化して保管します。利用時に復号→ keygen 再展開→操作→バッファ破棄の流れです。

## 技術スタック

* React / React DOM / React Router
* Vite / TypeScript / Tailwind CSS v4
* shadcn/ui（Radix UI）+ sonner
* Web Crypto API / IndexedDB（idb）
* Zod / cbor-x / qrcode / @zxing/browser・@zxing/library
* vite-plugin-pwa / workbox-window
* Vitest / Testing Library / Playwright（@playwright/test）
* Aube（パッケージマネージャ）/ mise（ツールバージョン固定）
* Cloudflare Pages / GitHub Actions

## 必要ツール

ツールバージョンは `mise.toml` で固定しています。

* node `26.5.0`
* aube `1.32.0`

```bash
mise install
```

## 初期構築

```bash
git clone <repository-url>
cd qr-crypt
mise install
aube ci          # または初回のみ aube install
```

## 開発

```bash
aube dev         # 開発サーバー
aube typecheck   # TypeScript 検査
aube lint        # ESLint
aube bench:pq    # ポスト量子ベンチ（参考値。実機計測の代替ではない）
```

## テスト

```bash
aube test              # unit / integration / ui（Vitest）
aube test:pq-vectors   # ポスト量子 known-answer（KAT）
aube test:pq           # ポスト量子 integration
aube test:qr-multipart # 複数 QR（OCF2）組立・分割
```

E2E:

```bash
aube exec playwright install chromium
aube test:e2e
```

CI 上では `aube exec playwright install --with-deps chromium` を使用します。validate job でも `test:pq-vectors` / `test:pq` / `test:qr-multipart` を実行します。

## ビルド

```bash
aube build:prod
```

`--mode prod` により `.env.prod` が読み込まれます。

## 環境変数

| ファイル | 役割 |
| --- | --- |
| `.env.example` | Git 管理。テンプレート・非機密の既定値 |
| `.env.prod` | Git 管理可。本番向け非機密設定 |
| `.env.local` | Git 非管理。開発者ごとの非機密設定 |

重要:

* `.env.local` は任意。未配置でも `.env.example` / `.env.prod` の既定で全ゲート（`aube ci`〜`aube test:e2e`）が通る
* `VITE_*` はビルド後のクライアントコードへ含まれるため、**秘密情報を入れてはならない**
* 暗号鍵・秘密鍵・Cloudflare API Token・復号用情報を `.env` に置かない
* feature flag をアクセス制御や秘密保護として使わない
* `VITE_ENABLE_ECDH` / `VITE_ENABLE_PRIVATE_KEY_EXPORT` は**予約フラグ**（UI・モジュール分岐は未実装。選択肢にも出さない）

## デプロイ（Cloudflare Pages, Direct Upload）

GitHub の Cloudflare Git Integration とは二重運用しません。GitHub Actions から Wrangler で `dist` を Direct Upload します。

### 事前準備

1. Cloudflare 側で Pages プロジェクトを作成する:

   ```bash
   wrangler pages project create <name>
   ```

2. GitHub Repository Secrets を登録する（Pages デプロイに必要な最小権限の API Token）:
   * `CLOUDFLARE_ACCOUNT_ID`
   * `CLOUDFLARE_API_TOKEN`
3. GitHub Repository Variables を登録する:
   * `CLOUDFLARE_PAGES_PROJECT` — `main` から配信する本番プロジェクト
   * `CLOUDFLARE_PAGES_PROJECT_DEV` — `dev` から配信する開発プロジェクト
4. Settings > Actions > General で **Allow GitHub Actions to create and approve pull requests** を有効にする。このリポジトリ全体の設定は昇格ワークフローの必須条件であり、`pull-requests: write` を持つすべてのワークフローにレビュー承認権限も与える。ただし ruleset は承認数 0 を要求するため、承認機能はここでは使用しない。

### CI の流れ

`.github/workflows/cloudflare-pages.yml` は全ブランチ、および `main` / `dev`
宛の全 pull request で実行される:

* `validate` job（型検査・lint・unit・PQ・multipart QR・本番ビルド）と `e2e` job
  は常に実行される
* `deploy` job は**両方の成功**を必要とし、`push` のときだけ実行される。`main` は
  `CLOUDFLARE_PAGES_PROJECT`、`dev` は `CLOUDFLARE_PAGES_PROJECT_DEV` へ配信する。
  再ビルドせず `validate` が生成した artifact を配信するため、配信バイトは検証済み
  バイトと一致する
* それ以外のブランチと全 pull request は検証のみ
* `main` への `push` では追加で `.github/workflows/github-release.yml` が署名付き
  prerelease を発行する

`.github/workflows/dev-to-main-pr.yml` は `dev` への push、または意図的な `workflow_dispatch` で、対応する open PR がなく、`dev` が `main` より先行するコミットを持ち、`main` に `dev` のコミットツリーがまだない場合に `dev` → `main` 昇格 PR を開く。マージも push もしない。

* この PR をマージせずに閉じるのは永久的な拒否ではなく一時停止である。次の `dev` push は新しい情報なので新しい PR を開く。`workflow_dispatch` も人が意図して行う操作であり、人による拒否と競合しない
* これは `main` の ruleset が `validate` と `e2e` を strict up-to-date で必須にしている間だけ実効性のある本番ゲートである。必須チェックを削除すると、チェックに失敗した dev push であっても本番昇格を誰でもマージできる
* `dev` が `main` より遅れている、または分岐している場合、strict な必須チェックにより `dev` が `main` を含むまでマージできない。これは人間が同期を解決する問題である
* Actions が開いた PR では pull-request のチェックに **"Approve workflows to run"** と表示されることがある。表示されたら承認する。同じ head SHA の push-event による `validate` と `e2e` のチェックはすでに実行済みである
* `dev` への force-push は ruleset の `non_fast_forward` と空の `bypass_actors` によりブロックされるため、このワークフローに個別の force-push ガードはない

### `public/_headers` / `public/_redirects`

* `_redirects`: SPA ルーティング（`/* /index.html 200`）
* `_headers`: CSP 等のセキュリティヘッダー、および SW / manifest の `Cache-Control: no-cache`（後述の逸脱表）

## オフライン端末への導入手順

1. **オンライン**の端末でアプリ URL を開く
2. ブラウザーの手順に従い **PWA としてインストール**する
3. オンライン導入画面で **「オフライン利用準備状態: 準備完了」** を確認する
4. 機内モード（またはネットワーク切断）にする
5. オフラインへ切り替わると表示される通常画面で全機能を利用する

インストール済みアプリのメタデータ（PWA manifest の名前・説明）は英語固定ですが、アプリ内 UI 言語は英語・日本語で切替できます。

**本アプリに更新機能はありません。** 新バージョンを使う場合は、端末を sanitize（完全フォーマット単独では flash/SSD 媒体で消去を保証できません。上記の wipe 注記を参照）してから新規にオフライン導入します。鍵・PQ identity・Vault 鍵、または平文を含むセッション状態を持つ（または持っていた）端末を sanitize せずにオンラインへ戻してはなりません。例外は専用のクリーンオリジン・リレー端末で、理想的には QR Crypt の鍵を一度も持たせず、下記の光学リレーのためだけにオンラインに留めます。

### オンライン光学リレーの使い方

オフライン端末同士が直接 QR を見せられないとき、第三の**オンライン**端末が任意のメッセンジャー経由でフレーム文字列を運べます。

1. **送信側オフライン端末** — 通常どおり暗号化し、アニメーション OCF2 フレームを表示する。
2. **送信側オンライン・リレー** — クリーンなオリジン（決定完了後、鍵/identity/Vault 行なし）で **「リレー」**ページを開いて **Scan → text** を使い、全フレームを集めて `\n` 連結したテキストをコピーする。このクリップボードコピーはアプリ外や wipe 外に残り得る。
3. **受信側オンライン・リレー** — **「リレー」**ページを開き、そのテキストを **Text → QR** に貼り付け、同じフレーム文字列を再生する。リレー UI にアプリ提供のファイルダウンロード操作はない。
4. **受信側オフライン端末** — スキャンして転送を完了する。権威ある組み立てと暗号検証（AEAD、署名がある場合は署名）を行うのはこのオフライン端だけである。

リレーが転送するのは、外側ヘッダーが `pq-message` と宣言する正規 OCF2 文字列そのものです。組み立て・復号・再暗号化・鍵素材へのアクセスは行いません。公開鍵・identity の交換は対面ワークフローのままです（外側ヘッダーフィルタは「暗号文だけを運ぶ」ことの強制保証ではありません）。リレー端末は理想的には QR Crypt の鍵を一度も持たないものを使います。

### v2 更新時の破壊的変更（注意）

* 既存 **OCM1-RSA** 暗号文は復元不能です。非抽出 RSA 秘密鍵は救済できません（復号互換は残しません）。
* 保存済み QR 機能は廃止しました。暗号文・鍵系 QR はアプリ内に永続化せず、IndexedDB に `qrArtifacts` store はありません。QR は画面表示と利用者が明示したエクスポートだけで扱います。

## リリース前確認

本番相当のリリース／`release-approved` 判定前に、次を毎回確認します（[docs/security-review.md](docs/security-review.md) §3）。

1. FIPS 203 / FIPS 204 の最新エラッタ確認（NIST CSRC の当該ページ）
2. `@noble/post-quantum` の変更履歴・既知脆弱性・advisory 確認
3. KAT（`aube test:pq-vectors`）全緑の確認
4. バンドルへの外部ネットワーク参照が無いことの確認（e2e テストで担保）
5. `aube-lock.yaml` の差分レビュー（provenance 維持）

2026-07-25 時点の blocker（[docs/security-review.md](docs/security-review.md) §1）:
`@noble/post-quantum` 0.6.1 は独立監査未了です。既知の依存 advisory は全て解消済みです
（`sharp@0.35.2` / `react-router@8.3.0` / override による `brace-expansion@5.0.8`
— security review §1 参照）。`aube audit` は成功します。いずれにせよ
[docs/browser-matrix.md](docs/browser-matrix.md) の v2 実機計測（少なくとも
Android Chrome・iOS Safari）と独立監査記録が揃うまで `release-approved` としません。

## ドキュメント

* [docs/qr-protocol.md](docs/qr-protocol.md) — QR プロトコル仕様（v1）
* [docs/qr-protocol-v2.md](docs/qr-protocol-v2.md) — QR プロトコル仕様（v2 ポスト量子）
* [docs/threat-model.md](docs/threat-model.md) — 脅威モデル
* [docs/security-review.md](docs/security-review.md) — セキュリティレビュー記録（v2・監査区分）
* [docs/boot-and-reset-v2.md](docs/boot-and-reset-v2.md) — Boot / wipe-on-online 契約
* [docs/browser-matrix.md](docs/browser-matrix.md) — ブラウザー検証マトリクス（v2 実機計測欄含む）
* [design-system/](design-system/) — ui-ux-pro-max 由来のデザインシステム

## 仕様からの管理された逸脱

| 逸脱 | 理由 / 根拠 |
| --- | --- |
| `toast` → `sonner` | shadcn v3 レジストリに `toast` が無い（廃止）ため、公式後継 `sonner` を使用 |
| shadcn CLI 不使用・手動ベンダリング | CLI が npm 系 lock を生成するため不採用。公式レジストリ JSON から `src/components/ui/` へ手動配置 |
| `radix-ui` 傘パッケージ不採用 | `radix-ui@1.6.4` のみ provenance 欠落のため、スコープ付き `@radix-ui/react-*` を使用。供給網事象の詳細は [docs/threat-model.md](docs/threat-model.md) §5.1 |
| `typescript@6` ピン | メジャー 6 を明示ピン（`package.json` の `"typescript": "6"`） |
| `playwright` → `@playwright/test` | テストランナー実体は `@playwright/test`。ブラウザーは `aube exec playwright install chromium`（CI は `--with-deps`） |
| テスト補助 dev deps（`fake-indexeddb` / `pngjs` / `@types/pngjs` / `@testing-library/jest-dom` 等）および Tailwind / Radix 系 | 当初の推奨依存リスト外だがスタック上必須の追加（例: `pngjs` で PNG 往復復号） |
| shadcn 追加コンポーネント `checkbox` / `radio-group` / `collapsible` | 強確認・読取対象選択・詳細折りたたみに必要 |
| `_headers` へ `/sw.js`・`/registerSW.js`・`/manifest.webmanifest` の `Cache-Control: no-cache` 追加 | SW / manifest の鮮度担保。デプロイヘッダーへの管理された追加 |
| CI へ独立 `e2e` job 追加 | `validate-and-deploy` はそのまま。e2e は deploy をブロックしない |
| `@zxing/library` 追加 | DOM 非依存の unit テスト用。`@zxing/browser` は UI 層のみ |
| `VITE_ENABLE_ECDH` / `VITE_ENABLE_PRIVATE_KEY_EXPORT` は予約のみ | env は残すが UI・モジュール分岐なし |
| 供給網ピン・override（`react-hook-form@7.82.0` / `eslint-config-prettier@10.1.8` / `aube.overrides` で rollup OMT） | 初期構築時の advisory・trust-downgrade 対応。一覧は [docs/threat-model.md](docs/threat-model.md) §5.1 |
| 当初計画のアプリ内更新通知の撤回 | オーナー決定によりアプリ内の更新機能を設けず、保護素材を持つ（または持っていた）端末は導入後オフラインで恒久運用する。新バージョンは端末の完全フォーマット後に新規導入する |
| 当初の暗号化後の平文保持既定の撤回 | オーナー決定により「暗号化後に平文を自動消去」を既定 ON に変更。バックグラウンド自動消去も既定 ON とし、遅延は env の固定値（300秒）を使用する |
| 通常オンライン利用の撤回（リレー例外） | オーナー決定によりオンライン中の暗号化・復号・鍵管理・保存・設定はブロックしたまま。オンラインの主目的は PWA 新規導入であり、fail-closed なクリーンオリジン光学リレーは外側ヘッダーが `pq-message` と宣言する正規 OCF2 文字列をそのまま転送できる（脅威モデル T19）。offline→online 遷移時はメモリー内の一時データを即時消去する |
| ML-KEM-512 / ML-DSA-44 未実装 | 相互運用テスト用も含め非対応。active policy の対象は maximum（1024/87）のみで、balanced（768/65）は型・suite コード予約のみ |
| balanced 降格・maximum 本筋化 | balanced 降格・maximum 本筋化は当初の推奨初期スイート範囲からのオーナー承認済み意図的逸脱(2026-07-23)。maximum（1024/87）のみを運用し、認識済みの balanced（768/65）は `UNSUPPORTED_ALGORITHM` で拒否する |
| `QrFrameV2.artifactType` に `pq-kem-public-key` / `pq-dsa-public-key` を追加 | 当初仕様の 3 値からの拡張（単鍵公開鍵フレーム用） |
| エラーコード `RESET_FAILED`・`SIGNATURE_INVALID`・`SIGNING_KEY_NOT_FOUND`・`FRAME_MISMATCH`・`WORKER_UNAVAILABLE` の追加 | `RESET_FAILED` は暫定名 `WIPE_FAILED` から、論理削除の正直な命名方針で確定。他は署名検証失敗・署名鍵欠落・フレーム不整合・Worker 利用不可 |
| RSA-OAEP ハイブリッド削除・`VITE_ENABLE_RSA=false` | RSA 経路の削除は完了。初期仕様の RSA ハイブリッド経路の反転 |
| `VITE_DEFAULT_ALGORITHM=A256GCM`（既定を共通鍵 AES-256-GCM へ） | オーナー要件 2026-07-24。ポスト量子暗号方式は選択式のまま維持 |
| QR のアプリ内保存機能なし | オーナー要件 2026-07-24。暗号文・鍵系 QR とも表示・PNG/SVG/ZIP エクスポート・クリップボードのみとし、保存済み QR 機能と `qrArtifacts` store は廃止 |

## ライセンス

Apache License 2.0 — [LICENSE](LICENSE) を参照。アーカイブ用の `design-system/` エクスポートには MIT ライセンスのジェネレーター出力が含まれます。詳細は [design-system/PROVENANCE.md](design-system/PROVENANCE.md) を参照。
