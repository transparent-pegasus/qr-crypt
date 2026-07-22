# Qrypt

オフライン暗号化 QR PWA。端末上で平文を暗号化し、暗号文・鍵素材を QR として表示・読取する Progressive Web App です。アプリ管理下の IndexedDB/localStorage にはメッセージ暗号文を永続化しません。利用者が明示した PNG/SVG/ZIP ダウンロードとクリップボードは OS・ブラウザー・同期先に残り得て、wipe/purge の対象外です。

**すること**: オフライン時の AES-256-GCM および v2 ポスト量子スイート（ML-KEM / ML-DSA）による暗号化、鍵生成・管理、QR 表示・読取・鍵系 QR のアプリ内保存、PWA としてのオフライン起動。

**しないこと**: 平文や秘密鍵の外部送信、クラウド上の鍵保管、独自暗号アルゴリズム、CDN 依存のランタイム、オフライン表示を安全性の証明として扱うこと、メッセージ暗号文のアプリ内永続化（オーナー要件。セッション表示と利用者明示のエクスポートのみ）。

## 他の暗号化アプリとの違い

単に「文字列を暗号化・復号する」だけのアプリは数多くあります。Qrypt が狙うのは暗号アルゴリズムの新しさではなく、**平文と鍵が端末の外へ出る経路そのものを設計段階で塞ぐこと**です。暗号化が正しくても、鍵や平文の取り扱い・配送経路・実行環境に穴があれば安全にはなりません。Qrypt はそこを主眼に置きます。

* **データ流出経路をランタイムから排除** — アプリ機能としての通信を一切持ちません（`fetch`/Axios/GraphQL クライアント不使用）。外部フォント・CDN・アナリティクス・エラーレポート SDK・リモート設定を読み込みません。CSP（`connect-src 'self'` ほか）でブラウザーレベルでも外部送信を遮断します。一般的な「暗号化 Web アプリ」が CDN やフォント、計測タグを読み込む＝潜在的な持ち出し面を持つのに対し、Qrypt はその面をゼロにします。
* **オフライン専用運用＋導入専用オンラインゲート** — オンライン中はインストール関連画面だけを表示し、暗号化・復号・鍵管理を含む全機能をブロックします。wipe-on-online（既定 ON）は network-confirmed（到達性 sentinel 本文一致）でのみ発火し、ローカルデータの論理削除を試行します（物理消去は未保証）。アプリが「ネットワークにつながっている間は動かない」ことを構造的に保証します。
* **サーバーを介さないエアギャップ鍵交換** — 鍵・公開鍵・暗号文をすべて QR として扱い、クラウドの鍵預託やアカウント同期を用いません。鍵は端末内の IndexedDB のみに置き、平文で外部保存しません。アプリ管理下の IndexedDB/localStorage にはメッセージ暗号文を永続化せず、その場の表示と利用者明示の PNG/SVG/ZIP・クリップボード出力のみです（後者は OS・ブラウザー・同期先に残り得て wipe/purge の対象外）。
* **認証付き暗号と厳格な失敗挙動** — AEAD（AES-GCM）と AAD による改竄検知を用い、認証に失敗した場合は部分的な平文を一切表示しません。復号の内部例外は利用者向けの定型メッセージへ正規化し、鍵素材やスタックを画面・ログへ出しません。単純な暗号アプリで起こりがちな「未認証モード」「失敗時の中途半端な出力」を排します。
* **平文を残さない** — 平文・復号結果を永続化せず、React メモリー上のみで扱います。暗号化成功後の自動消去とバックグラウンド移行後の自動消去を既定で有効にします。QR 生成ライブラリへ平文を渡さず、暗号化完了後の暗号文のみを扱います。
* **標準アルゴリズムのみ・独自暗号なし** — 乱数は CSPRNG（`crypto.getRandomValues`）、暗号処理は Web Crypto を基本とし、IV 再利用や固定 IV、独自の鍵結合を禁止します。暗号処理は専用モジュールへ隔離し、UI から直接呼びません。
* **配送経路（サプライチェーン）まで含めた防御** — 依存はロックファイルをコミットし、CI は凍結ロックで導入、レジストリの脆弱性 advisory と provenance を確認して危険なパッケージを排除しています（実際に検出・処置した事例は [docs/threat-model.md](docs/threat-model.md) §5.1）。暗号コードを CDN から実行時に取得する構成を採りません。
* **検証可能性と正直な脅威モデル** — ソースコード・QR プロトコル仕様・脅威モデルを公開し、往復・改竄・誤鍵・IV 一意性などをテストで担保します。そして **何を守らないかを明記します**（下記「セキュリティ上の前提と免責」）。過大な安全性の主張をしないこと自体を設計方針とします。

これらは「アルゴリズムが強い」という主張ではありません。**運用モデル（オフライン・エアギャップ・無流出・正直な限界表示）が、平文を扱う実運用での現実的な安全性を左右する**、という考え方に基づく差別化です。限界については必ず次節を参照してください。

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

**オンライン状態は PWA の新規導入専用です。** オンライン中はインストール状態・オフライン準備状態・機内モードへの切替案内だけを表示し、暗号化・復号・鍵管理・保存・設定の全機能をブロックします。利用中にオンラインへ遷移した場合は、平文・復号結果・結果ペイロードを即時消去します。

**wipe-on-online**（設定既定 ON）は表示用オンライン判定ではなく、network-confirmed（`/reachability-sentinel.txt` の本文一致）でのみ発火します。install ゲート経路（機微データ皆無）では発火しません。実行時の表現は「ローカルデータの論理削除を試行。物理消去は保証しない」（LevelDB 追記型・SSD ウェアレベリング）。確実な消去は端末の完全フォーマットが必要です。詳細は [docs/boot-and-reset-v2.md](docs/boot-and-reset-v2.md)。

## ポスト量子暗号（v2・experimental）

v2 は **experimental** です。リポジトリ内の実装・テスト・文書が揃った状態を `implementation-complete`、独立第三者による選定バージョンとアプリ全体のレビュー記録後を `release-approved` と区分します（[docs/security-review.md](docs/security-review.md)）。現状は独立監査未了のため `release-approved` には到達しておらず、UI・README・CI は experimental・未独立監査の表示を維持します。FIPS 203/204 準拠実装の採用であり、「FIPS 認証済み」「完全に安全」とは主張しません。

### 提供スイート

| スイート | 内容 | 備考 |
| --- | --- | --- |
| AES-256-GCM | 対称暗号のみ | 既存経路 |
| ML-KEM-768 + HKDF-SHA256 + AES-256-GCM | ポスト量子 KEM ハイブリッド | **既定**（`MLKEM768_A256GCM`） |
| 上記 + ML-DSA-65 署名 | sign-then-encrypt | 署名付きメッセージ |

初期リリースのプロファイルは **balanced**（768/65）のみです。maximum（1024/87）は型・suite コード予約のみで初期リリースでは無効です。

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

* node `26.1.0`
* aube `1.24.0`

```bash
mise install
```

## 初期構築

```bash
git clone <repository-url>
cd qrypt
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
3. GitHub Repository Variable を登録する:
   * `CLOUDFLARE_PAGES_PROJECT`

### CI の流れ

* `pull_request` / `push` to `main` で `.github/workflows/cloudflare-pages.yml` が検証を実行
* `main` への `push` で検証成功後に Cloudflare Pages へデプロイ
* 独立した `e2e` job も走るが、**デプロイをブロックしない**（C15）

### `public/_headers` / `public/_redirects`

* `_redirects`: SPA ルーティング（`/* /index.html 200`）
* `_headers`: CSP 等のセキュリティヘッダー、および SW / manifest の `Cache-Control: no-cache`（後述の逸脱表）

## オフライン端末への導入手順

1. **オンライン**の端末でアプリ URL を開く
2. ブラウザーの手順に従い **PWA としてインストール**する
3. オンライン導入画面で **「オフライン利用準備状態: 準備完了」** を確認する
4. 機内モード（またはネットワーク切断）にする
5. オフラインへ切り替わると表示される通常画面で全機能を利用する

**本アプリに更新機能はありません。** 新バージョンを使う場合は、端末を完全フォーマットのうえ新規にオフライン導入します。導入済み端末を完全フォーマットなしにオンラインへ戻してはなりません。

### v2 更新時の破壊的変更（注意）

* 既存 **OCM1-RSA** 暗号文は復元不能です。非抽出 RSA 秘密鍵は救済できません（復号互換は残しません）。
* 保存済み **暗号文** アーティファクトは v2 migration で削除されます（鍵系 QR・preferences・鍵レコードは維持方針。暗号文はオーナー要件により保存機能自体を廃止）。

## リリース前確認

本番相当のリリース／`release-approved` 判定前に、次を毎回確認します（[docs/security-review.md](docs/security-review.md) §3）。

1. FIPS 203 / FIPS 204 の最新エラッタ確認（NIST CSRC の当該ページ）
2. `@noble/post-quantum` の変更履歴・既知脆弱性・advisory 確認
3. KAT（`aube test:pq-vectors`）全緑の確認
4. バンドルへの外部ネットワーク参照が無いことの確認（e2e §30.5）
5. `aube-lock.yaml` の差分レビュー（provenance 維持）

加えて [docs/browser-matrix.md](docs/browser-matrix.md) の v2 実機計測（少なくとも Android Chrome・iOS Safari）が揃い、独立監査記録が揃うまで `release-approved` としません。

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
| shadcn CLI 不使用・手動ベンダリング | CLI が npm 系 lock を生成するため不採用。公式レジストリ JSON から `src/components/ui/` へ手動配置（C24） |
| `radix-ui` 傘パッケージ不採用 | `radix-ui@1.6.4` のみ provenance 欠落のため、スコープ付き `@radix-ui/react-*` を使用。供給網事象の詳細は [docs/threat-model.md](docs/threat-model.md) §5.1 |
| `typescript@6` ピン | メジャー 6 を明示ピン（`package.json` の `"typescript": "6"`） |
| `playwright` → `@playwright/test` | テストランナー実体は `@playwright/test`。ブラウザーは `aube exec playwright install chromium`（CI は `--with-deps`） |
| テスト補助 dev deps（`fake-indexeddb` / `pngjs` / `@types/pngjs` / `@testing-library/jest-dom` 等）および Tailwind / Radix 系 | §3 推奨リスト外だがスタック上必須の追加（C11: `pngjs` で PNG 往復復号など） |
| shadcn 追加コンポーネント `checkbox` / `radio-group` / `collapsible` | 強確認・読取対象選択・詳細折りたたみに必要（§12 改訂 11） |
| `_headers` へ `/sw.js`・`/registerSW.js`・`/manifest.webmanifest` の `Cache-Control: no-cache` 追加 | SW / manifest の鮮度担保（C19）。§27 からの管理された追加 |
| CI へ独立 `e2e` job 追加 | plan C15。`validate-and-deploy` はそのまま。e2e は deploy をブロックしない |
| `@zxing/library` 追加 | DOM 非依存の unit テスト用。`@zxing/browser` は UI 層のみ |
| `VITE_ENABLE_ECDH` / `VITE_ENABLE_PRIVATE_KEY_EXPORT` は予約のみ | env は残すが UI・モジュール分岐なし（§12 改訂 18） |
| 供給網ピン・override（`react-hook-form@7.82.0` / `eslint-config-prettier@10.1.8` / `aube.overrides` で rollup OMT） | 初期構築時の advisory・trust-downgrade 対応。一覧は [docs/threat-model.md](docs/threat-model.md) §5.1 |
| §17 更新通知の撤回 | オーナー決定によりアプリ内の更新機能を設けず、導入後はオフラインで恒久運用する。新バージョンは端末の完全フォーマット後に新規導入する |
| §7.2 暗号化後の平文保持既定の撤回 | オーナー決定により「暗号化後に平文を自動消去」を既定 ON に変更。バックグラウンド自動消去も既定 ON とし、遅延は env の固定値（300秒）を使用する |
| 通常オンライン利用の撤回 | オーナー決定によりオンライン状態を PWA 新規導入専用とし、全アプリ機能を OnlineGate でブロックする。offline→online 遷移時はメモリー内の一時データを即時消去する |
| ML-KEM-512 / ML-DSA-44 未実装 | 相互運用テスト用も含め非対応。初期対象は balanced（768/65）と型予約の maximum（1024/87）のみ |
| maximum プロファイル（1024/87）は初期リリース無効 | `VITE_ENABLE_MAXIMUM_PQ` は形式のみ・無視される。UI・identity 作成へ露出しない |
| `QrFrameV2.artifactType` に `pq-kem-public-key` / `pq-dsa-public-key` を追加 | spec2 §12 の 3 値からの拡張（単鍵公開鍵フレーム用） |
| エラーコード `RESET_FAILED`・`SIGNATURE_INVALID`・`SIGNING_KEY_NOT_FOUND`・`FRAME_MISMATCH`・`WORKER_UNAVAILABLE` の追加 | `RESET_FAILED` は plan 暫定名 `WIPE_FAILED` から、論理削除の正直な命名方針で確定。他は署名検証失敗・署名鍵欠落・フレーム不整合・Worker 利用不可 |
| RSA-OAEP ハイブリッド削除・`VITE_ENABLE_RSA=false`・`VITE_DEFAULT_ALGORITHM=MLKEM768_A256GCM` | WP-14 完了。初期仕様の RSA 経路からの逸脱（反転済み） |
| 暗号文の保存機能なし | オーナー要件 2026-07-22。spec §14 の保存一覧・§22 維持項目からの逸脱。鍵系 QR の保存は維持。暗号文は表示・PNG/SVG/ZIP エクスポートのみ |

Action ピン（`actions/checkout@v6` / `jdx/mise-action@v3` / `cloudflare/wrangler-action@v3`）はいずれも該当リポジトリにメジャータグが存在することを確認済みです。変更不要のため、ここでの追加逸脱はありません（改訂 20）。
