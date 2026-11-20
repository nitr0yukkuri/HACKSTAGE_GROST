import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { AppError } from './errors.js';

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const MAX_SEED_BODY_BYTES = 8 * 1024;
export const MAX_CONTEXT_BYTES = 4 * 1024;

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function jsonResponse(
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): ApiResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': JSON_CONTENT_TYPE,
      // 推薦結果・エラー応答・404 を含む全応答を共有キャッシュに保存させない。
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

/** ヘッダー名の大文字小文字を区別せずに値を取り出す。 */
export function getHeader(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const headers = event.headers ?? {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === 'string') return value;
  }
  return undefined;
}

export function getQueryParameter(
  event: APIGatewayProxyEventV2,
  name: string,
): { present: boolean; value: string | undefined } {
  const params = event.queryStringParameters ?? {};
  if (Object.prototype.hasOwnProperty.call(params, name)) {
    return { present: true, value: params[name] };
  }
  return { present: false, value: undefined };
}

export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const [mediaType] = value.split(';');
  return mediaType.trim().toLowerCase() === 'application/json';
}

export interface DecodedBody {
  text: string;
  byteLength: number;
}

export function decodeBody(event: APIGatewayProxyEventV2): DecodedBody {
  const raw = event.body ?? '';
  if (event.isBase64Encoded) {
    const buffer = Buffer.from(raw, 'base64');
    return { text: buffer.toString('utf8'), byteLength: buffer.length };
  }
  return { text: raw, byteLength: Buffer.byteLength(raw, 'utf8') };
}

/**
 * seed 本文を検証順（Content-Type → バイト数 → JSON 構文）に読み取る。
 * JSON として解釈できる入力の不正は、このあとの検証で 422 にする。
 */
export function readSeedBody(event: APIGatewayProxyEventV2): unknown {
  if (!isJsonContentType(getHeader(event, 'content-type'))) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE');
  }

  const { text, byteLength } = decodeBody(event);
  if (byteLength > MAX_SEED_BODY_BYTES) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(400, 'INVALID_JSON');
  }
}

export function codePointLength(value: string): number {
  return [...value].length;
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
