import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

import type { Logger } from './log.js';

/**
 * 外部呼び出し（Bedrock / Google Books）の日次上限を DynamoDB のアトミックカウンタで強制する。
 *
 * - 1日の境界は Asia/Tokyo（UTC+9、夏時間なし）。
 * - 1回の消費は UpdateItem の条件付き加算1回。上限に達していれば
 *   `ConditionalCheckFailedException` になり `exceeded` を返す。
 * - カウンタ側の障害・打ち切りは `unavailable`（fail-open）。外部呼び出しは止めない。
 * - テーブル名が未設定なら常に `ok`（ローカル開発とテスト用）。
 */

export type UsageKind = 'bedrock' | 'google_books';

export type UsageResult = 'ok' | 'exceeded' | 'unavailable';

export interface UsageCounter {
  /** 1回分を消費する。`requestId` はログとの突き合わせにだけ使う。 */
  consume(kind: UsageKind, signal: AbortSignal, requestId: string): Promise<UsageResult>;
}

/** 上限なし（テーブル未設定時）。 */
export const PASS_THROUGH_USAGE_COUNTER: UsageCounter = {
  async consume() {
    return 'ok';
  },
};

/** カウンタ呼び出しに許す上限。段階の AbortSignal と短い方を使う。 */
export const USAGE_CONSUME_TIMEOUT_MS = 500;

/** カウンタ項目の保持時間。日付キーが切り替わった後も少し残す。 */
const USAGE_ITEM_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface UsageLimits {
  bedrock: number;
  google_books: number;
}

export interface UsageCounterOptions {
  tableName: string | null;
  limits: UsageLimits;
  logger: Logger;
  region: string;
  now?: () => number;
  /** テスト用。省略時は AWS_REGION の DynamoDBClient を生成する。 */
  client?: Pick<DynamoDBClient, 'send'>;
}

export function createUsageCounter(options: UsageCounterOptions): UsageCounter {
  if (options.tableName === null) return PASS_THROUGH_USAGE_COUNTER;

  const tableName = options.tableName;
  const now = options.now ?? Date.now;
  let client = options.client;
  const getClient = (): Pick<DynamoDBClient, 'send'> => {
    client ??= new DynamoDBClient({
      region: options.region,
      // 上限内で必ず終わらせる。SDK の自動再試行はしない。
      maxAttempts: 1,
    });
    return client;
  };

  return {
    async consume(
      kind: UsageKind,
      signal: AbortSignal,
      requestId: string,
    ): Promise<UsageResult> {
      const at = now();
      const command = buildCommand(tableName, kind, at, options.limits[kind]);
      try {
        await getClient().send(command, { abortSignal: signal });
        return 'ok';
      } catch (error) {
        if (errorNameOf(error) === 'ConditionalCheckFailedException') {
          options.logger.warn({ event: 'usage_limit_exceeded', kind, requestId });
          return 'exceeded';
        }
        // 例外の内容は出さない（テーブル名・値・ARN を含み得るため）。種別だけ残す。
        options.logger.warn({
          event: 'usage_counter_unavailable',
          kind,
          requestId,
          errorName: errorNameOf(error),
        });
        return 'unavailable';
      }
    },
  };
}

function buildCommand(
  tableName: string,
  kind: UsageKind,
  nowMs: number,
  limit: number,
): UpdateItemCommand {
  const expiresAtSeconds = Math.floor((nowMs + USAGE_ITEM_TTL_MS) / 1000);
  return new UpdateItemCommand({
    TableName: tableName,
    Key: { pk: { S: `${kind}#${formatJstDate(nowMs)}` } },
    UpdateExpression: 'ADD #count :one SET #expiresAt = :exp',
    ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
    ExpressionAttributeNames: {
      '#count': 'count',
      '#expiresAt': 'expiresAt',
    },
    ExpressionAttributeValues: {
      ':one': { N: '1' },
      ':exp': { N: String(expiresAtSeconds) },
      ':limit': { N: String(limit) },
    },
  });
}

/** Asia/Tokyo の YYYY-MM-DD。日本標準時は夏時間がないため固定 +9 時間で求める。 */
export function formatJstDate(nowMs: number): string {
  const jst = new Date(nowMs + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function errorNameOf(error: unknown): string {
  if (error instanceof Error) return error.name;
  return 'UnknownError';
}
