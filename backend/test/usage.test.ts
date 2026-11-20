import type { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';

import type { LogRecord, Logger } from '../src/lib/log.js';
import { createUsageCounter, formatJstDate, USAGE_CONSUME_TIMEOUT_MS } from '../src/lib/usage.js';

function recordingLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    logger: {
      debug: (record) => records.push(record),
      info: (record) => records.push(record),
      warn: (record) => records.push(record),
    },
  };
}

function fakeClient(
  handler?: (
    command: UpdateItemCommand,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>,
) {
  const commands: UpdateItemCommand[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  return {
    commands,
    signals,
    client: {
      send: async (command: UpdateItemCommand, options?: { abortSignal?: AbortSignal }) => {
        commands.push(command);
        signals.push(options?.abortSignal);
        return handler ? handler(command, options) : {};
      },
    } as unknown as Pick<DynamoDBClient, 'send'>,
  };
}

function makeCounter(
  client: Pick<DynamoDBClient, 'send'>,
  options: {
    now?: () => number;
    tableName?: string | null;
    logger?: Logger;
    limits?: { bedrock: number; google_books: number };
  } = {},
) {
  return createUsageCounter({
    tableName: options.tableName === undefined ? 'hoshirube-dev-usage' : options.tableName,
    limits: options.limits ?? { bedrock: 3000, google_books: 900 },
    logger: options.logger ?? recordingLogger().logger,
    region: 'ap-northeast-1',
    now: options.now ?? (() => 0),
    client,
  });
}

describe('formatJstDate', () => {
  it('UTC 15:00 を境に Asia/Tokyo の日付が切り替わる', () => {
    expect(formatJstDate(Date.UTC(2026, 10, 19, 14, 59, 59))).toBe('2026-11-19');
    expect(formatJstDate(Date.UTC(2026, 10, 19, 15, 0, 0))).toBe('2026-11-20');
  });
});

describe('createUsageCounter', () => {
  it('条件付き加算の入力（キー・JST日付・条件式・TTL）を組み立てる', async () => {
    const nowMs = Date.UTC(2026, 10, 19, 15, 0, 0); // JST 2026-11-20 00:00
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { now: () => nowMs });

    await expect(counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-1')).resolves.toBe('ok');

    expect(commands).toHaveLength(1);
    const input = commands[0]?.input;
    expect(input).toMatchObject({
      TableName: 'hoshirube-dev-usage',
      Key: { pk: { S: 'bedrock#2026-11-20' } },
      UpdateExpression: 'ADD #count :one SET #expiresAt = :exp',
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
      ExpressionAttributeNames: { '#count': 'count', '#expiresAt': 'expiresAt' },
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':exp': { N: String(Math.floor((nowMs + 2 * 24 * 60 * 60 * 1000) / 1000)) },
        ':limit': { N: '3000' },
      },
    });
  });

  it('kind ごとのキーと上限を使う', async () => {
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { now: () => Date.UTC(2026, 10, 19, 0, 0, 0) });

    await counter.consume('google_books', AbortSignal.timeout(1_000), 'req-2');

    const input = commands[0]?.input;
    expect(input?.Key).toEqual({ pk: { S: 'google_books#2026-11-19' } });
    expect(input?.ExpressionAttributeValues).toMatchObject({ ':limit': { N: '900' } });
  });

  it('ConditionalCheckFailedException は exceeded にして kind だけログに出す', async () => {
    const { logger, records } = recordingLogger();
    const { client } = fakeClient(async () => {
      const error = new Error('conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      throw error;
    });
    const counter = makeCounter(client, { logger });

    await expect(counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-3')).resolves.toBe(
      'exceeded',
    );
    expect(records).toEqual([
      { event: 'usage_limit_exceeded', kind: 'bedrock', requestId: 'req-3' },
    ]);
  });

  it('その他の例外は unavailable（fail-open）にして kind と errorName だけログに出す', async () => {
    const { logger, records } = recordingLogger();
    const { client } = fakeClient(async () => {
      const error = new Error('table not found: hoshirube-dev-usage');
      error.name = 'ResourceNotFoundException';
      throw error;
    });
    const counter = makeCounter(client, { logger });

    await expect(
      counter.consume('google_books', AbortSignal.timeout(1_000), 'req-4'),
    ).resolves.toBe('unavailable');
    expect(records).toEqual([
      {
        event: 'usage_counter_unavailable',
        kind: 'google_books',
        requestId: 'req-4',
        errorName: 'ResourceNotFoundException',
      },
    ]);
    // 例外メッセージ（テーブル名を含み得る）は記録しない。
    expect(JSON.stringify(records)).not.toContain('hoshirube-dev-usage');
  });

  it('AbortSignal を SDK に渡し、打ち切りで unavailable になる', async () => {
    const { logger, records } = recordingLogger();
    const { client, signals } = fakeClient(
      (_command, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.abortSignal;
          const fail = (): void => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal?.aborted) fail();
          else signal?.addEventListener('abort', fail, { once: true });
        }),
    );
    const counter = makeCounter(client, { logger });
    const controller = new AbortController();

    const pending = counter.consume('bedrock', controller.signal, 'req-abort');
    controller.abort();
    await expect(pending).resolves.toBe('unavailable');

    // 呼び出し側の signal をそのまま SDK へ渡している。
    expect(signals[0]).toBe(controller.signal);
    expect(records[0]).toMatchObject({
      event: 'usage_counter_unavailable',
      kind: 'bedrock',
      requestId: 'req-abort',
      errorName: 'AbortError',
    });
  });

  it('テーブル名が未設定なら常に ok で DynamoDB を呼ばない', async () => {
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { tableName: null });

    await expect(counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-1')).resolves.toBe('ok');
    expect(commands).toHaveLength(0);
  });

  it('1回のカウンタ呼び出しに許す上限は 500ms', () => {
    expect(USAGE_CONSUME_TIMEOUT_MS).toBe(500);
  });
});
