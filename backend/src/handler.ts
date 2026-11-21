import { randomUUID } from 'node:crypto';

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Handler,
} from 'aws-lambda';

import { createBedrockGateway } from './lib/bedrock.js';
import { createTtlCache } from './lib/cache.js';
import {
  createGoogleBooksApiKeyProvider,
  loadConfig,
  type GoogleBooksApiKeyProvider,
} from './lib/config.js';
import type {
  AppDeps,
  BooksSearchCache,
  RecommendationCache,
  RankedRecommendation,
  RequestContext,
  RequestMeta,
} from './lib/context.js';
import { createDeadline, DEFAULT_LIMITS, type Deadline, type Limits } from './lib/deadline.js';
import { AppError, errorBody } from './lib/errors.js';
import { createGoogleBooksGateway } from './lib/googleBooks.js';
import { jsonResponse, type ApiResponse } from './lib/http.js';
import { createLogger, type Logger } from './lib/log.js';
import {
  createUsageCounter,
  PASS_THROUGH_USAGE_COUNTER,
  type UsageCounter,
} from './lib/usage.js';
import { handleBooks } from './routes/books.js';
import { handleBookSearch } from './routes/bookSearch.js';
import { handleHealth } from './routes/health.js';
import { handleSeed } from './routes/seed.js';

export interface HandlerDeps {
  config: AppDeps['config'];
  bedrock: AppDeps['bedrock'];
  googleBooks: AppDeps['googleBooks'];
  /** Google Books API キー取得。省略時はキーなしで検索する（テスト用）。 */
  googleBooksApiKey?: GoogleBooksApiKeyProvider;
  logger: Logger;
  /** テストで短縮するためだけの上書き。既定は DEFAULT_LIMITS。 */
  limits?: Partial<Limits>;
  now?: () => number;
  /** 実行環境内メモリキャッシュ。省略時は createHandler が1つ作って使い回す。 */
  booksCache?: BooksSearchCache;
  recommendationCache?: RecommendationCache;
  /** 日次の外部呼び出し上限。省略時は上限なし（テスト用）。 */
  usage?: UsageCounter;
}

export type ApiHandler = (event: APIGatewayProxyEventV2) => Promise<ApiResponse>;

/** 実行環境内メモリキャッシュの既定値。TTL 30分・最大200件。 */
const DEFAULT_CACHE_TTL_MS = 30 * 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 200;

export function createHandler(deps: HandlerDeps): ApiHandler {
  // キャッシュはハンドラ（＝Lambda 実行環境）ごとに1つ。リクエストごとに作らない。
  const resolved = withDefaultCaches(deps);
  return (event) => handleEvent(event, resolved);
}

function withDefaultCaches(deps: HandlerDeps): HandlerDeps {
  if (deps.booksCache !== undefined && deps.recommendationCache !== undefined) return deps;
  return {
    ...deps,
    booksCache: deps.booksCache ?? createDefaultBooksCache(),
    recommendationCache: deps.recommendationCache ?? createDefaultRecommendationCache(),
  };
}

function createDefaultBooksCache(): BooksSearchCache {
  return createTtlCache<string, unknown[]>({
    ttlMs: DEFAULT_CACHE_TTL_MS,
    maxEntries: DEFAULT_CACHE_MAX_ENTRIES,
  });
}

function createDefaultRecommendationCache(): RecommendationCache {
  return createTtlCache<string, RankedRecommendation[]>({
    ttlMs: DEFAULT_CACHE_TTL_MS,
    maxEntries: DEFAULT_CACHE_MAX_ENTRIES,
  });
}

/** テスト用の既定（キーなし検索）。キャッシュを持たないので invalidate は何もしない。 */
const PASS_THROUGH_API_KEY: GoogleBooksApiKeyProvider = Object.assign(
  async () => undefined,
  { invalidate: () => {} },
);

export async function handleEvent(
  event: APIGatewayProxyEventV2,
  deps: HandlerDeps,
): Promise<ApiResponse> {
  const source = withDefaultCaches(deps);
  const startedAt = source.now ? source.now() : Date.now();
  const requestId = event.requestContext?.requestId || randomUUID();
  const limits: Limits = { ...DEFAULT_LIMITS, ...source.limits };
  const resolved: AppDeps = {
    config: source.config,
    bedrock: source.bedrock,
    googleBooks: source.googleBooks,
    googleBooksApiKey: source.googleBooksApiKey ?? PASS_THROUGH_API_KEY,
    logger: source.logger,
    limits,
    now: source.now ?? Date.now,
    booksCache: source.booksCache as BooksSearchCache,
    recommendationCache: source.recommendationCache as RecommendationCache,
    usage: source.usage ?? PASS_THROUGH_USAGE_COUNTER,
  };
  const deadline = createDeadline(limits.totalMs, limits.responseReserveMs, resolved.now);
  const meta: RequestMeta = { upstreams: [] };
  const route = routeLabel(event);

  let response: ApiResponse;
  let errorCode: string | undefined;
  try {
    response = await dispatch(event, { requestId, deadline, deps: resolved, meta });
  } catch (error) {
    const appError = toAppError(error, resolved.logger, requestId);
    errorCode = appError.code;
    response = jsonResponse(appError.statusCode, errorBody(requestId, appError));
  }

  resolved.logger.info({
    event: 'request',
    requestId,
    route,
    status: response.statusCode,
    durationMs: resolved.now() - startedAt,
    ...(meta.resultCount === undefined ? {} : { resultCount: meta.resultCount }),
    ...(errorCode === undefined ? {} : { errorCode }),
    upstreams: meta.upstreams,
  });

  return response;
}

async function dispatch(event: APIGatewayProxyEventV2, ctx: DispatchContext): Promise<ApiResponse> {
  const http = event.requestContext?.http;
  const method = (http?.method ?? '').toUpperCase();
  const path = event.rawPath || http?.path || '';
  const context: RequestContext = { ...ctx, event };

  if (method === 'POST' && path === '/v1/discovery/seed') {
    return handleSeed(context);
  }
  if (method === 'GET' && path === '/health') {
    return handleHealth(context);
  }
  if (method === 'GET' && path === '/v1/books/search') {
    return handleBookSearch(context);
  }
  const booksMatch = /^\/v1\/themes\/([^/]+)\/books$/.exec(path);
  if (method === 'GET' && booksMatch) {
    return handleBooks(context, booksMatch[1] as string);
  }
  throw new AppError(404, 'NOT_FOUND');
}

interface DispatchContext {
  requestId: string;
  deadline: Deadline;
  deps: AppDeps;
  meta: RequestMeta;
}

function toAppError(error: unknown, logger: Logger, requestId: string): AppError {
  if (error instanceof AppError) return error;
  // 内部例外の内容・スタックは本文にもログ本文にも出さない。名前だけ残す。
  logger.warn({
    event: 'unhandled_error',
    requestId,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return new AppError(500, 'INTERNAL_ERROR');
}

function routeLabel(event: APIGatewayProxyEventV2): string {
  const http = event.requestContext?.http;
  const method = (http?.method ?? '').toUpperCase();
  const path = event.rawPath || http?.path || '';
  if (method === 'POST' && path === '/v1/discovery/seed') return 'POST /v1/discovery/seed';
  if (method === 'GET' && path === '/health') return 'GET /health';
  if (method === 'GET' && path === '/v1/books/search') return 'GET /v1/books/search';
  if (method === 'GET' && /^\/v1\/themes\/[^/]+\/books$/.test(path)) {
    return 'GET /v1/themes/{themeId}/books';
  }
  // パスをそのまま出さない（URL に q が含まれ得るため）。
  return `${method === '' ? 'UNKNOWN' : method} /unknown`;
}

/** Lambda / ローカル開発サーバー共通の既定依存。AWS 認証情報は呼び出し時に解決される。 */
export function createDefaultDeps(env: NodeJS.ProcessEnv = process.env): AppDeps {
  const config = loadConfig(env);
  const logger = createLogger(config.logLevel);
  const usage = createUsageCounter({
    tableName: config.usageTableName,
    limits: {
      bedrock: config.dailyBedrockLimit,
      google_books: config.dailyGoogleBooksLimit,
    },
    logger,
    region: config.awsRegion,
  });
  if (config.usageTableName === null && env.NODE_ENV !== 'test') {
    // 環境変数の欠落で日次上限だけが静かに無効になるのを防ぐため、生成時に1回だけ知らせる。
    logger.warn({ event: 'usage_limit_disabled' });
  }
  return {
    config,
    logger,
    bedrock: createBedrockGateway({ config, logger }),
    googleBooks: createGoogleBooksGateway(),
    googleBooksApiKey: createGoogleBooksApiKeyProvider(config, logger),
    limits: DEFAULT_LIMITS,
    now: Date.now,
    booksCache: createDefaultBooksCache(),
    recommendationCache: createDefaultRecommendationCache(),
    usage,
  };
}

export const handler: Handler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2> =
  createHandler(createDefaultDeps());
