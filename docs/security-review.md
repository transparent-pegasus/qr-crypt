# セキュリティレビュー記録(v2 ポスト量子)

本書は spec2 §3/§21 の完了条件のうち「採用ライブラリの独立セキュリティレビュー」
に関する**事実の記録**である。plan2.1 §A に従い、完了は次の 2 区分で判定する。
現在の運用レビュー対象は maximum 本筋、すなわち ML-KEM-1024 と ML-DSA-87
（署名なし・署名付き）である。4 種の `WireSuite` は wire/codec 契約として維持するが、
balanced（768/65）は active policy の対象外であり、運用境界で
`UNSUPPORTED_ALGORITHM` として拒否する。

- **implementation-complete**: リポジトリ内の実装・テスト・文書が完了した状態。
  次のリポジトリ内条件をすべて満たし、本書に「独立第三者監査 未実施」と
  記録したまま到達できる。
  - maximum の identity・Worker・暗号化・復号・保存・OCP2/OCS2/OCF2 経路が
    composition/integration/UI テストで成功する。
  - `tests/pq/maximum-policy-boundaries.test.ts`、Worker integration、取込の negative
    test が balanced/768 系を暗号処理前に `UNSUPPORTED_ALGORITHM` で拒否する。
  - 設定の negative/migration test が旧 algorithm・balanced の更新注入を拒否し、
    旧 preferences は maximum へ読み取り正規化して `wipeOnOnline=false` を維持する。
  - `tests/pq/maximum-artifact-size.golden.test.ts` が次表の正準 CBOR 生バイト数、
    chunk 400/600/900B の OCF2 フレーム数、各フレームの実 EC-Q 生成、および
    env 容量ガードとの境界一致を固定する。
  - ML-KEM-1024 / ML-DSA-87 の KAT と `aube test` / `aube typecheck` が通り、
    `aube bench:pq` の maximum 参考値および README・プロトコル文書が更新される。
- **release-approved**: 独立第三者による選定バージョンとアプリ全体のレビューが
  記録されるまで到達しない(**external blocker**)。それまで UI・README・CI は
  experimental・未独立監査の表示を一貫して維持する。

自己調査・自己文書(本書を含む)は独立レビューの代替にならず、blocker を閉じない。

maximum の実測 fixture（`maxPlaintext=4,096B`、`name="テスト"`）:

| artifact | 正準 CBOR (bytes) | OCF2 frames (400 / 600 / 900B) |
|---|---:|---:|
| unsigned empty / max | 1,887 / 5,986 | 5/4/3 / 15/10/7 |
| signed empty / max | 6,613 / 10,711 | 17/12/8 / 27/18/12 |
| OCI2 bundle | 4,402 | 12/8/5 |
| OCP2 KEM / OCS2 DSA | 1,733 / 2,755 | 5/3/2 / 7/5/4 |
| OCB2 reserved sizing fixture | 4,637 | 12/8/6 |

鍵系 artifact(OCI2/OCP2/OCS2)の表示は chunk 300B 固定(`PQ_KEY_QR_FRAME_BYTES`、設定対象外; 上表の 400/600/900 は message 系・設定範囲の実測)。

## 1. 採用ライブラリの事実(2026-07-24 時点)

### @noble/post-quantum 0.6.1(exact pin・範囲指定禁止)

- リリース: 2026-04-12。npm provenance ✓(近傍版すべて attested)。**2026-07-24 再確認: 0.6.1 が最新、repo / GHSA / OSV に advisory なし**
- 依存: noble 系のみ(@noble/ciphers / @noble/curves / @noble/hashes ~2.2.0)
- 実装: FIPS 203(ML-KEM)/ FIPS 204(ML-DSA)
- FIPS エラッタ(§3-1・2026-07-24): NIST は prospective correction のみ(FIPS 204 sheet 更新 2026-02-27)。API / サイズ表への影響なし
- **独立監査: 未了**。0.6.1 時点の監査状態は self-audit(scope: everything)のみ
- **サイドチャネル: JS 実装として constant-time を保証しない**。特に ML-KEM
  decaps の implicit-rejection 経路について JS/JIT の定時間性を明記のうえ非保証
- active policy で採用する API(0.6.1 実ソースで確認):
  `ml_kem1024.keygen(seed64?)` / `.encapsulate(pk)` / `.decapsulate(ct, sk)`、
  `ml_dsa87.keygen(seed32?)` / `.sign(msg, sk, {context})` /
  `.verify(sig, msg, pk, {context})`。同ライブラリには 768/65 実装も含まれるが、
  active policy の暗号処理には使用しない

### 供給網

- `aube-lock.yaml` にロック済み(コミット必須)。v1 期の供給網判断と 2026-07-24 再確認は
  `docs/threat-model.md` §5.1 参照
- ZIP 出力は依存追加せず自前 store-only 実装(`fflate` は provenance 無しのため不採用)
- **OPEN(dev chain)**: `sharp@0.34.5` — `GHSA-f88m-g3jw-g9cj`
  (CVE-2026-33327 / CVE-2026-33328 / CVE-2026-35590 / CVE-2026-35591、公開 2026-07-17)。
  経路: `wrangler@4.113.0` → `miniflare@4.20260721.0` → sharp exact-pin。
  修正は `sharp>=0.35.0`、in-range なし、override 承認待ち。`aube audit` は現状 exit 1(期待どおり)
- 供給網ピン再確認クリーン: `react-hook-form@7.82.0`、`eslint-config-prettier@10.1.8`

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
- 対象範囲(maximum 本筋のライブラリ・プロトコル設計
  docs/qr-protocol-v2.md・アプリ実装、および維持する 4-suite wire/codec 契約)
- findings 一覧・修正 commit・再検証結果
- FIPS エラッタ確認結果

**現状: 上記は未記録(独立第三者監査 未実施)。release-approved には到達していない。**
