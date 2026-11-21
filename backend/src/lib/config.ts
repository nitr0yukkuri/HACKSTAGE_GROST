import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import type { Logger } from './log.js';

/**
 * Lambda の環境変数から読む実行設定。
 * 秘密情報そのものは持たず、SSM Parameter Store の名前だけを持つ。
 */
export interface AppConfig {
  /** Bedrock runtime のリージョン。既定は東京。 */
  bedrockRegion: string;
  /** Lambda 自身のリージョン。AWS_REGION を優先し、無ければ bedrockRegion。 */
  awsRegion: string;
  /** Converse API の modelId。未確定のため必ず環境変数で切り替える。 */
  bedrockModelId: string;
  /** Google Books API キーを保持する SSM SecureString の名前。未設定ならキーなしで呼ぶ。 */
  googleBooksApiKeyParam: string | null;
  /** 日次利用カウンタの DynamoDB テーブル名。未設定なら上限をかけない（ローカル開発・テスト用）。 */
  usageTableName: string | null;
  /** 1日の Bedrock 呼び出し上限。 */
  dailyBedrockLimit: number;
  /** 1日の Google Books 呼び出し上限。 */
  dailyGoogleBooksLimit: number;
  logLevel: 'debug' | 'info';
}

export const DEFAULT_BEDROCK_REGION = 'ap-northeast-1';
export const DEFAULT_GOOGLE_BOOKS_API_KEY_PARAM = '/hoshirube/google-books-api-key';
export const DEFAULT_DAILY_BEDROCK_LIMIT = 3000;
export const DEFAULT_DAILY_GOOGLE_BOOKS_LIMIT = 900;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const region = env.BEDROCK_REGION?.trim();
  const awsRegion = env.AWS_REGION?.trim();
  const modelId = env.BEDROCK_MODEL_ID?.trim();
  const apiKeyParam = env.GOOGLE_BOOKS_API_KEY_PARAM?.trim();
  const usageTable = env.USAGE_TABLE_NAME?.trim();
  const logLevel = env.LOG_LEVEL?.trim().toLowerCase();
  const resolvedBedrockRegion =
    region && region.length > 0 ? region : DEFAULT_BEDROCK_REGION;

  return {
    bedrockRegion: resolvedBedrockRegion,
    awsRegion: awsRegion && awsRegion.length > 0 ? awsRegion : resolvedBedrockRegion,
    bedrockModelId: modelId ?? '',
    googleBooksApiKeyParam: apiKeyParam && apiKeyParam.length > 0 ? apiKeyParam : null,
    usageTableName: usageTable && usageTable.length > 0 ? usageTable : null,
    dailyBedrockLimit: parsePositiveInteger(env.DAILY_BEDROCK_LIMIT, DEFAULT_DAILY_BEDROCK_LIMIT),
    dailyGoogleBooksLimit: parsePositiveInteger(
      env.DAILY_GOOGLE_BOOKS_LIMIT,
      DEFAULT_DAILY_GOOGLE_BOOKS_LIMIT,
    ),
    logLevel: logLevel === 'debug' ? 'debug' : 'info',
  };
}

/** 正の整数だけを受け付け、それ以外（未設定・小数・0以下・非数）は既定値にする。 */
function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * 呼び出し側が渡す AbortSignal で取得を打ち切れる API キー取得関数。
 * `invalidate()` はキャッシュ済みのキーを捨て、次の呼び出しで SSM から取得し直す。
 */
export interface GoogleBooksApiKeyProvider {
  (signal: AbortSignal): Promise<string | undefined>;
  invalidate(): void;
}

/** SSM から取得した API キーを保持する時間。ローテーションを反映できる程度に短くする。 */
export const API_KEY_CACHE_TTL_MS = 10 * 60_000;

export interface SsmRequest {
  parameterName: string;
  region: string;
}

export type SsmSend = (
  request: SsmRequest,
  signal: AbortSignal,
) => Promise<{ Parameter?: { Value?: string } }>;

/**
 * SSM SecureString から Google Books API キーを取得する。
 *
 * - 取得は呼び出し側の AbortSignal（段階上限と全体残り時間の短い方）で打ち切る。
 * - 成功した値だけをメモリにキャッシュする。失敗・タイムアウトはキャッシュしない
 *   （次のリクエストで再取得する）。
 * - キャッシュは 10 分で期限切れにし、期限後は SSM から再取得する。
 * - `invalidate()` はキーが失効した可能性がある応答（Google Books の 400/401/403）を
 *   受け取ったときに呼ぶ。次のリクエストで再取得する。
 * - 同時リクエストで重複取得してもよい（in-flight の共有はしない）。
 * - 取得に失敗しても API キーなしで Google Books を呼べるため、リクエストは止めない。
 */
export function createGoogleBooksApiKeyProvider(
  config: AppConfig,
  logger: Logger,
  send?: SsmSend,
  now: () => number = Date.now,
): GoogleBooksApiKeyProvider {
  let cached: { value: string; fetchedAt: number } | undefined;

  const provider = (async (signal: AbortSignal) => {
    if (cached !== undefined && now() - cached.fetchedAt < API_KEY_CACHE_TTL_MS) {
      return cached.value;
    }
    cached = undefined;
    if (!config.googleBooksApiKeyParam) return undefined;

    const value = await fetchApiKey(
      config.googleBooksApiKeyParam,
      config.awsRegion,
      logger,
      signal,
      send,
    );
    if (value !== undefined) cached = { value, fetchedAt: now() };
    return value;
  }) as GoogleBooksApiKeyProvider;

  provider.invalidate = () => {
    // キー値そのものはログにも例外にも出さない。
    cached = undefined;
  };

  return provider;
}

async function fetchApiKey(
  parameterName: string,
  region: string,
  logger: Logger,
  signal: AbortSignal,
  send?: SsmSend,
): Promise<string | undefined> {
  try {
    const response = send
      ? await send({ parameterName, region }, signal)
      : await defaultSend(parameterName, region, signal);
    const value = response.Parameter?.Value?.trim();
    if (!value) {
      logger.warn({ event: 'google_books_api_key_empty' });
      return undefined;
    }
    logger.info({ event: 'google_books_api_key_loaded' });
    return value;
  } catch (error) {
    // パラメータ名・値をログに出さない。例外種別だけ記録する。
    logger.warn({ event: 'google_books_api_key_unavailable', errorName: errorNameOf(error) });
    return undefined;
  }
}

async function defaultSend(
  parameterName: string,
  region: string,
  signal: AbortSignal,
): Promise<{ Parameter?: { Value?: string } }> {
  const client = new SSMClient({ region, maxAttempts: 1 });
  const response = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
    { abortSignal: signal },
  );
  return { Parameter: response.Parameter };
}

function errorNameOf(error: unknown): string {
  if (error instanceof Error) return error.name;
  return 'UnknownError';
}
