import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { DynamoDBClient, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';

import type { Logger } from './log.js';

/**
 * 外部呼び出し（Bedrock / Google Books）の日次上限を DynamoDB のアトミックカウンタで強制する。
 *
 * - 1日の境界は Asia/Tokyo（UTC+9、夏時間なし）。
 * - 1回の消費は TransactWriteItems の条件付き加算2件。全体カウンタ（既存キー
 *   `<kind>#<YYYY-MM-DD>`）と、送信元ネットワーク別カウンタ
 *   `<kind>#<YYYY-MM-DD>#net#<SHA256>` を同じトランザクションで更新する。
 * - ネットワークは IPv4 アドレス、または IPv6 の /64。IPv4-mapped IPv6 は IPv4 として扱う。
 *   日次カウンタのログに生 IP とハッシュ値は出さない。
 * - 全体上限に達していれば `TransactionCanceledException` の CancellationReasons が
 *   `ConditionalCheckFailed` になり `exceeded` を返す。
 * - IP の欠落・不正、カウンタ側の障害・競合・打ち切りは `unavailable`。
 *   設定済みのテーブルでは外部呼び出しを止める（fail-closed）。
 * - テーブル名が未設定なら常に `ok`（ローカル開発とテスト用）。
 *
 * IAM は既存の `dynamodb:UpdateItem`（テーブル ARN）だけで足りる。TransactWriteItems の
 * Update アクションは UpdateItem と同じ権限で許可されるため、新しいアクションは要らない。
 */

export type UsageKind = 'bedrock' | 'google_books';

export type UsageResult = 'ok' | 'exceeded' | 'unavailable';

export interface UsageCounter {
  /**
   * 1回分を消費する。
   * `sourceIp` は `event.requestContext.http.sourceIp` だけを渡す（ヘッダーは使わない）。
   * `requestId` はログとの突き合わせにだけ使う。
   */
  consume(
    kind: UsageKind,
    signal: AbortSignal,
    requestId: string,
    sourceIp: string | undefined,
  ): Promise<UsageResult>;
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

/** ネットワーク別上限は全体上限の 1/6（最低1回）。 */
const PER_NETWORK_DIVISOR = 6;

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
      sourceIp: string | undefined,
    ): Promise<UsageResult> {
      const at = now();
      const networkGroup = sourceNetworkGroup(sourceIp);
      if (networkGroup === null) {
        // 送信元が特定できないときは書き込まずに止める（全体上限をすり抜けさせない）。
        options.logger.warn({
          event: 'usage_counter_unavailable',
          kind,
          requestId,
          reason: 'source_ip_unavailable',
        });
        return 'unavailable';
      }

      const command = buildCommand(
        tableName,
        kind,
        at,
        options.limits[kind],
        networkGroup,
      );
      try {
        await getClient().send(command, { abortSignal: signal });
        return 'ok';
      } catch (error) {
        const errorName = errorNameOf(error);
        if (errorName === 'TransactionCanceledException') {
          if (hasConditionalCheckFailure(error)) {
            options.logger.warn({ event: 'usage_limit_exceeded', kind, requestId });
            return 'exceeded';
          }
          // 競合・理由なしなどは上限到達と区別できないため、外部呼び出しを止める。
          options.logger.warn({
            event: 'usage_counter_unavailable',
            kind,
            requestId,
            errorName,
            reason: 'transaction_canceled',
          });
          return 'unavailable';
        }
        // 例外の内容は出さない（テーブル名・値・ARN を含み得るため）。種別だけ残す。
        options.logger.warn({
          event: 'usage_counter_unavailable',
          kind,
          requestId,
          errorName,
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
  networkGroup: string,
): TransactWriteItemsCommand {
  const date = formatJstDate(nowMs);
  const expiresAtSeconds = Math.floor((nowMs + USAGE_ITEM_TTL_MS) / 1000);
  const networkLimit = perNetworkDailyLimit(limit);

  return new TransactWriteItemsCommand({
    TransactItems: [
      {
        Update: updateInput(
          tableName,
          `${kind}#${date}`,
          limit,
          expiresAtSeconds,
        ),
      },
      {
        Update: updateInput(
          tableName,
          `${kind}#${date}#net#${networkPseudonym(date, networkGroup)}`,
          networkLimit,
          expiresAtSeconds,
        ),
      },
    ],
  });
}

function updateInput(
  tableName: string,
  pk: string,
  limit: number,
  expiresAtSeconds: number,
) {
  return {
    TableName: tableName,
    Key: { pk: { S: pk } },
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
  };
}

/** 全体上限からネットワーク別の日次上限を求める。 */
export function perNetworkDailyLimit(globalLimit: number): number {
  return Math.max(1, Math.floor(globalLimit / PER_NETWORK_DIVISOR));
}

/**
 * 日次カウンタ項目用の SHA256。JST の日付と正規化済みネットワーク
 * （IPv4 または IPv6 /64）の組から作る。同じネットワークでも日付が変われば値も変わる。
 * 匿名化や非リンク化を保証するものではない。
 */
export function networkPseudonym(date: string, networkGroup: string): string {
  return createHash('sha256').update(`${date}\n${networkGroup}`).digest('hex');
}

/**
 * 送信元 IP をカウンタ用のネットワークグループに正規化する。
 * IPv4 はアドレスそのもの、IPv6 は /64、IPv4-mapped IPv6 は IPv4 にする。
 * 欠落・不正なら null。
 */
export function sourceNetworkGroup(sourceIp: string | undefined): string | null {
  if (sourceIp === undefined) return null;
  const value = sourceIp.trim();
  if (value === '') return null;

  const version = isIP(value);
  if (version === 4) return `v4:${value}`;

  // isIP はゾーン ID 付きアドレスも 6 と判定するため、URL 正規化の前に明示的に除く。
  if (version !== 6 || value.includes('%')) return null;
  const canonical = canonicalIpv6(value);
  if (canonical === null) return null;

  const groups = expandIpv6(canonical);
  // IPv4-mapped IPv6（::ffff/96）は IPv4 として数える。
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    return `v4:${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
  }

  // ネットワーク部（先頭 64 ビット）だけを残す。表記は内部キー用の固定形でよい。
  return `v6:${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}/64`;
}

/**
 * WHATWG URL で IPv6 を正規化する（dotted tail も 16 進グループへ揃う）。
 * `isIP` で検証済みの値だけを渡す。
 */
function canonicalIpv6(value: string): string | null {
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
    return hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/** 正規化済み IPv6 を 8 グループへ展開する。 */
function expandIpv6(canonical: string): number[] {
  const [head = '', tail] = canonical.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array<string>(Math.max(0, missing)).fill('0'),
    ...tailGroups,
  ];
  return groups.map((group) => Number.parseInt(group, 16));
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

/**
 * トランザクションの取り消し理由に条件チェック失敗が含まれるか。
 * 理由が無い・配列でない場合は上限到達と判断しない（fail-closed 側に倒す）。
 */
function hasConditionalCheckFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  if (!Array.isArray(reasons)) return false;
  return reasons.some((reason) => {
    if (typeof reason !== 'object' || reason === null) return false;
    return (reason as { Code?: unknown }).Code === 'ConditionalCheckFailed';
  });
}
