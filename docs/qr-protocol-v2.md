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

- suite は **選択済み鍵の実 algorithm の組から一意導出**(`resolveSuite`)。
  署名付きは (768,65) / (1024,87) の同一プロファイル対のみ。混在は
  `UNSUPPORTED_ALGORITHM`。
- 初期リリースは balanced(768/65)のみ UI 露出。1024/87 は型・定数の予約。

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

## 8. ゴールデンフィクスチャ(hex 凍結)

`tests/pq/canonical-cbor.golden.test.ts` / `tests/pq/wire-bytes.golden.test.ts`
と一致すること。共通フィクスチャ: `KEY_ID = "AAECAwQFBgcICQoLDA0ODw"`
(生バイト `000102030405060708090a0b0c0d0e0f`)。

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

## 9. エラー対応表(v2 追加分)

| 状況 | コード |
|---|---|
| v2 構造の非正準/形式不正 | `INVALID_QR_PAYLOAD` |
| 署名検証失敗(本文非表示) | `SIGNATURE_INVALID` |
| 送信者署名鍵が未取込(取込導線を提示) | `SIGNING_KEY_NOT_FOUND` |
| 別 transferId 混入・フレーム不整合 | `FRAME_MISMATCH` |
| frameCount>64 等の容量超過 | `QR_TOO_LARGE` |
| OCB2(予約)・旧 RSA 形式(OCM1-RSA) | `UNSUPPORTED_ALGORITHM`(廃止文言) |
| Worker 不可(main thread へのフォールバック禁止) | `WORKER_UNAVAILABLE` |
| ローカル初期化の部分失敗 | `RESET_FAILED` |

注: plan2.1 §H の暫定名 `WIPE_FAILED` は、§B4 の正直な命名方針
(「wipe/secure erase」不使用)に合わせ `RESET_FAILED` として確定した。
