/**
 * ローカル開発用 HTTP サーバー。
 *
 * API Gateway HTTP API（payload format 2.0）と同じ形のイベントに変換し、
 * backend/src/handler.ts の handleEvent をそのまま呼ぶ。
 * CORS は API Gateway 側の責務だが、ローカルでは ALLOWED_ORIGINS に一致する
 * Origin にだけヘッダーを付ける（それ以外はヘッダーを付けない）。
 *
 * 実行には AWS 認証情報（AWS_PROFILE など）と BEDROCK_MODEL_ID が必要。
 * Bedrock と Google Books は実リソースへ通信する。
 */

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { createDefaultDeps, handleEvent } from './handler.js';

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const deps = createDefaultDeps();

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const corsHeaders: Record<string, string> = {};
  if (typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
    corsHeaders['Vary'] = 'Origin';
    corsHeaders['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type,X-Discovery-Context';
    corsHeaders['Access-Control-Max-Age'] = '600';
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  const body = await readBody(request);
  // API Gateway と同じく、同名のクエリパラメータは受信順にカンマで連結する。
  const queryStringParameters: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    const previous = queryStringParameters[key];
    queryStringParameters[key] = previous === undefined ? value : `${previous},${value}`;
  }

  const event: APIGatewayProxyEventV2 = {
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.startsWith('?') ? url.search.slice(1) : url.search,
    headers: headerRecord(request),
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: '127.0.0.1',
      domainPrefix: 'local',
      http: {
        method: request.method ?? 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: request.headers['user-agent'] ?? '',
      },
      requestId: randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: body === '' ? undefined : body,
    isBase64Encoded: false,
    queryStringParameters,
  };

  try {
    const result = await handleEvent(event, deps);
    response.writeHead(result.statusCode, { ...corsHeaders, ...result.headers });
    response.end(result.body);
  } catch {
    // handleEvent は通常ここまで例外を投げない。念のため内部エラー形式で返す。
    response.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      JSON.stringify({
        requestId: event.requestContext.requestId,
        error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。', details: [] },
      }),
    );
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`hoshirube backend dev server: http://127.0.0.1:${PORT}`);
});

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function headerRecord(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(',');
  }
  return headers;
}
