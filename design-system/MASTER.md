# Qrypt — Design System MASTER

> ページ実装時は先に `design-system/pages/<page>.md` を参照し、存在すればそちらが本ファイルを上書きする。
> 本ファイルは ui-ux-pro-max-skill の生成結果(`design-system/offline-cipher/MASTER.md`、検索クエリは spec §5 の 3 件)を基に、
> 本アプリの制約(外部フォント禁止・オフライン・日本語 UI・モバイルファースト)へ適合させた確定版。
> ページごとに独自の色・余白トークンを追加しない(spec §5)。

## 0. 生成結果からの意図的変更

| 生成結果 | 確定版 | 理由 |
|---|---|---|
| JetBrains Mono (Google Fonts) | システムフォントスタック | spec §17/§18 が外部フォント・CDN を禁止。日本語グリフ対応 |
| 全文モノスペース | UI 本文=サンセリフ、技術データ=モノスペース | 日本語本文の可読性。terminal/precision の気分は データ表示で維持 |
| ダーク単一パレット | ライト/ダーク両対応トークン | spec §6 ダークモード対応 + WCAG AA |
| マーケティング的ページ構成 (Hero/Proof/CTA) | ツール型 1 カラム構成 | 本アプリはユーティリティ PWA。信頼性は明快な警告・状態表示で担保 |

## 1. スタイル方針

**Exaggerated Minimalism(抑制版)**: 高コントラスト、余白広め、装飾なし、太字見出し、要素数最小。
セキュリティツールとしての「精密さ」はモノスペースのデータ表示・整然としたグリッド・一貫した状態表示で表現する。
禁止: 遊び感のある装飾、紫/ピンクのAIグラデーション、色のみによる状態表現、絵文字アイコン(アイコンは lucide-react のみ)。

## 2. カラートークン(shadcn CSS variables へマップ)

QR コード表示面だけは例外: **常に白背景 `#FFFFFF`・黒セル `#000000`**(ダークモードでも固定。トークン非適用)。

### Light

| Token | 値 | 用途 |
|---|---|---|
| `--background` | `#FFFFFF` | ページ背景 |
| `--foreground` | `#0F172A` | 本文 |
| `--card` | `#F8FAFC` | カード面 |
| `--card-foreground` | `#0F172A` | |
| `--popover` / `--popover-foreground` | `#FFFFFF` / `#0F172A` | |
| `--primary` | `#1E3A5F` | 主ボタン・リンク・選択状態(紺=shield) |
| `--primary-foreground` | `#FFFFFF` | |
| `--secondary` / `--secondary-foreground` | `#E2E8F0` / `#1E293B` | 副ボタン |
| `--muted` / `--muted-foreground` | `#F1F5F9` / `#475569` | 補助面・補助文字 |
| `--accent` / `--accent-foreground` | `#DCFCE7` / `#14532D` | ホバー・強調面(green) |
| `--success` / `--success-foreground` | `#15803D` / `#FFFFFF` | 成功・オンライン(AA 確保) |
| `--warning` / `--warning-foreground` | `#B45309` / `#FFFFFF` | 機密警告 |
| `--destructive` / `--destructive-foreground` | `#DC2626` / `#FFFFFF` | 破壊的操作・最高機密 |
| `--border` / `--input` | `#E2E8F0` / `#CBD5E1` | |
| `--ring` | `#1E3A5F` | フォーカスリング |

### Dark

| Token | 値 |
|---|---|
| `--background` | `#0F172A` |
| `--foreground` | `#F8FAFC` |
| `--card` / `--card-foreground` | `#131D33` / `#F8FAFC` |
| `--popover` / `--popover-foreground` | `#131D33` / `#F8FAFC` |
| `--primary` / `--primary-foreground` | `#8AB0DE` / `#0B1220` |
| `--secondary` / `--secondary-foreground` | `#1E293B` / `#E2E8F0` |
| `--muted` / `--muted-foreground` | `#1B2540` / `#94A3B8` |
| `--accent` / `--accent-foreground` | `#173420` / `#86EFAC` |
| `--success` / `--success-foreground` | `#22C55E` / `#052E16` |
| `--warning` / `--warning-foreground` | `#F59E0B` / `#451A03` |
| `--destructive` / `--destructive-foreground` | `#DC2626` / `#FFFFFF` |
| `--border` / `--input` | `rgba(255,255,255,0.10)` / `rgba(255,255,255,0.16)` |
| `--ring` | `#8AB0DE` |

テーマ切替: `documentElement.class` の `dark`。既定は `system`(prefers-color-scheme 追従)。保存先は `localStorage['oc-theme']` のみ。

## 3. タイポグラフィ

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

| 用途 | スタイル |
|---|---|
| ページタイトル (h1) | 1.375rem / 700 / tracking-tight |
| セクション見出し (h2) | 1.125rem / 600 |
| 本文 | 0.9375rem / 400 / leading-relaxed |
| 補助・キャプション | 0.8125rem / `--muted-foreground` |
| 技術データ(指紋・鍵ID・バイト数・ペイロード) | `--font-mono` / tabular-nums / 0.8125–0.875rem |

鍵指紋は `7392 1840 5521 9074` 形式(4 桁×4、半角スペース区切り、mono、コピー可能)。

## 4. スペーシング / 形状 / 標高 / z-index

- スペーシング: 4/8/16/24/32/48/64px(`--space-xs..3xl`)。ページ左右パディング 16px。セクション間 24px。
- 角丸: カード・ダイアログ 12px、ボタン・入力 8px、バッジ 9999px。
- 影: sm `0 1px 2px rgba(0,0,0,.05)` / md `0 4px 6px rgba(0,0,0,.1)` / lg `0 10px 15px rgba(0,0,0,.1)`(ダークでは影に頼らず border で区切る)。
- z-index スケール(任意値禁止): ヘッダー `z-20` / 下部ナビ `z-30` / ダイアログ `z-50` / トースト `z-[60]`。

## 5. レイアウト / ナビゲーション

- 1 カラム、`max-width: 28rem`(保存済み一覧のみ md 以上 `42rem`)、中央寄せ。
- ヘッダー: sticky top、アプリ名(左)+ ネットワーク状態バッジ(右)。`padding-top: env(safe-area-inset-top)`。
- 本文下端余白: `calc(64px + env(safe-area-inset-bottom) + 16px)`(固定ナビと重なり禁止)。
- 下部ナビ: `position: fixed; left:0; right:0; bottom:0; padding-bottom: env(safe-area-inset-bottom);` 高さ 64px、4 項目等幅(暗号化=Lock, 鍵=KeyRound, 保存済み=Archive, 設定=Settings アイコン + 11px ラベル)。現在項目: `aria-current="page"` + `--primary` 色 + 上端 2px インジケーター。各項目タップ領域 ≥44×44px。
- 横スクロール禁止。長いペイロード文字列は `break-all` + `max-h` + スクロール領域。

## 6. コンポーネント規約(shadcn/ui ベース)

- **Button**: 高さ 44px(`size="lg"` 相当を既定)。primary=主操作(暗号化・生成)、secondary=補助、destructive=削除系、ghost=行内操作。アイコンのみボタンは 44×44 + `aria-label` 必須。`cursor-pointer`、遷移 150–200ms、`hover:opacity-90`。レイアウトが動く transform ホバー禁止。
- **Card**: 面=`--card`、区切りは border 優先。ホバーで浮かせない(ツール UI。リスト行のみ `hover:bg-accent`)。
- **Input/Textarea**: 高さ 44px(Textarea は min-h 120px)、フォントサイズ 16px(iOS ズーム防止)、`focus-visible:ring-2 ring-[--ring] ring-offset-2`。ラベルは `htmlFor` で必ず関連付け(placeholder をラベル代わりにしない)。
- **Dialog / AlertDialog**: 破壊的・不可逆操作は必ず AlertDialog で確認(直接実行禁止)。確認強度 3 段階: (1) 通常=確認ボタン、(2) 強=「リスクを理解しました」チェックボックスで確認ボタン活性化、(3) 最強=「全削除」の完全一致入力で活性化。destructive ボタンは右側。Esc/オーバーレイで安全側へ閉じる。
- **Badge(機密度)**: 公開=`secondary`+Globe / 機密=`--warning` 面+ShieldAlert / 最高機密=`--destructive` 面+TriangleAlert。**必ずアイコン+テキスト併記**(色のみ禁止)。最高機密は一覧・詳細で常時表示。
- **ネットワーク状態バッジ**: オンライン=`--success` ドット+「オンライン」/ オフライン=`--muted-foreground` ドット+「オフライン」。**安全性の主張をしない**(「オフラインなので安全」等の文言禁止、spec §2)。
- **トースト(sonner)**: 成功/情報のみ。エラーはインライン `role="alert"`(アイコン+文言)を優先。
- **QR 表示**: 白面パネル(padding 16px、白 `#FFFFFF` 固定、border `#E2E8F0`、rounded 12px)。サイズ既定 512px・`max-width:100%`。全画面表示は白全面・四辺 safe-area 対応・`h-dvh overflow-hidden` とし、QR は残り領域内で `max-height:100%; width:auto; object-fit:contain`。単一画像 QR は輝度ヒント+44px 閉じる、複数 QR はカウンター/44px 再生操作/密度/速度/転送再開警告/1行の輝度ヒント/44px 閉じるを表示する。縦向きは QR 上・操作下、横向きは `minmax(0,1fr)` の QR と高さ 300px 以下の操作列を左右に置き、横向きの移動/再生操作は 44×44px アイコン+`aria-label`。データサイズ・EC レベル表示を添える。

## 7. アクセシビリティ / モーション

- セマンティック HTML(`button`/`nav`/`main`/`h1..`)。div+onClick 禁止。
- フォーカス可視必須: `focus-visible:ring-2`。Tab 順序=視覚順序。
- 状態表示は アイコン+テキスト(+`aria-live="polite"` のステータス領域)。エラーは `role="alert"`。
- ダイアログはフォーカストラップ+初期フォーカスは安全側ボタン(radix 既定)。
- `prefers-reduced-motion: reduce` で transition/animation を実質無効化(グローバル CSS)。
- コントラスト: 本文 4.5:1 以上(上記トークンは充足)。

## 8. 文言トーン

- 丁寧・断定・短文。「〜できます」「〜してください」。
- 警告は結果を具体的に(「撮影・画面共有・クラウド同期された場合、暗号文を復号される可能性があります」)。
- エラーは原因候補+次の行動。内部詳細・スタックは出さない。
- オフライン表示は状態情報であり安全性の保証ではない、という前提を崩す文言を書かない。

## 9. チェックリスト(全ページ共通・実装前後で確認)

- [ ] 絵文字アイコンなし(lucide のみ) / [ ] クリック要素に cursor-pointer / [ ] ホバー・遷移 150–300ms
- [ ] ライト・ダーク両方でコントラスト AA / [ ] QR は常に白背景 / [ ] フォーカス可視 / [ ] reduced-motion 対応
- [ ] 375px で横スクロールなし / [ ] 固定ナビに内容が隠れない / [ ] タッチ領域 44px / [ ] 色のみの状態表現なし
- [ ] 破壊的操作に確認 / [ ] 最高機密に常時警告 / [ ] `aria-current`・`htmlFor`・`role="alert"` 適用
