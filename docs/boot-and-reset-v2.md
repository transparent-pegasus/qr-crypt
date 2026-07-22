# Boot 状態機械とローカル初期化の契約(v2)

出典: `.tmp/plan2.1.md` §B(C1/C2/C3/C4・U1/U2/U19 の解決)。
実装: WP-BOOT(`src/app/boot/*`, `src/storage/best-effort-reset.ts`)。
型と定数は `src/app/boot/boot-contract.ts` が凍結する。

## 1. 表示用オンラインと破壊用到達性の分離

| 用途 | 根拠 | 使途 |
|---|---|---|
| 表示用 | `navigator.onLine` + 既存 probe(`/manifest.webmanifest` HEAD) | OnlineGate の表示切替のみ。**破壊操作の根拠にしない** |
| 破壊用(network-confirmed) | `GET /reachability-sentinel.txt?n=<nonce>`(`cache:"no-store"`)で**本文 `QRYPT-REACHABLE` の一致まで確認** | wipe-on-online の唯一のトリガー |

- sentinel は SW の precache 対象外 + `NetworkOnly` runtime route
  (vite.config.ts)+ Cloudflare `_headers` で `Cache-Control: no-store`。
  オフラインでは必ず失敗する
- 偽陽性クラス(probe≠airgap): SW 介在・キャプティブポータル・応答遅延・
  StrictMode 二重実行。これらは sentinel の本文一致・nonce・世代番号+
  AbortSignal・同一遷移一度だけの規則で吸収する

## 2. Boot 状態機械(Router より前)

```
unknown → probing → offline-confirmed
                  → network-confirmed → wiping → wiped | partial-failure
```

- `offline-confirmed` になるまで Router / `usePreferences` / 各 repository を
  mount しない。**boot controller だけが最初に DB を開き**、wipe 設定と
  機微データ存在を読む
- 破壊トリガーは network-confirmed のみ。初期 `navigator.onLine=true` でも
  sentinel 失敗なら wipe しない
- 設定読取に失敗した場合の fail-safe は **wipe 側**(機微データ保護優先)

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
6. 全 DB(`pqIdentities`/`pqPublicBundles` 含む)+ `oc-*` localStorage を削除
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
更新で先に実行される侵害コード。theme(`oc-theme`)は非機密だが `oc-*` 一括削除に
含まれる。
