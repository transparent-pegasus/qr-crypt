// 鍵・QR アーティファクト関連の実行時検証。
// ドメイン型そのものは domain.ts が単一所有(ここは zod スキーマのみ)。
import { z } from "zod"
import { KEY_ID_PATTERN } from "@/lib/limits"

// 制御文字(C0 領域と DEL)を含むか。正規表現リテラルに制御文字を
// 埋め込まないため、コードポイント判定で実装する。
export function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || code === 127) return true
  }
  return false
}

// QR 名(spec §14): trim 後 1〜80 文字、制御文字禁止。同名は許可(ID で区別)。
export const qrNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "名前を入力してください")
      .max(80, "名前は80文字以内にしてください")
      .refine((value) => !hasControlChars(value), {
        message: "使用できない文字が含まれています",
      }),
  )

// 鍵名も同一規則を適用する
export const keyNameSchema = qrNameSchema

export const keyIdSchema = z.string().regex(KEY_ID_PATTERN)

// StoredKeyRecord / StoredQrArtifact の kind 別不変条件検証(plan §13 C13)は
// WP-2 が repository 書込境界の実装と合わせてここへ追加する。
