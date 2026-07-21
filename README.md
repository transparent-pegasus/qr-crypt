# Qrypt

オフライン暗号化 QR PWA。端末上で平文を暗号化し、暗号文・鍵素材を QR として表示・読取・保存する Progressive Web App です。

**すること**: オフライン時の AES-256-GCM / RSA-OAEP＋AES-256-GCM による暗号化、鍵生成・管理、QR 表示・読取・アプリ内保存、PWA としてのオフライン起動。

**しないこと**: 平文や秘密鍵の外部送信、クラウド上の鍵保管、独自暗号アルゴリズム、CDN 依存のランタイム、オフライン表示を安全性の証明として扱うこと。

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
```

## テスト

```bash
aube test        # unit / integration / ui（Vitest）
```

E2E:

```bash
aube exec playwright install chromium
aube test:e2e
```

CI 上では `aube exec playwright install --with-deps chromium` を使用します。

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

## ドキュメント

* [docs/qr-protocol.md](docs/qr-protocol.md) — QR プロトコル仕様
* [docs/threat-model.md](docs/threat-model.md) — 脅威モデル
* [docs/browser-matrix.md](docs/browser-matrix.md) — ブラウザー検証マトリクス
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

Action ピン（`actions/checkout@v6` / `jdx/mise-action@v3` / `cloudflare/wrangler-action@v3`）はいずれも該当リポジトリにメジャータグが存在することを確認済みです。変更不要のため、ここでの追加逸脱はありません（改訂 20）。
