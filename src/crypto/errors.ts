// エラーモデル(spec §29)。内部例外・スタック・鍵素材を利用者向け文言に含めない。

export const ERROR_CODES = [
  "UNSUPPORTED_BROWSER",
  "INVALID_QR_PREFIX",
  "INVALID_QR_PAYLOAD",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "UNSUPPORTED_ALGORITHM",
  "KEY_NOT_FOUND",
  "KEY_TYPE_MISMATCH",
  "ENCRYPTION_FAILED",
  "DECRYPTION_FAILED",
  "QR_TOO_LARGE",
  "STORAGE_FAILED",
  "CAMERA_PERMISSION_DENIED",
  "CAMERA_NOT_AVAILABLE",
  "DUPLICATE_KEY",
  "DUPLICATE_QR",
  // v2(ポスト量子)追加。plan2.1 §H。
  "SIGNATURE_INVALID",
  "SIGNING_KEY_NOT_FOUND",
  "FRAME_MISMATCH",
  "WORKER_UNAVAILABLE",
  "RESET_FAILED",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const USER_MESSAGES: Record<ErrorCode, string> = {
  UNSUPPORTED_BROWSER:
    "このブラウザーでは必要な機能を利用できません。対応ブラウザーで開いてください。",
  INVALID_QR_PREFIX: "このQRコードは本アプリの形式ではありません。",
  INVALID_QR_PAYLOAD:
    "QRコードの内容を読み取れませんでした。形式が不正か、破損しています。",
  UNSUPPORTED_PROTOCOL_VERSION:
    "新しいバージョンのアプリで作成されたQRコードです。アプリを更新してください。",
  UNSUPPORTED_ALGORITHM: "対応していない暗号方式です。",
  KEY_NOT_FOUND: "対応する鍵が見つかりません。",
  KEY_TYPE_MISMATCH: "選択した鍵はこの操作に使用できません。",
  ENCRYPTION_FAILED: "暗号化に失敗しました。入力内容を確認してください。",
  DECRYPTION_FAILED:
    "復号できませんでした。鍵、暗号方式、または暗号文が一致していません。",
  QR_TOO_LARGE: "データ量が多いため、この誤り訂正レベルではQRコードを生成できません。",
  STORAGE_FAILED: "保存領域の操作に失敗しました。",
  CAMERA_PERMISSION_DENIED:
    "カメラの使用が許可されていません。ブラウザーの設定で許可してください。",
  CAMERA_NOT_AVAILABLE: "カメラを利用できません。",
  DUPLICATE_KEY: "同じ内容の鍵がすでに保存されています。",
  DUPLICATE_QR: "同じ内容のQRコードがすでに保存されています。",
  SIGNATURE_INVALID:
    "署名を検証できませんでした。送信者の署名鍵、または内容が一致していません。",
  SIGNING_KEY_NOT_FOUND:
    "この署名に対応する送信者の署名鍵が見つかりません。先に署名検証用の公開鍵を取り込んでください。",
  FRAME_MISMATCH:
    "異なる転送のQRコードが混在しています。読み取り状態を破棄してやり直してください。",
  WORKER_UNAVAILABLE:
    "この端末では暗号処理を安全に実行できませんでした。対応ブラウザーで開き直してください。",
  RESET_FAILED: "ローカルデータの初期化中に一部の操作が完了しませんでした。",
}

export function userMessageFor(code: ErrorCode): string {
  return USER_MESSAGES[code]
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly userMessage: string

  constructor(code: ErrorCode) {
    // message にはコード名のみを載せ、内部詳細や原因例外を保持しない(漏洩防止)
    super(code)
    this.name = "AppError"
    this.code = code
    this.userMessage = USER_MESSAGES[code]
  }
}

export function toAppError(error: unknown, fallback: ErrorCode): AppError {
  return error instanceof AppError ? error : new AppError(fallback)
}
