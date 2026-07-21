# Qrypt QR プロトコル仕様 v1

本書は QR コードで交換されるペイロードの正式仕様である。実装(`src/qr/payload.ts`, `src/crypto/*`)と単体テストは本書に従う。

## 1. ペイロード文字列

```
<PREFIX><base64url(CBOR(envelope))>
```

- 文字集合: プレフィックス 5 文字(ASCII)+ base64url(`A-Z a-z 0-9 - _`、**パディング無し**)。ASCII のみのため QR はバイトモードで符号化され、文字数=バイト数。
- 最大長: 8192 文字(パース前の入力上限。QR 実容量はこれより小さく、生成時に別途検証)。

| プレフィックス | 種別 | エンベロープ型 |
|---|---|---|
| `OCM1:` | 暗号文メッセージ | `AesMessageEnvelopeV1` または `RsaHybridEnvelopeV1` |
| `OCK1:` | 共通鍵 | `SymmetricKeyEnvelopeV1` |
| `OCP1:` | 公開鍵 | `PublicKeyEnvelopeV1` |
| `OCB1:` | 暗号化済み秘密鍵バックアップ | **v1 では予約のみ。生成・受理とも行わない**(受理時は UNSUPPORTED_ALGORITHM ではなく INVALID_QR_PAYLOAD「この種別は未対応です」相当で拒否) |

## 2. CBOR 符号化

- ライブラリ: cbor-x。`new Encoder({ useRecords: false, tagUint8Array: false })` / 対応する Decoder。
- エンベロープは CBOR map(文字列キー)。バイナリは CBOR byte string(tag 無し)→ 復号時 Uint8Array。
- 決定性: 本プロトコルはフィールド順序に意味を持たせない(AAD はエンベロープの CBOR 表現に依存しない。§4)。

## 3. エンベロープ定義

### 3.1 `AesMessageEnvelopeV1`(OCM1)

| キー | 型 | 制約 |
|---|---|---|
| `v` | int | `1` 固定 |
| `type` | text | `"message"` 固定 |
| `algorithm` | text | `"A256GCM"` |
| `keyId` | text | `^[A-Za-z0-9_-]{22}$`(16 バイト乱数の base64url) |
| `createdAt` | int | Unix ms。`0 < x < 2^53` |
| `iv` | bytes | **12 バイト固定** |
| `ciphertext` | bytes | 16〜4112 バイト(= 平文上限 4096 + GCM タグ 16。上限は `VITE_MAX_PLAINTEXT_BYTES + 16` から導出) |
| `aad` | bytes | ≤128 バイト。§4 の再計算値と完全一致必須 |

### 3.2 `RsaHybridEnvelopeV1`(OCM1)

3.1 に対し `keyId` → `recipientKeyId`(同形式)、`algorithm` = `"RSA-OAEP-3072+A256GCM"`、追加 `wrappedKey`: bytes **384 バイト固定**(RSA-OAEP/SHA-256 で raw AES-256 鍵を wrap した値)。

### 3.3 `SymmetricKeyEnvelopeV1`(OCK1)

`v:1, type:"symmetric-key", algorithm:"A256GCM", keyId, createdAt, key: bytes` — `key` は **32 バイト固定**(AES-256 raw)。

### 3.4 `PublicKeyEnvelopeV1`(OCP1)

`v:1, type:"public-key", algorithm:"RSA-OAEP-3072", keyId, createdAt, spki: bytes` — `spki` は SubjectPublicKeyInfo(DER)。350〜1200 バイトの範囲検証+`importKey` 成功で最終確認。

## 4. AAD(追加認証データ)

```
AAD = UTF-8( "OCAAD1|" + v + "|" + type + "|" + algorithm + "|" + keyId + "|" + createdAt )
```

- `keyId` は AES では `keyId`、RSA ハイブリッドでは `recipientKeyId`。
- 暗号化時: この値を `envelope.aad` に格納し、AES-GCM の `additionalData` に使用。
- 復号時: エンベロープの平文フィールドから AAD を**再計算**し、`envelope.aad` とバイト一致しなければ復号を試みず失敗(DECRYPTION_FAILED)。一致した場合のみ `additionalData` として復号。これによりバージョン・種別・方式・鍵 ID・作成時刻の改竄は GCM タグ検証でも検出される。

## 5. 暗号操作

- **AES-256-GCM**: 鍵 256bit・extractable(共通鍵 QR 生成のため)。IV は暗号化ごとに `crypto.getRandomValues(new Uint8Array(12))`。同一鍵での IV 再利用禁止(実装はテストで多重暗号化時の IV 非重複を検証)。タグ長 128bit(WebCrypto 既定)。
- **RSA ハイブリッド**: メッセージごとに使い捨て AES-256-GCM 鍵を生成 → 本文を AES-GCM 暗号化 → AES 鍵を受信者 RSA-OAEP(3072/SHA-256)公開鍵で `wrapKey('raw')` → `wrappedKey`。RSA で本文を直接暗号化しない。復号は `unwrapKey`(復元鍵は non-extractable, `['decrypt']`)→ AES-GCM 復号。
- 受信者鍵ペア: 公開鍵 `['encrypt','wrapKey']` extractable / 秘密鍵 `['decrypt','unwrapKey']` **non-extractable**。

## 6. 検証順序とエラー対応

| # | 検査 | 失敗時エラー |
|---|---|---|
| 1 | プレフィックスが 4 種のいずれか | `INVALID_QR_PREFIX` |
| 2 | OCB1 | `INVALID_QR_PAYLOAD`(未対応種別) |
| 3 | base64url 文字集合・長さ ≤8192 | `INVALID_QR_PAYLOAD` |
| 4 | CBOR デコード成功・map である | `INVALID_QR_PAYLOAD` |
| 5 | `v === 1` | `UNSUPPORTED_PROTOCOL_VERSION` |
| 6 | `type` がプレフィックスと整合 | `INVALID_QR_PAYLOAD` |
| 7 | `algorithm` が当該 type の既知値 | `UNSUPPORTED_ALGORITHM` |
| 8 | Zod strict 検証(未知キー拒否・型・バイト長・範囲) | `INVALID_QR_PAYLOAD` |

復号時の失敗(AAD 不一致・タグ不一致・鍵不一致)はすべて「復号できませんでした。鍵、暗号方式、または暗号文が一致していません。」に正規化し、部分平文・内部例外を表示しない。

## 7. QR 生成パラメーター(spec §13)

| 種別 | EC | quiet zone | サイズ |
|---|---|---|---|
| 暗号文(OCM1) | Q(既定、設定で変更可) | 4 | 512px |
| 鍵(OCK1/OCP1) | **H 固定** | 4 | 512px |

容量(QR v40 バイトモード): L=2953 / M=2331 / Q=1663 / H=1273 バイト。超過は `QR_TOO_LARGE`(生成前判定+生成例外の両方を捕捉)。予想サイズは `estimatePayloadChars(plaintextBytes, alg)`(実測 ±10% 以内をテストで担保)で事前表示する。

## 8. 鍵 ID・指紋・ファイル名

- 鍵 ID / アーティファクト ID: 16 バイト乱数 → base64url 22 文字。短縮表示は先頭 8 文字。
- 指紋: 鍵の正規化バイナリ(AES=raw 32B、公開鍵=SPKI DER)の SHA-256。内部識別は hex 64 文字全体。表示は先頭 8 バイトを 2 バイトごと big-endian uint16 % 10000 → 4 桁ゼロ埋め×4 グループ(例 `7392 1840 5521 9074`)。
- 出力ファイル名: `<sanitized-name>-<shortId>.<png|svg|txt>`。sanitize は制御文字・`/\:*?"<>|` 除去+trim、空なら `qr`。秘密情報・平文・鍵素材を含めない。

## 9. 互換性ポリシー

- 未知の `v` は将来バージョンとして拒否(UNSUPPORTED_PROTOCOL_VERSION、「新しいバージョンのアプリで作成されたQRです」)。
- v1 実装は未知キーを受理しない(strict)。フィールド追加時は `v` を上げる。
- 形式安定性は golden fixture テスト(固定鍵・固定 IV から生成した既知ペイロード文字列の完全一致+復号往復)で担保する。
