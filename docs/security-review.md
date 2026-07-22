# セキュリティレビュー記録(v2 ポスト量子)

本書は spec2 §3/§21 の完了条件のうち「採用ライブラリの独立セキュリティレビュー」
に関する**事実の記録**である。plan2.1 §A に従い、完了は次の 2 区分で判定する。

- **implementation-complete**: リポジトリ内の実装・テスト・文書が完了した状態。
  本書に「独立第三者監査 未実施」と記録したまま到達できる。
- **release-approved**: 独立第三者による選定バージョンとアプリ全体のレビューが
  記録されるまで到達しない(**external blocker**)。それまで UI・README・CI は
  experimental・未独立監査の表示を一貫して維持する。

自己調査・自己文書(本書を含む)は独立レビューの代替にならず、blocker を閉じない。

## 1. 採用ライブラリの事実(2026-07-22 時点)

### @noble/post-quantum 0.6.1(exact pin・範囲指定禁止)

- リリース: 2026-04-12。npm provenance ✓(近傍版すべて attested)
- 依存: noble 系のみ(@noble/ciphers / @noble/curves / @noble/hashes ~2.2.0)
- 実装: FIPS 203(ML-KEM)/ FIPS 204(ML-DSA)
- **独立監査: 未了**。0.6.1 時点の監査状態は self-audit(scope: everything)のみ
- **サイドチャネル: JS 実装として constant-time を保証しない**。特に ML-KEM
  decaps の implicit-rejection 経路について JS/JIT の定時間性を明記のうえ非保証
- API(0.6.1 実ソースで確認):
  `ml_kem768/1024.keygen(seed64?)` / `.encapsulate(pk)` / `.decapsulate(ct, sk)`、
  `ml_dsa65/87.keygen(seed32?)` / `.sign(msg, sk, {context})` /
  `.verify(sig, msg, pk, {context})`

### 供給網

- `aube-lock.yaml` にロック済み(コミット必須)。v1 期の供給網判断は
  `docs/threat-model.md` §5.1 参照
- ZIP 出力は依存追加せず自前 store-only 実装(`fflate` は provenance 無しのため不採用)

## 2. 表示禁止事項(spec2 §20)

UI・README・CI 表示のいずれにも次を使用しない。

- 「FIPS 認証済み」(FIPS 203/204 準拠と FIPS 140 認証は別物)
- 「完全に安全」(独立監査なしでの安全宣言)
- 「secure erase / 完全消去」(docs/boot-and-reset-v2.md 参照)

セキュリティ画面には次を明記する:
noble 未独立監査・JS サイドチャネル非保証・JS メモリー消去の限界
(GC・内部コピー・最適化により zeroize は完全でない)。

## 3. リリースごとの確認手順(README にも掲載)

1. FIPS 203 / FIPS 204 の最新エラッタ確認(NIST CSRC の当該ページ)
2. `@noble/post-quantum` の変更履歴・既知脆弱性・advisory 確認
3. KAT(`aube test:pq-vectors`)全緑の確認
4. バンドルへの外部ネットワーク参照が無いことの確認(e2e §30.5)
5. `aube-lock.yaml` の差分レビュー(provenance 維持)

## 4. 独立レビュー完了時に本書へ記録する項目(テンプレート)

- レビュー主体(独立性の根拠)/ 実施期間
- 対象 commit hash・build hash・`@noble/post-quantum` バージョンと transitive lock
- 対象範囲(ライブラリ・プロトコル設計 docs/qr-protocol-v2.md・アプリ実装)
- findings 一覧・修正 commit・再検証結果
- FIPS エラッタ確認結果

**現状: 上記は未記録(独立第三者監査 未実施)。release-approved には到達していない。**
