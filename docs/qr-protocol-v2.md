# Qrypt QR プロトコル仕様 v2(ポスト量子)

本書は v2(ML-KEM / ML-DSA)ワイヤー形式の正式仕様である。実装
(`src/crypto/pq/*`, `src/qr/payload-v2.ts`, `src/qr/multipart/*`)と
`tests/pq/*` のゴールデンフィクスチャは本書に従う。v1 形式は
`docs/qr-protocol.md` を維持する(v1 プレフィックスの ML 用途再利用は禁止)。
契約の出典は `.tmp/plan2.1.md`(spec2 差分の確定上書き)。

## 1. プレフィックス表

| プレフィックス | artifactType / 種別 | 内容 |
|---|---|---|
| `OCM2:` | `pq-message` | ML-KEM メッセージエンベロープ |
| `OCP2:` | `pq-kem-public-key` | ML-KEM 公開鍵(単鍵) |
| `OCS2:` | `pq-dsa-public-key` | ML-DSA 署名検証公開鍵(単鍵) |
| `OCI2:` | `pq-public-identity` | 公開鍵セット(KEM+DSA) |
| `OCB2:` | `encrypted-seed-backup` | 予約(生成・受理とも不可) |
| `OCF2:` | フレーム | 複数 QR フレーム |

- `OCM2/OCP2/OCS2/OCI2` は「単一ペイロード表現(貼付・ファイル取込)と論理型」。
  **QR 表示は常に `OCF2`(frameCount≥1)経由**で行う。
- 取込は (a) `OCF2` 組立 → 内側 artifact、(b) bare `OC?2` 単一貼付、の両対応。
- `OCB2` は `VITE_ENABLE_ENCRYPTED_SEED_BACKUP=false` 固定のため、分類時点で
  `UNSUPPORTED_ALGORITHM` として拒否する。
- 管理された逸脱: spec2 §12 の artifactType 3 値に `pq-kem-public-key` /
  `pq-dsa-public-key` を追加した(単鍵も常時フレーミングで運ぶため。README 逸脱表参照)。

## 2. 正準 CBOR プロファイル(v2 全構造で共通)

RFC 8949 §4.2.1 core deterministic encoding のサブセット。実装は
`src/crypto/pq/canonical-cbor.ts`(自前コーデック。ワイヤー契約を外部
ライブラリの版依存挙動から切り離すため cbor-x は使用しない)。

- 値は **map(text キーのみ)/ text string / byte string / 非負整数** に限定
- すべて definite length。**タグ・浮動小数・負数・配列・null・bool・simple 禁止**
- 整数・長さヘッダーは最小表現(preferred encoding)
- map キーは「キー単体の符号化バイト列」の bytewise 辞書順・重複禁止
- 復号側は最小表現・キー昇順・単一値を構造的に強制し、さらに再符号化
  バイト一致を検査する(非正準入力は必ず `INVALID_QR_PAYLOAD`)
- ネスト深さ上限 8

## 3. エンベロープ(OCM2)

```typescript
MlKemMessageEnvelopeV2 = {
  version: 2
  type: "pq-message"
  suite: WireSuite            // §4 の 4 リテラル
  recipientKemKeyId: string   // base64url 22 文字(生 16 バイト)
  kemCiphertext: bytes        // 768: 1088B / 1024: 1568B(suite で長さ検証)
  hkdfSalt: bytes(32)         // 暗号化ごとの CSPRNG
  iv: bytes(12)               // CSPRNG
  ciphertext: bytes(≥16)      // AES-256-GCM(タグ 128bit 末尾)
}
```

AAD(GCM の additionalData。ワイヤーへは載せず両側で再構築):

```typescript
MlKemAadV2 = {
  version: 2
  type: "pq-message"
  suite: WireSuite
  recipientKemKeyId: string
  kemCiphertextSha256: bytes(32)  // 受信側は受信 kemCiphertext から再計算し一致検証
}
```

## 4. スイートと鍵導出

`WireSuite`(spec2 §7):

```
ML-KEM-768+HKDF-SHA256+A256GCM
ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM
ML-KEM-1024+HKDF-SHA256+A256GCM
ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM
```

`src/crypto/pq/profiles.ts` の固定サイズ(すべて byte):

| profile | KEM | public key | expanded secret key | ciphertext | shared secret | seed |
|---|---|---:|---:|---:|---:|---:|
| balanced | ML-KEM-768 | 1184 | 2400 | 1088 | 32 | 64 |
| maximum | ML-KEM-1024 | 1568 | 3168 | 1568 | 32 | 64 |

| profile | DSA | public key | expanded secret key | signature | seed |
|---|---|---:|---:|---:|---:|
| balanced | ML-DSA-65 | 1952 | 4032 | 3309 | 32 |
| maximum | ML-DSA-87 | 2592 | 4896 | 4627 | 32 |

expanded secret key は実行時に seed から展開する値で、wire や永続ストレージへ
保存しない(§7)。

- 上記 4 suite は **wire/codec 契約として維持**する。`WireSuite`、
  `resolveSuite`、`suiteComponents` は 768/65 と 1024/87 の双方を認識し、
  正当な同一プロファイル対を往復できる。
- suite は **選択済み鍵の実 algorithm の組から一意導出**(`resolveSuite`)。
  署名付きは (768,65) / (1024,87) の同一プロファイル対のみ。混在は
  `UNSUPPORTED_ALGORITHM`。
- **active policy（2026-07-24）**は maximum（1024/87）の 2 suite
  （署名なし・署名付き）のみを運用対象とする。balanced profile および 768 系
  2 suite は「認識済みだが非対応」であり、構造不正にはせず、取込・鍵生成・
  ローテーション・暗号化・復号・Worker RPC・QR 再出力などの運用境界で暗号処理前に
  `UNSUPPORTED_ALGORITHM` として拒否する。

HKDF-SHA-256(`hkdfInfoV2`、plan2.1 §C5 で凍結):

```
info = UTF8("QRYPT-MESSAGE-V2") || 0x00 || UTF8(wireSuite) || 0x00
       || kemKeyIdRaw(16 bytes) || 0x02
salt = 暗号化ごとの CSPRNG 32B / 導出鍵 = AES-256-GCM(non-extractable)
```

`kemKeyIdRaw` は keyId(base64url 22 文字)の**デコード前生 16 バイト**。

復号成功条件(順序固定): KEM 入力長検証 → Decaps(値が返るだけでは不成功)
→ HKDF → **AES-GCM 認証成功** → 内側スキーマ検証 → (署名付きは)ML-DSA 検証。
失敗は `DECRYPTION_FAILED`(署名のみ失敗は `SIGNATURE_INVALID`・本文非表示、
署名鍵未登録は `signed-key-unknown` 状態で本文を構成しない)。

## 5. 内部メッセージ(Sign-then-Encrypt)

ワイヤー形状は **外側 suite が権威**(メモリー内判別子 `kind` は載せない):

- 非署名 suite → `UnsignedMessageBodyV2` の map 単体
  (キー: `version, messageId(16B), createdAt, recipientKemKeyId, plaintext`。
  `senderSigningKeyId` は**キーごと省略**)
- 署名付き suite → `{ body: SignedMessageBodyV2, signature: { algorithm, value } }`
  (body に `senderSigningKeyId` 必須。signature.value の長さは
  65: 3309B / 87: 4627B)

不一致は拒否: 非署名 suite に signature/senderSigningKeyId → `DECRYPTION_FAILED`
(構造検証で `INVALID_QR_PAYLOAD` 相当)、署名付き suite の signature 欠落/検証失敗
→ `SIGNATURE_INVALID`。

- **署名対象 = `SignedMessageBodyV2` の map 単体の正準 CBOR**(`signingTargetBytes`)
- ML-DSA コンテキスト = `UTF8("QRYPT-MESSAGE-V2")` 固定(≤255B)
- `messageId` = CSPRNG 16B 固定長。**リプレイ防止機構ではない**。
  `createdAt` は端末申告時刻(信頼時刻ではない)

## 6. 複数 QR フレーム(OCF2)

```typescript
QrFrameV2 = {
  version: 2
  type: "qr-frame"
  transferId: bytes(16)       // CSPRNG
  artifactType: V2ArtifactType
  frameIndex: uint            // 0 起点(0..frameCount-1)
  frameCount: uint            // 1..64
  totalByteLength: uint       // artifact 生バイト合計(≤ 64×900)
  payloadSha256: bytes(32)    // artifact 生バイトへの SHA-256(転送整合性)
  chunk: bytes(1..900)        // artifact CBOR 生バイトの分割片
}
```

- **`chunk` は artifact CBOR の生バイトを直接分割**する(内側 `OC?2:` 文字列の
  再 base64url は禁止 — 二重 base64url によるフレーム数膨張を避ける)
- フレーム文字列 = `OCF2:<base64url(正準CBOR(frame))>`。EC レベルは **Q 固定**。
  1 フレーム文字列はプレフィックス込み **≤1663 文字**(QR v40-Q)。
  生成後に `payloadFits(…, "Q")` を確認し、収まらなければ `QR_TOO_LARGE`
- 既定: chunk 600B / 切替 450ms / 最大 64 フレーム(設定で 400–900B・150–2000ms)
- 鍵系 artifact(OCI2/OCP2/OCS2)の表示は chunk 300B 固定(`PQ_KEY_QR_FRAME_BYTES`、設定対象外)
- 組立の不変条件: first frame で immutable metadata
  (transferId/artifactType/frameCount/totalByteLength/payloadSha256)を凍結。
  同 index は完全一致のみ重複無視、1 byte でも差異・別 transferId 混入は
  `FRAME_MISMATCH`。完成時に index coverage・合計長・SHA-256・artifactType
  一致を検証してから内側を解釈する。未完成のうちは暗号処理を開始しない
- `payloadSha256` は転送整合性であり**送信者 authenticity ではない**(UI 表示注意)
- 読取状態はタイムアウト(既定 10 分)・明示破棄・完成・エラーで解放する

## 7. Vault(シード保管)

- 保存するのは**シードのみ**(KEM 64B / DSA 32B)。展開済み秘密鍵は永続化しない
- Vault 鍵 = 非抽出 AES-256-GCM `CryptoKey`(appMetadata `vault-key`。
  作成は cross-tab lock + 存在確認 → add。上書き禁止)
- `EncryptedSecret = { iv(12B), ciphertext }`、AAD = 正準 CBOR
  (`buildVaultAadV2`):

```typescript
{ version: 2, type: "qrypt-vault-aad", identityId, role("ml-kem-seed"|"ml-dsa-seed"),
  algorithm, keyId, publicKeySha256(32B) }
```

- シード復号後は keygen で公開鍵を再生成し、**保存公開鍵と完全一致してから**
  sign/decaps に使う(レコード差替えの fail-closed)

### 7.1 公開鍵 artifact と指紋

`OCI2` の map は次の形を取り、`name` だけが省略可能である。KEM/DSA は §4 の
同一 profile 対だけを受理し、公開鍵長も同表と完全一致しなければならない。

```typescript
PublicIdentityBundleV2 = {
  version: 2
  type: "pq-public-identity"
  identityId: string
  name?: string
  kem: { algorithm: MlKemAlgorithm, keyId: string, publicKey: bytes }
  signing: { algorithm: MlDsaAlgorithm, keyId: string, publicKey: bytes }
  createdAt: uint
}
```

`OCP2` / `OCS2` はそれぞれ `type` が `pq-kem-public-key` /
`pq-dsa-public-key` の単鍵 map で、共通キーは
`version, type, identityId, name?, algorithm, keyId, publicKey, createdAt`。
`identityId` と各 `keyId` は base64url 22 文字、`name` は存在する場合
1–100 UTF-16 単位、`createdAt` は非負 safe integer とする。

個別鍵指紋と identity 指紋は次のバイト列への SHA-256:

```
kem      = UTF8("QRYPT-FP-KEM-V2") || 0x00 || UTF8(algorithm) || 0x00 || publicKey
signing  = UTF8("QRYPT-FP-DSA-V2") || 0x00 || UTF8(algorithm) || 0x00 || publicKey
identity = UTF8("QRYPT-FP-ID-V2") || 0x00
           || canonicalCbor({ version, type, identityId, kem, signing, createdAt })
```

identity 指紋は未認証・可変の `name` を除外する一方、`identityId` と
`createdAt` は含める。

## 8. ゴールデンフィクスチャ(hex 凍結)

`tests/pq/canonical-cbor.golden.test.ts` / `tests/pq/wire-bytes.golden.test.ts`
および `tests/pq/composition-golden.test.ts` と一致すること。共通フィクスチャ:
`KEY_ID = "AAECAwQFBgcICQoLDA0ODw"`
(生バイト `000102030405060708090a0b0c0d0e0f`)。
以下の 768 系 fixture は wire/codec 契約の互換性を固定するものであり、
active policy で利用可能であることを意味しない。

- HKDF info(unsigned 768):
  `51525950542d4d4553534147452d5632004d4c2d4b454d2d3736382b484b44462d5348413235362b4132353647434d00000102030405060708090a0b0c0d0e0f02`
- HKDF info(signed 768):
  `51525950542d4d4553534147452d5632004d4c2d4b454d2d3736382b4d4c2d4453412d36352b484b44462d5348413235362b4132353647434d00000102030405060708090a0b0c0d0e0f02`
- ML-DSA context: `51525950542d4d4553534147452d5632`
- `MlKemAadV2`(suite=unsigned768, sha256=0x22×32):
  `a564747970656a70712d6d657373616765657375697465781e4d4c2d4b454d2d3736382b484b44462d5348413235362b4132353647434d6776657273696f6e0271726563697069656e744b656d4b657949647641414543417751464267634943516f4c4441304f4477736b656d4369706865727465787453686132353658202222222222222222222222222222222222222222222222222222222222222222`
- Vault AAD(kem-seed/768, pkSha=0x11×32): 先頭 `a764726f6c65…`
  (全 hex はテスト参照)
- 署名対象(createdAt=1700000000000 → **uint64 `1b0000018bcfe56800`**、
  float64 `fb…` は不可): 全 hex はテスト参照
- エンベロープ(kemCt=0x33×1088, salt=0x44×32, iv=0x55×12, ct=0x66×20):
  1301B、SHA-256 `53b5af7642d5394156ef4eacfac829181a682e067d9c1fbc8297206117cea924`
- bundle(名前「テスト」, 鍵 0x0a/0x0b 充填): 3377B、SHA-256
  `db7231d753096cc2847e87767040772ca7daef5f726104549d75f1359429925c`
- 個別 KEM 鍵指紋(ML-KEM-768、公開鍵 0x0a×1184):
  `86cca89b088994ddd47493b21d6c2ff3e3d44621ab842d289ca92325b1425dc9`
- 上記 bundle の identity 指紋(`name` 除外):
  `803025820e019d89098a95ec449fb59aa6f0232c856d036172425e81a2716122`
- maximum 署名付き end-to-end composition(固定 seed/randomness):
  - KEM ciphertext SHA-256:
    `7e7cc499f2d0f3bb0bb7aa61a3705c83bfc5cf2446b6bc81a1aa4badd2ea25ae`
  - 正準 CBOR envelope SHA-256:
    `5986a6b363df30bc95dfa668b03359315df88d3b7f67593dbe62bf61cc4b2f18`
  - ML-DSA-87 signature SHA-256:
    `e14ce55d6babde5635701fcf79566b8b064fc353ccbbdc7b8de50ade1385fcb2`

## 9. エラー対応表(v2 追加分)

| 状況 | コード |
|---|---|
| v2 構造の非正準/形式不正 | `INVALID_QR_PAYLOAD` |
| 署名検証失敗(本文非表示) | `SIGNATURE_INVALID` |
| 送信者署名鍵が未取込(取込導線を提示) | `SIGNING_KEY_NOT_FOUND` |
| 別 transferId 混入・フレーム不整合 | `FRAME_MISMATCH` |
| frameCount>64 等の容量超過 | `QR_TOO_LARGE` |
| OCB2(予約)・balanced/768 系の運用・旧 RSA 形式(OCM1-RSA) | `UNSUPPORTED_ALGORITHM`(廃止文言) |
| Worker 不可(main thread へのフォールバック禁止) | `WORKER_UNAVAILABLE` |
| ローカル初期化の部分失敗 | `RESET_FAILED` |

注: plan2.1 §H の暫定名 `WIPE_FAILED` は、§B4 の正直な命名方針
(「wipe/secure erase」不使用)に合わせ `RESET_FAILED` として確定した。
