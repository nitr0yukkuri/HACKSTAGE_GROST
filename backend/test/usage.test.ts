import type { DynamoDBClient, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';

import type { LogRecord, Logger } from '../src/lib/log.js';
import {
  createUsageCounter,
  formatJstDate,
  perNetworkDailyLimit,
  sourceNetworkGroup,
  USAGE_CONSUME_TIMEOUT_MS,
} from '../src/lib/usage.js';

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

interface UpdateOperation {
  TableName?: string;
  Key?: { pk?: { S?: string } };
  UpdateExpression?: string;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, { N?: string }>;
}

function fakeClient(
  handler?: (
    command: TransactWriteItemsCommand,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>,
) {
  const commands: TransactWriteItemsCommand[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  return {
    commands,
    signals,
    client: {
      send: async (command: TransactWriteItemsCommand, options?: { abortSignal?: AbortSignal }) => {
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

function updatesOf(command: TransactWriteItemsCommand | undefined): UpdateOperation[] {
  return (command?.input.TransactItems ?? []).map((item) => item.Update as UpdateOperation);
}

function networkKeyOf(command: TransactWriteItemsCommand | undefined): string {
  return updatesOf(command)[1]?.Key?.pk?.S ?? '';
}

function transactionCanceled(reasons?: unknown): Error {
  const error = new Error('transaction canceled');
  error.name = 'TransactionCanceledException';
  if (reasons !== undefined) {
    (error as { CancellationReasons?: unknown }).CancellationReasons = reasons;
  }
  return error;
}

describe('formatJstDate', () => {
  it('UTC 15:00 を境に Asia/Tokyo の日付が切り替わる', () => {
    expect(formatJstDate(Date.UTC(2026, 10, 19, 14, 59, 59))).toBe('2026-11-19');
    expect(formatJstDate(Date.UTC(2026, 10, 19, 15, 0, 0))).toBe('2026-11-20');
  });
});

describe('sourceNetworkGroup', () => {
  it('IPv4 をそのまま使い、同じアドレスを同じグループにする', () => {
    expect(sourceNetworkGroup('192.0.2.10')).toBe('v4:192.0.2.10');
    expect(sourceNetworkGroup(' 192.0.2.10 ')).toBe('v4:192.0.2.10');
    expect(sourceNetworkGroup('198.51.100.10')).toBe('v4:198.51.100.10');
  });

  it('IPv6 は /64 に丸め、表記の違いを吸収する', () => {
    expect(sourceNetworkGroup('2001:0db8:0001:0002:abcd::1')).toBe('v6:2001:db8:1:2/64');
    expect(sourceNetworkGroup('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('v6:2001:db8:1:2/64');
    expect(sourceNetworkGroup('2001:db8:1:3::1')).toBe('v6:2001:db8:1:3/64');
  });

  it('IPv4-mapped IPv6 は IPv4 として扱う', () => {
    expect(sourceNetworkGroup('::ffff:192.0.2.10')).toBe('v4:192.0.2.10');
    expect(sourceNetworkGroup('0:0:0:0:0:ffff:192.0.2.10')).toBe('v4:192.0.2.10');
  });

  it('欠落・不正な値は null', () => {
    expect(sourceNetworkGroup(undefined)).toBeNull();
    expect(sourceNetworkGroup('')).toBeNull();
    expect(sourceNetworkGroup('not-an-ip')).toBeNull();
    expect(sourceNetworkGroup('999.1.1.1')).toBeNull();
    expect(sourceNetworkGroup('192.0.2')).toBeNull();
    expect(sourceNetworkGroup('2001:db8::1::2')).toBeNull();
    expect(sourceNetworkGroup('2001:db8::1%eth0')).toBeNull();
  });
});

describe('perNetworkDailyLimit', () => {
  it('全体上限の 1/6 を切り捨て、最低 1 回にする', () => {
    expect(perNetworkDailyLimit(3000)).toBe(500);
    expect(perNetworkDailyLimit(900)).toBe(150);
    expect(perNetworkDailyLimit(12)).toBe(2);
    expect(perNetworkDailyLimit(6)).toBe(1);
    expect(perNetworkDailyLimit(5)).toBe(1);
    expect(perNetworkDailyLimit(1)).toBe(1);
  });
});

describe('createUsageCounter', () => {
  it('全体カウンタとネットワーク別カウンタを1つのトランザクションで条件付き加算する', async () => {
    const nowMs = Date.UTC(2026, 10, 19, 15, 0, 0); // JST 2026-11-20 00:00
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { now: () => nowMs });

    await expect(
      counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-1', '192.0.2.10'),
    ).resolves.toBe('ok');

    expect(commands).toHaveLength(1);
    const updates = updatesOf(commands[0]);
    expect(updates).toHaveLength(2);

    // 既存の全体キーと TTL は変えない（ロールアウト前の消費を引き継ぐ）。
    expect(updates[0]).toMatchObject({
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

    // ネットワーク別キーは JST 日付 + SHA256 の仮名。生 IP を含めない。
    const networkKey = updates[1]?.Key?.pk?.S ?? '';
    expect(networkKey).toMatch(/^bedrock#2026-11-20#net#[0-9a-f]{64}$/);
    expect(networkKey).not.toContain('192.0.2.10');
    expect(updates[1]).toMatchObject({
      TableName: 'hoshirube-dev-usage',
      UpdateExpression: 'ADD #count :one SET #expiresAt = :exp',
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
      ExpressionAttributeNames: { '#count': 'count', '#expiresAt': 'expiresAt' },
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':exp': { N: String(Math.floor((nowMs + 2 * 24 * 60 * 60 * 1000) / 1000)) },
        ':limit': { N: '500' },
      },
    });
  });

  it('kind ごとの全体キー・上限とネットワーク上限を使う', async () => {
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { now: () => Date.UTC(2026, 10, 19, 0, 0, 0) });

    await counter.consume('google_books', AbortSignal.timeout(1_000), 'req-2', '198.51.100.4');

    const updates = updatesOf(commands[0]);
    expect(updates[0]?.Key).toEqual({ pk: { S: 'google_books#2026-11-19' } });
    expect(updates[0]?.ExpressionAttributeValues).toMatchObject({ ':limit': { N: '900' } });
    expect(updates[1]?.Key?.pk?.S).toMatch(/^google_books#2026-11-19#net#[0-9a-f]{64}$/);
    expect(updates[1]?.ExpressionAttributeValues).toMatchObject({ ':limit': { N: '150' } });
  });

  it('同じ日・同じ IPv4 は同じネットワークキー、別 IP は別キーになる', async () => {
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { now: () => Date.UTC(2026, 10, 19, 0, 0, 0) });

    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-a', '192.0.2.10');
    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-b', '192.0.2.10');
    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-c', '192.0.2.11');

    expect(networkKeyOf(commands[0])).toBe(networkKeyOf(commands[1]));
    expect(networkKeyOf(commands[0])).not.toBe(networkKeyOf(commands[2]));
  });

  it('同じ IPv6 /64 は同じネットワークキー、別 /64 は別キーになる', async () => {
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { now: () => Date.UTC(2026, 10, 19, 0, 0, 0) });

    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-a', '2001:db8:1:2::1');
    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-b', '2001:db8:1:2:ffff::9');
    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-c', '2001:db8:1:3::1');

    expect(networkKeyOf(commands[0])).toBe(networkKeyOf(commands[1]));
    expect(networkKeyOf(commands[0])).not.toBe(networkKeyOf(commands[2]));
  });

  it('JST の日付が変わるとネットワークキーも変わる', async () => {
    let nowMs = Date.UTC(2026, 10, 19, 14, 59, 59); // JST 2026-11-19
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { now: () => nowMs });

    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-a', '192.0.2.10');
    nowMs = Date.UTC(2026, 10, 19, 15, 0, 0); // JST 2026-11-20
    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-b', '192.0.2.10');

    expect(updatesOf(commands[0])[0]?.Key).toEqual({ pk: { S: 'bedrock#2026-11-19' } });
    expect(updatesOf(commands[1])[0]?.Key).toEqual({ pk: { S: 'bedrock#2026-11-20' } });
    expect(networkKeyOf(commands[0])).not.toBe(networkKeyOf(commands[1]));
  });

  it('IP が欠落・不正なら書き込まず unavailable を返す', async () => {
    for (const sourceIp of [undefined, '', 'not-an-ip', '999.1.1.1']) {
      const { logger, records } = recordingLogger();
      const { client, commands } = fakeClient();
      const counter = makeCounter(client, { logger });

      await expect(
        counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-ip', sourceIp),
      ).resolves.toBe('unavailable');
      expect(commands).toHaveLength(0);
      expect(records[0]).toMatchObject({
        event: 'usage_counter_unavailable',
        kind: 'bedrock',
        requestId: 'req-ip',
      });
      expect(JSON.stringify(records)).not.toContain('not-an-ip');
    }
  });

  it('CancellationReasons に ConditionalCheckFailed があれば exceeded', async () => {
    const { logger, records } = recordingLogger();
    const { client } = fakeClient(async () => {
      throw transactionCanceled([{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]);
    });
    const counter = makeCounter(client, { logger });

    await expect(
      counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-3', '192.0.2.10'),
    ).resolves.toBe('exceeded');
    expect(records).toEqual([
      { event: 'usage_limit_exceeded', kind: 'bedrock', requestId: 'req-3' },
    ]);
  });

  it('トランザクションの競合・理由なし・その他の理由は unavailable', async () => {
    const cases: unknown[] = [
      undefined,
      [],
      [{ Code: 'None' }, { Code: 'None' }],
      [{ Code: 'TransactionConflict' }],
      [{ Code: 'ThrottlingError' }],
    ];
    for (const reasons of cases) {
      const { logger, records } = recordingLogger();
      const { client } = fakeClient(async () => {
        throw transactionCanceled(reasons);
      });
      const counter = makeCounter(client, { logger });

      await expect(
        counter.consume('google_books', AbortSignal.timeout(1_000), 'req-4', '203.0.113.5'),
      ).resolves.toBe('unavailable');
      expect(records[0]).toMatchObject({
        event: 'usage_counter_unavailable',
        kind: 'google_books',
        requestId: 'req-4',
        errorName: 'TransactionCanceledException',
      });
    }
  });

  it('その他の例外は unavailable（fail-closed）にして kind と errorName だけログに出す', async () => {
    const { logger, records } = recordingLogger();
    const { client } = fakeClient(async () => {
      const error = new Error('table not found: hoshirube-dev-usage');
      error.name = 'ResourceNotFoundException';
      throw error;
    });
    const counter = makeCounter(client, { logger });

    await expect(
      counter.consume('google_books', AbortSignal.timeout(1_000), 'req-5', '203.0.113.5'),
    ).resolves.toBe('unavailable');
    expect(records).toEqual([
      {
        event: 'usage_counter_unavailable',
        kind: 'google_books',
        requestId: 'req-5',
        errorName: 'ResourceNotFoundException',
      },
    ]);
    // 例外メッセージ（テーブル名を含み得る）は記録しない。
    expect(JSON.stringify(records)).not.toContain('hoshirube-dev-usage');
  });

  it('生 IP も仮名ハッシュもログに出さない', async () => {
    const { logger, records } = recordingLogger();
    const { client, commands } = fakeClient(async () => {
      const error = new Error('unavailable');
      error.name = 'InternalServerError';
      throw error;
    });
    const counter = makeCounter(client, { logger });

    await counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-6', '203.0.113.77');

    const key = networkKeyOf(commands[0]);
    const hash = key.slice(key.lastIndexOf('#') + 1);
    expect(hash).toHaveLength(64);
    expect(JSON.stringify(records)).not.toContain('203.0.113.77');
    expect(JSON.stringify(records)).not.toContain(hash);
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

    const pending = counter.consume('bedrock', controller.signal, 'req-abort', '192.0.2.10');
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

  it('テーブル名が未設定なら IP が無くても ok で DynamoDB を呼ばない', async () => {
    const { client, commands } = fakeClient();
    const counter = makeCounter(client, { tableName: null });

    await expect(
      counter.consume('bedrock', AbortSignal.timeout(1_000), 'req-1', undefined),
    ).resolves.toBe('ok');
    expect(commands).toHaveLength(0);
  });

  it('1回のカウンタ呼び出しに許す上限は 500ms', () => {
    expect(USAGE_CONSUME_TIMEOUT_MS).toBe(500);
  });
});
