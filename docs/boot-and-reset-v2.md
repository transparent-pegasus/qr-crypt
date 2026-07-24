# Boot 状態機械とローカル初期化の契約(v2)

出典: `.tmp/plan2.1.md` §B(C1/C2/C3/C4・U1/U2/U19 の解決)および
`.tmp/plan2.4.1.md`。plan2.4.1 は plan2.3.1 の §C-6/§C-7、コールド免除、
「boot 不変」を明示的に上書きする。
実装: WP-BOOT(`src/app/boot/*`, `src/storage/best-effort-reset.ts`)。
型と定数は `src/app/boot/boot-contract.ts` が凍結する。

## 1. 表示用オンラインと破壊用到達性の分離

| 用途                      | 根拠                                                                                                      | 使途                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 表示用                    | `navigator.onLine` + 既存 probe(`/manifest.webmanifest` HEAD)                                             | OnlineGate の表示切替と boot reconciliation の要求。**表示 edge 自体は破壊操作の根拠・直接トリガーにしない** |
| 破壊用(network-confirmed) | `GET /reachability-sentinel.txt?n=<nonce>`(`cache:"no-store"`)で**本文 `QRYPT-REACHABLE` の一致まで確認** | wipe-on-online の唯一のトリガー                                                                              |

- sentinel は SW の precache 対象外 + `NetworkOnly` runtime route
  (vite.config.ts)+ Cloudflare `_headers` で `Cache-Control: no-store`。
  オフラインでは必ず失敗する
- 偽陽性クラス(probe≠airgap): SW 介在・キャプティブポータル・応答遅延・
  StrictMode 二重実行。これらは sentinel の本文一致・nonce・世代番号+
  AbortSignal・同一遷移一度だけの規則で吸収する
- 表示 probe の偽陰性中は InstallScreen がブロックし続けるとは限らない。これは
  表示/破壊判定分離の残余リスクであり、次に表示が online を再コミットしたときの
  対称 reconciliation で sentinel 検査を再開する

## 2. Boot 状態機械(Router より前)

```
unknown → probing → offline-confirmed
                  → network-confirmed → wiping → wiped | partial-failure
                                      ↘ offline-confirmed (display offline nudge;
                                         非破壊の確定後処理完了後だけ)
offline-confirmed -- display online 再コミット --> probing (最大1回)
```

- `offline-confirmed` になるまで Router / `usePreferences` / 各 repository を
  mount しない。**boot controller だけが最初に DB を開き**、wipe 設定と
  機微データ存在を読む
- 破壊トリガーは network-confirmed のみ。初期 `navigator.onLine=true` でも
  sentinel 失敗なら wipe しない
- 設定読取失敗は `preferencesReadFailed=true` として `wipeOnOnline=true` を
  強制する。ただし破壊操作には keys / `pqIdentities` / Vault 鍵のいずれかの
  存在を独立に確認できたことも必要で、DB open/count/lookup 失敗だけを機微データ
  存在の証拠として初期化してはならない
- 2026-07-24 時点の boot 読取互換 allowlist は algorithm
  (`A256GCM`, `RSA-HYBRID`, `MLKEM768_A256GCM`,
  `MLKEM768_MLDSA65_A256GCM`, `MLKEM1024_A256GCM`,
  `MLKEM1024_MLDSA87_A256GCM`)と profile (`balanced`, `maximum`)。
  保存済み設定を読取失敗へ変えて上記 fail-safe を誤発火させないため append-only とする
- sentinel 本文一致後は破壊判断をラッチする。offline 要求は maintenance token
  消費、transient reset、または条件を満たす wipe を取り消さない。世代番号と
  AbortSignal が probe を失効できるのは sentinel 確定前だけである

## 3. 発火条件(オーナー要件: 既定 ON の維持)

`Preferences.wipeOnOnline` 既定 **true**。ただし:

1. install ゲート経路(機微データ皆無)では wipe しない
2. network-confirmed(sentinel 本文一致)のみ発火
3. **maintenance token**: オフライン中に強確認で設定する「次の一回だけ鍵を
   保持して更新」。1 回の verified transition 後に必ず失効し ON へ復帰
4. 永続 OFF は常時警告表示

## 4. WipeCoordinator の順序(単一・boot 層所有)

1. 新規 UI/crypto/storage 操作を fail-closed(以降の repository/worker 呼出は即エラー)
2. Worker を cancel/terminate。app 所有の seed/plaintext/sharedSecret buffer と
   Vault 鍵キャッシュ・promise 参照を drop(zeroize)
3. transient/SensitiveSession を非表示・reset
4. `navigator.locks`(fallback あり)+ `BroadcastChannel("qrypt-wipe")` で
   全タブへ停止/close 要求
5. **Vault 配下の `EncryptedSecret` を先に削除 → Vault 鍵レコードを削除**
   (暗号シュレッディング。非抽出 `CryptoKey` の byte 上書きは不可能であり主張しない)
6. 全 DB(`pqIdentities`/`pqPublicBundles` 含む)+ `oc-*` localStorage を削除。
   `online-detected` の場合だけ、削除後かつ `wiped` publish 前に
   `oc-offline-ack-pending="1"` を再設定する。`user-requested` では再設定しない
7. DB 不在を再確認して barrier 維持。`deleteDB({blocked})`/`openDB({blocking,blocked})`
   に timeout+UI。部分失敗は成功文言にせず `RESET_FAILED` として提示

## 5. 正直な命名と表現(禁止: secure erase / 完全消去)

- モジュール名は `best-effort-reset`。UI/README/threat-model の表現は
  「**ローカルデータの論理削除を試行。物理消去は保証しない**(LevelDB 追記型・
  SSD ウェアレベリング)。確実な消去は端末の完全フォーマット」
- churn(`resetChurnMb`)は**既定 0** の実験オプション(上書きは消去保証に
  ならない)。idle/quota 上限/AbortSignal/失敗記録付き。完了表示は
  「論理削除を試行しました(物理消去は未保証)」
- SW キャッシュ(アプリ本体・非機密)は維持する

## 6. 防御境界(threat-model / UI に明記)

本機能は「**接続後に現在の(信頼できる)コードが実行できた場合の残存データ低減**」
であり、次を防がない: 同一オリジンの悪意あるコード・物理回収(ディスクイメージ)・
更新で先に実行される侵害コード。theme(`oc-theme`)と承認保留マーカー
(`oc-offline-ack-pending="1"`)は非機密だが `oc-*` 一括削除に含まれる。
オンライン検出 wipe では後者だけを上記の順序で再設定する。

## 7. 表示専用のオフライン承認 phase と永続マーカー

BootState と §4 の one-way barrier の外側(AppProviders 配下)に display-only ack
phase を一つだけ置く。初期 `navigator.onLine` は hint に留め、表示用 probe が online
を commit した後の online→offline edge ごとに generation を進める。表示 online の
state commit 前と boot の `network-confirmed` publish 前には、同期 API が origin 単位の
`oc-offline-ack-pending="1"` を設定する。値はオンライン接触後の説明が未承認であること
だけを表し、鍵・平文・暗号文を含まない非機密の制御状態である。

マーカーの読取は DisplayGate の lazy initializer で同期実施する。`"1"`、malformed
値、読取例外、storage 利用不能はいずれも pending(fail-closed)であり、初期位相は
`coldOffline:false, ackPending:true, offlineGeneration:1` となる。承認までは Router、
子 effect、preferences/repository を mount しない。マーカー不在の真のコールド offline
だけは従来どおり免除する。

承認時はマーカー削除を先に試行し、削除成否にかかわらず自タブの当該 generation の
承認を成立させる。削除失敗は次回も pending 側となる。別タブの storage removal event
は自タブの進行中 pending を解除しない。永続承認は origin 単位、タブ内 generation は
従来どおりタブ単位であり、競合時の過剰な再承認は許すが承認省略は許さない。

| boot / wipe 結果            | offline edge / reload 後の動作                                                                                            | マーカー                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| wipe なし                   | generation ごとの承認後に初めて Router を mount                                                                           | 承認時に削除を試行                                                                                        |
| `wiped` (`online-detected`) | 結果と承認を同じ全画面 shell に表示し、「再読み込みして続行」から full reload。現 JS lifetime では Router を mount しない | `oc-*` 削除後・`wiped` publish 前に再設定。未承認 reload でも shell、承認後 reload はマーカー不在コールド |
| `partial-failure`           | `RESET_FAILED` とタブを閉じる／端末を完全フォーマットする案内だけを表示し、再開経路を設けない                             | online 接触の証拠として再設定を維持                                                                       |
| `user-requested`            | 手動初期化後の通常フロー                                                                                                  | `oc-*` 削除後に再設定しない                                                                               |

表示 offline コミットは sentinel を発行せず、boot が `network-confirmed` の場合だけ専用
ナッジを一度要求する。表示 online 再コミット時に boot が `offline-confirmed` なら、
BootGate が同一 controller の通常 sentinel probe を最大一度起動する。表示 edge が wipe
を直接発火することはなく、承認表示・チェック自体も端末の安全性を検証・回復しない。
