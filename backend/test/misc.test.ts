import { describe, expect, it } from 'vitest';

import { parseModelJson } from '../src/lib/json.js';
import { createHandler } from '../src/handler.js';
import { loadConfig } from '../src/lib/config.js';
import { createLogger, type LogRecord, type Logger } from '../src/lib/log.js';
import {
  bedrockStub,
  booksEvent,
  googleBooksStub,
  healthEvent,
  makeEvent,
  parseJson,
  seedEvent,
  V1_NORMAL,
} from './helpers.js';

describe('GET /health', () => {
  it('200 で status ok と requestId を返す', async () => {
    const harness = createHarnessForLog();
    const response = await harness.handler(healthEvent('health-1'));

    expect(response.statusCode).toBe(200);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(parseJson(response.body)).toEqual({ status: 'ok', requestId: 'health-1' });
  });
});

describe('ルーティング', () => {
  it('未定義のパスは 404 NOT_FOUND', async () => {
    const { handler } = createHarnessForLog();
    const response = await handler(makeEvent({ method: 'GET', path: '/v1/unknown' }));
    expect(response.statusCode).toBe(404);
    expect(parseJson<{ error: { code: string; details: unknown[] } }>(response.body)).toMatchObject({
      error: { code: 'NOT_FOUND', details: [] },
    });
  });

  it('エラー応答（404・415）にも Cache-Control: no-store を付ける', async () => {
    const { handler } = createHarnessForLog();
    const notFound = await handler(makeEvent({ method: 'GET', path: '/v1/unknown' }));
    expect(notFound.headers['Cache-Control']).toBe('no-store');

    const unsupported = await handler(
      makeEvent({
        method: 'POST',
        path: '/v1/discovery/seed',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      }),
    );
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.headers['Cache-Control']).toBe('no-store');
  });

  it('既知のパスでもメソッドが違えば 404', async () => {
    const { handler } = createHarnessForLog();
    const response = await handler(makeEvent({ method: 'GET', path: '/v1/discovery/seed' }));
    expect(response.statusCode).toBe(404);
  });

  it('旧パス POST /v1/books/recommendations は存在しない', async () => {
    const { handler } = createHarnessForLog();
    const response = await handler(
      makeEvent({ method: 'POST', path: '/v1/books/recommendations', body: '{}' }),
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('構造化ログ', () => {
  it('requestId・route・status・durationMs・件数・upstream を記録し、回答内容を出さない', async () => {
    const records: LogRecord[] = [];
    const logger: Logger = {
      debug: (record) => records.push(record),
      info: (record) => records.push(record),
      warn: (record) => records.push(record),
    };
    const handler = createHandler({
      config: { ...loadConfig({}), bedrockModelId: 'test-model' },
      bedrock: bedrockStub(() =>
        JSON.stringify({
          themes: [
            { themeId: 'tec', searchQuery: 'プログラミング 入門' },
            { themeId: 'mon', searchQuery: 'デザイン 入門' },
            { themeId: 'phi', searchQuery: '哲学 入門' },
          ],
        }),
      ),
      googleBooks: googleBooksStub(() => []),
      logger,
    });

    const response = await handler(seedEvent(V1_NORMAL, { requestId: 'log-1' }));
    expect(response.statusCode).toBe(200);

    const request = records.find((record) => record.event === 'request');
    expect(request).toBeDefined();
    expect(request).toMatchObject({
      requestId: 'log-1',
      route: 'POST /v1/discovery/seed',
      status: 200,
      resultCount: 3,
    });
    expect(typeof request?.durationMs).toBe('number');
    expect(request?.upstreams).toEqual([
      { name: 'bedrock', durationMs: expect.any(Number), outcome: 'ok' },
    ]);

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain('何かをつくる');
    expect(serialized).not.toContain('テクノロジー');
    expect(serialized).not.toContain('プログラミング 入門');
  });

  it('エラー時は errorCode を記録する', async () => {
    const records: LogRecord[] = [];
    const logger: Logger = {
      debug: (record) => records.push(record),
      info: (record) => records.push(record),
      warn: (record) => records.push(record),
    };
    const handler = createHandler({
      config: { ...loadConfig({}), bedrockModelId: 'test-model' },
      bedrock: bedrockStub(() => 'not json'),
      googleBooks: googleBooksStub(() => []),
      logger,
    });

    await handler(seedEvent(V1_NORMAL, { requestId: 'log-2' }));
    const request = records.find((record) => record.event === 'request');
    expect(request).toMatchObject({
      requestId: 'log-2',
      status: 502,
      errorCode: 'DISCOVERY_UPSTREAM_ERROR',
    });
  });

  it('books のログに q と回答ヘッダーを出さない', async () => {
    const records: LogRecord[] = [];
    const logger: Logger = {
      debug: (record) => records.push(record),
      info: (record) => records.push(record),
      warn: (record) => records.push(record),
    };
    const handler = createHandler({
      config: { ...loadConfig({}), bedrockModelId: 'test-model' },
      bedrock: bedrockStub(() => JSON.stringify({ reasons: [] })),
      googleBooks: googleBooksStub(() => []),
      logger,
    });

    const response = await handler(booksEvent({ requestId: 'log-3' }));
    expect(response.statusCode).toBe(200);
    const serialized = JSON.stringify(records);
    expect(serialized).toContain('GET /v1/themes/{themeId}/books');
    expect(serialized).not.toContain('プログラミング 入門');
    expect(serialized).not.toContain('new_perspective');
  });

  it('メソッドが違う場合は実際のメソッドを route に記録する', async () => {
    const records: LogRecord[] = [];
    const logger: Logger = {
      debug: (record) => records.push(record),
      info: (record) => records.push(record),
      warn: (record) => records.push(record),
    };
    const handler = createHandler({
      config: { ...loadConfig({}), bedrockModelId: 'test-model' },
      bedrock: bedrockStub(() => JSON.stringify({ themes: [] })),
      googleBooks: googleBooksStub(() => []),
      logger,
    });

    const response = await handler(makeEvent({ method: 'DELETE', path: '/health' }));
    expect(response.statusCode).toBe(404);
    const request = records.find((record) => record.event === 'request');
    expect(request).toMatchObject({ route: 'DELETE /unknown', status: 404 });
  });
});

describe('parseModelJson の外側 } 欠落の復旧', () => {
  const seedThemes = [
    { themeId: 'tec', searchQuery: '哲学 入門' },
    { themeId: 'mon', searchQuery: 'デザイン 発想' },
    { themeId: 'phi', searchQuery: '社会 人間' },
  ];
  const missingOuterBrace = `{"themes":${JSON.stringify(seedThemes)}`;

  it('コードフェンスありで復旧する', () => {
    const text = `\`\`\`json\n${missingOuterBrace}\n\`\`\``;
    expect(parseModelJson(text)).toEqual({ themes: seedThemes });
  });

  it('コードフェンスなしで復旧する', () => {
    expect(parseModelJson(missingOuterBrace)).toEqual({ themes: seedThemes });
  });

  it('配列の ] も欠落している場合は復旧しない', () => {
    expect(() => parseModelJson('{"themes":[{"themeId":"tec","searchQuery":"哲学"')).toThrow(
      'model output is not JSON',
    );
  });

  it('} が2つ欠落している場合は復旧しない', () => {
    expect(() => parseModelJson('{"a":{"themes":[1,2]')).toThrow('model output is not JSON');
  });

  it('途中で切れた文字列は復旧しない', () => {
    expect(() => parseModelJson('{"themes":[{"searchQuery":"途中')).toThrow(
      'model output is not JSON',
    );
  });
});

describe('ログレベル', () => {
  function capture(level: 'debug' | 'info'): LogRecord[] {
    const lines: string[] = [];
    const logger = createLogger(level, (line) => lines.push(line));
    logger.debug({ event: 'd' });
    logger.info({ event: 'i' });
    logger.warn({ event: 'w' });
    return lines.map((line) => JSON.parse(line) as LogRecord);
  }

  it('warn は level が warn で出力される', () => {
    const records = capture('info');
    expect(records.map((record) => record.level)).toEqual(['info', 'warn']);
    expect(records[1]).toMatchObject({ event: 'w' });
  });

  it('debug レベルでは debug も出力する', () => {
    const records = capture('debug');
    expect(records.map((record) => record.level)).toEqual(['debug', 'info', 'warn']);
  });
});

function createHarnessForLog(): {
  handler: ReturnType<typeof createHandler>;
} {
  return {
    handler: createHandler({
      config: { ...loadConfig({}), bedrockModelId: 'test-model' },
      bedrock: bedrockStub(() => JSON.stringify({ themes: [] })),
      googleBooks: googleBooksStub(() => []),
      logger: { debug: () => {}, info: () => {}, warn: () => {} },
    }),
  };
}

describe('parseModelJson の配列要素間の余分な " の補完', () => {
  const observed =
    '{"themes":[{"themeId":"sci","searchQuery":"宇宙 謎"}," {"themeId":"art","searchQuery":"音楽 情動"}," {"themeId":"phi","searchQuery":"思考 知識"}]}';

  it('Nova の実出力（要素間に余分な "）を3件として読める', () => {
    expect(parseModelJson(observed)).toEqual({
      themes: [
        { themeId: 'sci', searchQuery: '宇宙 謎' },
        { themeId: 'art', searchQuery: '音楽 情動' },
        { themeId: 'phi', searchQuery: '思考 知識' },
      ],
    });
  });

  it('コードフェンス付きで外側の } も欠けた複合形を読める', () => {
    const text = '```json\n' + observed.slice(0, -1) + '\n```';
    expect(parseModelJson(text)).toEqual({
      themes: [
        { themeId: 'sci', searchQuery: '宇宙 謎' },
        { themeId: 'art', searchQuery: '音楽 情動' },
        { themeId: 'phi', searchQuery: '思考 知識' },
      ],
    });
  });

  it('文字列の中に }," { を含む正しい JSON は値を変えない', () => {
    // プロパティ名に `}," {` を含む。既存の候補で読めるため置換は適用されない。
    const valid = '{"a":{"b":1}," {":2}';
    expect(parseModelJson(valid)).toEqual({ a: { b: 1 }, ' {': 2 });
  });

  it('配列の外に正当なプロパティがあっても、配列内の余分な " を直す', () => {
    const text =
      '{"kind":"books#volumes","themes":[{"themeId":"sci","searchQuery":"宇宙 謎"}," {"themeId":"art","searchQuery":"音楽 情動"}]}';
    expect(parseModelJson(text)).toEqual({
      kind: 'books#volumes',
      themes: [
        { themeId: 'sci', searchQuery: '宇宙 謎' },
        { themeId: 'art', searchQuery: '音楽 情動' },
      ],
    });
  });

  it('配列の外にある }," { の形は置換しない', () => {
    // 配列の外（プロパティ名）にも `}," {` がある。全文置換だとここまで壊れて
    // 読めなくなるが、配列内だけを対象にするため読める。
    const text =
      '{"obj":{"x":1}," {":2,"themes":[{"themeId":"sci","searchQuery":"宇宙 謎"}," {"themeId":"art","searchQuery":"音楽 情動"}]}';
    expect(parseModelJson(text)).toEqual({
      obj: { x: 1 },
      ' {': 2,
      themes: [
        { themeId: 'sci', searchQuery: '宇宙 謎' },
        { themeId: 'art', searchQuery: '音楽 情動' },
      ],
    });
  });

  it('余分な " が { の前でなければ復旧しない', () => {
    expect(() => parseModelJson('{"themes":[{"a":1},"x":1]}')).toThrow(
      'model output is not JSON',
    );
  });
});
