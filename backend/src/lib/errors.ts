/**
 * アプリケーションエラーの共通表現。
 * 形式は docs/swagger-ui/openapi.yaml の ErrorResponse / ErrorDetail に従う。
 */

export type ErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_CONTEXT_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'CONTEXT_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNSUPPORTED_QUESTIONNAIRE_VERSION'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'DISCOVERY_UPSTREAM_ERROR'
  | 'DISCOVERY_UNAVAILABLE'
  | 'BOOKS_UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'INTERNAL_ERROR'
  // openapi.yaml に未定義のパス・メソッド用。契約外であることは報告に記載する。
  | 'NOT_FOUND';

export type ErrorDetailCode =
  | 'INVALID_REQUEST_SHAPE'
  | 'ANSWERS_COUNT_OUT_OF_RANGE'
  | 'UNSUPPORTED_QUESTIONNAIRE_VERSION'
  | 'UNKNOWN_THEME_ID'
  | 'UNKNOWN_QUESTION_ID'
  | 'DUPLICATE_QUESTION_ID'
  | 'EMPTY_SELECTION'
  | 'DUPLICATE_OPTION_ID'
  | 'UNKNOWN_OPTION_ID'
  | 'SELECTION_COUNT_OUT_OF_RANGE'
  | 'EXCLUSIVE_OPTION_CONFLICT'
  | 'MISSING_REQUIRED_QUESTION'
  | 'FORBIDDEN_QUESTION';

export interface ErrorDetail {
  field: string;
  code: ErrorDetailCode;
}

/** 画面にそのまま出せる日本語の文言。内部例外や秘密情報を含めない。 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_JSON: 'リクエストの形式を確認してください。',
  INVALID_CONTEXT_JSON: 'リクエストの形式を確認してください。',
  PAYLOAD_TOO_LARGE: '送信できるデータの大きさを超えています。',
  CONTEXT_TOO_LARGE: '送信できる回答データの大きさを超えています。',
  UNSUPPORTED_MEDIA_TYPE: 'JSON形式で送信してください。',
  UNSUPPORTED_QUESTIONNAIRE_VERSION: '対応していない質問票の版です。',
  VALIDATION_ERROR: '回答内容を確認してください。',
  RATE_LIMITED: '時間をおいて再度お試しください。',
  DISCOVERY_UPSTREAM_ERROR: '星の候補を取得できませんでした。',
  DISCOVERY_UNAVAILABLE: '星の候補を取得できませんでした。時間をおいて再度お試しください。',
  BOOKS_UPSTREAM_ERROR: '書籍情報を取得できませんでした。',
  UPSTREAM_TIMEOUT: '時間内に処理を完了できませんでした。',
  INTERNAL_ERROR: '処理に失敗しました。',
  NOT_FOUND: 'リクエストされたAPIは存在しません。',
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: ErrorDetail[];

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string = ERROR_MESSAGES[code],
    details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface ErrorBody {
  requestId: string;
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetail[];
  };
}

export function errorBody(requestId: string, error: AppError): ErrorBody {
  return {
    requestId,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}
