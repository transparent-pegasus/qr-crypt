# design-system 生成来歴(ui-ux-pro-max-skill)

spec §5「ui-ux-pro-max-skill の使用」の実施記録。

## 1. スキルの探索(spec §5 の候補順)

| 候補 | 結果 |
|---|---|
| `.claude/skills/ui-ux-pro-max/`(repo) | 無し |
| `.cursor/skills/ui-ux-pro-max/`(repo) | 無し |
| `.agents/skills/ui-ux-pro-max/`(repo) | 無し |
| `.windsurf/skills/ui-ux-pro-max/`(repo) | 無し |
| `~/.claude/skills/ui-ux-pro-max/` ほか home 直下 | 無し |
| **ローカル plugin cache** | **発見・採用**: local plugin cache (ui-ux-pro-max 2.11.0) |

- 使用バージョン: **2.11.0**(ローカルにダウンロード済み。ネットからの再インストールはしていない)
- 読了した SKILL.md: `<plugin>/.claude/skills/ui-ux-pro-max/SKILL.md`(Workflow: Step1 要件分析 → Step2 `--design-system` → Step3 `--domain` 補完 → Step4 `--stack` ガイドライン)
- 実行スクリプト: `<plugin>/src/ui-ux-pro-max/scripts/search.py`(SKILL.md が参照する scripts/search.py と同一実装。フルパス指定で実行)

## 2. 実行コマンドと結果(spec §5 指定の 3 検索)

1. `search.py "offline encryption privacy security mobile pwa" --design-system --persist -p "Offline Cipher"`
   → パターン: Trust & Authority / スタイル: **Exaggerated Minimalism**(Light/Dark Full 対応, WCAG AA)/ パレット: 紺 `#1E3A5F`+緑 `#22C55E`+ダーク地 `#0F172A`("Shield dark + connected green")/ タイポ: JetBrains Mono(Google Fonts)/ Avoid: Playful, Poor security UX, AI purple-pink gradients。
   **生成物(原本)**: `design-system/offline-cipher/MASTER.md`(スキルの persist 出力をそのまま保存)
2. `search.py "mobile bottom navigation qr code form accessibility" --stack react`
   → semantic HTML(button/nav)、label `htmlFor` 必須(placeholder をラベルにしない)、props destructure。
3. `search.py "security key management warning destructive action" --domain ux`
   → 破壊的操作は確認ダイアログ必須(直接削除禁止)、z-index はスケール運用(z-10/20/30/50、任意値禁止)。

出力全文は検索 1 が上記原本、検索 2/3 は結果全件を確定版へ反映済み。

## 3. 確定版への採用判断

確定版 `design-system/MASTER.md` は原本を次の方針で適合(理由は MASTER.md §0 の表にも記載):

- **採用**: パレット(紺/緑/ダーク)、Exaggerated Minimalism の高コントラスト・余白・装飾排除、Avoid リスト、Pre-Delivery Checklist、確認ダイアログ必須、z-index スケール、semantic HTML/`htmlFor`。
- **変更**: JetBrains Mono(Google Fonts)→ **システムフォントスタック**(spec §17/18 の外部フォント・CDN 禁止と日本語グリフ対応のため。terminal/precision の気分はデータ表示のモノスペースで維持)。ダーク単一 → ライト/ダーク両トークン化(spec §6)。マーケティング型ページ構成 → ツール型 1 カラム(本アプリは utility PWA)。
- **追加**: QR 面は常に白背景(spec §6)、機密度バッジ 3 段階、確認強度 3 段階、safe-area・44px タッチ領域・reduced-motion 規則(spec §6)。

ページ別規則は `design-system/pages/{encrypt,keys,saved-qr,settings}.md`(spec §5 の指定 5 ファイル構成)。

その後プロダクト名は Qrypt へ改名(2026-07-21)

## 4. License

The generator plugin, ui-ux-pro-max v2.11.0, is MIT-licensed (Copyright (c) 2024 Next Level Builder). Its persisted output stored in this directory is redistributed under that license.

## 5. Removed archival artifacts (2026-07-25)

For publication, `design-system/offline-cipher/` (the raw persisted generator
output duplicated by the adapted `MASTER.md`) and
`design-system/pages/saved-qr.md` (the spec of the since-removed saved-QR
page) were deleted from the tree. They remain available in git history.
References to those paths in the Japanese sections above are historical.
