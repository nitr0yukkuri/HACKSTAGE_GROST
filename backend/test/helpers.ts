import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { createHandler, type HandlerDeps } from '../src/handler.js';
import type {
  BedrockGateway,
  ConverseJsonParams,
  ConverseParams,
} from '../src/lib/bedrock.js';
import { loadConfig, type AppConfig } from '../src/lib/config.js';
import type { Limits } from '../src/lib/deadline.js';
import type {
  BooksSearchCache,
  RankedRecommendation,
  RecommendationCache,
} from '../src/lib/context.js';
import type { GoogleBooksApiKeyProvider } from '../src/lib/config.js';
import type { GoogleBooksGateway } from '../src/lib/googleBooks.js';
import type { UsageCounter, UsageKind, UsageResult } from '../src/lib/usage.js';
import { createTtlCache } from '../src/lib/cache.js';
import { parseModelJson } from '../src/lib/json.js';
import { silentLogger, type Logger } from '../src/lib/log.js';

export type ParsedBody = Record<string, unknown>;

export interface EventOptions {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  query?: Record<string, string>;
  requestId?: string;
}

export function makeEvent(options: EventOptions): APIGatewayProxyEventV2 {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) headers[key] = value;
  }

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: options.path,
    rawQueryString: options.query ? new URLSearchParams(options.query).toString() : '',
    headers,
    requestContext: {
      accountId: 'test',
      apiId: 'test',
      domainName: 'test.example',
      domainPrefix: 'test',
      http: {
        method: options.method,
        path: options.path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: options.requestId ?? 'test-request-id',
      routeKey: '$default',
      stage: '$default',
      time: new Date(0).toISOString(),
      timeEpoch: 0,
    },
    body: options.body,
    isBase64Encoded: options.isBase64Encoded ?? false,
    queryStringParameters: options.query,
  };
}

export const V1_NORMAL = {
  questionnaireVersion: 'onboarding-v1',
  answers: [
    { questionId: 'interest', selectedOptionIds: ['create'] },
    { questionId: 'themes', selectedOptionIds: ['tec', 'mon'] },
    { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
  ],
};

export const V1_NONE = {
  questionnaireVersion: 'onboarding-v1',
  answers: [
    { questionId: 'interest', selectedOptionIds: ['none'] },
    { questionId: 'themes', selectedOptionIds: ['omakase'] },
    { questionId: 'reading_experience', selectedOptionIds: ['learn_knowledge'] },
  ],
};

export const V2_CURIOSITY = {
  questionnaireVersion: 'onboarding-v2',
  answers: [
    { questionId: 'interest', selectedOptionIds: ['none'] },
    {
      questionId: 'curiosity',
      selectedOptionIds: ['music_emotions', 'space_mysteries'],
    },
    { questionId: 'themes', selectedOptionIds: ['omakase'] },
    { questionId: 'reading_experience', selectedOptionIds: ['learn_knowledge'] },
  ],
};

export const V2_NO_CURIOSITY = {
  questionnaireVersion: 'onboarding-v2',
  answers: [
    { questionId: 'interest', selectedOptionIds: ['explore_unknown'] },
    { questionId: 'themes', selectedOptionIds: ['lit', 'art'] },
    { questionId: 'reading_experience', selectedOptionIds: ['immerse_story'] },
  ],
};

export function seedEvent(
  body: unknown,
  options: {
    contentType?: string | null;
    requestId?: string;
    method?: string;
    path?: string;
  } = {},
): APIGatewayProxyEventV2 {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const contentType =
    options.contentType === undefined ? 'application/json' : options.contentType;
  const headers: Record<string, string | undefined> = {};
  if (contentType !== null) headers['content-type'] = contentType;

  return makeEvent({
    method: options.method ?? 'POST',
    path: options.path ?? '/v1/discovery/seed',
    headers,
    body: text,
    requestId: options.requestId,
  });
}

export function seedEventBase64(body: string, requestId?: string): APIGatewayProxyEventV2 {
  return makeEvent({
    method: 'POST',
    path: '/v1/discovery/seed',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Buffer.from(body, 'utf8').toString('base64'),
    isBase64Encoded: true,
    requestId,
  });
}

export function booksEvent(options: {
  themeId?: string;
  q?: string | null;
  context?: unknown;
  contextValue?: string;
  omitContext?: boolean;
  headerName?: string;
  requestId?: string;
} = {}): APIGatewayProxyEventV2 {
  const query: Record<string, string> = {};
  const q = options.q === undefined ? 'プログラミング 入門' : options.q;
  if (q !== null) query.q = q;

  const headers: Record<string, string | undefined> = {};
  if (!options.omitContext) {
    const value =
      options.contextValue ??
      (typeof options.context === 'string'
        ? options.context
        : JSON.stringify(options.context ?? V1_NORMAL));
    headers[options.headerName ?? 'x-discovery-context'] = value;
  }

  return makeEvent({
    method: 'GET',
    path: `/v1/themes/${encodeURIComponent(options.themeId ?? 'tec')}/books`,
    headers,
    query,
    requestId: options.requestId,
  });
}

export function healthEvent(requestId?: string): APIGatewayProxyEventV2 {
  return makeEvent({ method: 'GET', path: '/health', requestId });
}

export interface BedrockStub extends BedrockGateway {
  calls: ConverseParams[];
  jsonCalls: ConverseJsonParams[];
}

/**
 * テキストを返す既存テスト用のスタブ。`converseJson` はテキストを parseModelJson で
 * オブジェクトにして返す（本番のフォールバックと同じ経路）。
 */
export function bedrockStub(
  answer: (params: ConverseParams) => string | Promise<string>,
): BedrockStub {
  const calls: ConverseParams[] = [];
  const jsonCalls: ConverseJsonParams[] = [];
  const converse = async (params: ConverseParams): Promise<string> => {
    calls.push(params);
    return answer(params);
  };
  return {
    calls,
    jsonCalls,
    converseText: converse,
    async converseJson(params) {
      jsonCalls.push(params);
      return parseModelJson(await converse(params));
    },
  };
}

/** 応答しない Bedrock。AbortSignal で打ち切られたら TimeoutError で失敗する。 */
export function hangingBedrock(): BedrockStub {
  const calls: ConverseParams[] = [];
  const jsonCalls: ConverseJsonParams[] = [];
  const hang = (params: ConverseParams): Promise<string> => {
    calls.push(params);
    return new Promise<string>((_resolve, reject) => {
      const fail = (): void => {
        const error = new Error('aborted');
        error.name = 'TimeoutError';
        reject(error);
      };
      if (params.abortSignal.aborted) fail();
      else params.abortSignal.addEventListener('abort', fail, { once: true });
    });
  };
  return {
    calls,
    jsonCalls,
    converseText: hang,
    converseJson(params) {
      jsonCalls.push(params);
      return hang(params);
    },
  };
}

export interface GoogleBooksStub extends GoogleBooksGateway {
  queries: string[];
  apiKeys: Array<string | undefined>;
}

export function googleBooksStub(
  answer: (
    query: string,
    apiKey: string | undefined,
    signal: AbortSignal,
  ) => unknown[] | Promise<unknown[]>,
): GoogleBooksStub {
  const queries: string[] = [];
  const apiKeys: Array<string | undefined> = [];
  return {
    queries,
    apiKeys,
    async search(query, apiKey, signal) {
      queries.push(query);
      apiKeys.push(apiKey);
      return answer(query, apiKey, signal);
    },
  };
}

/** 応答しない Google Books。AbortSignal で打ち切られたら AbortError で失敗する。 */
export function hangingGoogleBooks(): GoogleBooksStub {
  const queries: string[] = [];
  const apiKeys: Array<string | undefined> = [];
  return {
    queries,
    apiKeys,
    search(query, apiKey, signal) {
      queries.push(query);
      apiKeys.push(apiKey);
      return new Promise<unknown[]>((_resolve, reject) => {
        const fail = (): void => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    },
  };
}

export interface UsageStub extends UsageCounter {
  calls: Array<{ kind: UsageKind; signal: AbortSignal; requestId: string }>;
}

export function usageStub(
  answer: (kind: UsageKind) => UsageResult | Promise<UsageResult>,
): UsageStub {
  const calls: Array<{ kind: UsageKind; signal: AbortSignal; requestId: string }> = [];
  return {
    calls,
    async consume(kind, signal, requestId) {
      calls.push({ kind, signal, requestId });
      return answer(kind);
    },
  };
}

export interface Harness {
  handler: ReturnType<typeof createHandler>;
  bedrock: BedrockStub;
  googleBooks: GoogleBooksStub;
  config: AppConfig;
  apiKeySignals: AbortSignal[];
  /** API キー provider の invalidate() が呼ばれた回数。 */
  readonly apiKeyInvalidations: number;
  booksCache: BooksSearchCache;
  recommendationCache: RecommendationCache;
  usage: UsageStub;
}

export function createHarness(options: {
  bedrock?: BedrockGateway;
  googleBooks?: GoogleBooksGateway;
  /** API キー取得。省略時は常に undefined（キーなし検索）。invalidate() も委譲する。 */
  apiKey?: ((signal: AbortSignal) => Promise<string | undefined>) & {
    invalidate?: () => void;
  };
  limits?: Partial<Limits>;
  config?: Partial<AppConfig>;
  now?: () => number;
  /** 省略時は silentLogger。ログ検証用に差し替えられる。 */
  logger?: Logger;
  /** テストごとに独立したキャッシュを使う。省略時は新しいキャッシュを作る。 */
  booksCache?: BooksSearchCache;
  recommendationCache?: RecommendationCache;
  /** 日次上限のスタブ。省略時は常に ok。 */
  usage?: UsageCounter;
} = {}): Harness {
  const bedrock =
    (options.bedrock as BedrockStub | undefined) ??
    bedrockStub(() => {
      throw new Error('Bedrock must not be called');
    });
  const googleBooks =
    (options.googleBooks as GoogleBooksStub | undefined) ??
    googleBooksStub(() => {
      throw new Error('Google Books must not be called');
    });
  const config: AppConfig = {
    ...loadConfig({}),
    bedrockModelId: 'test-model',
    ...options.config,
  };
  const apiKeySignals: AbortSignal[] = [];
  const invalidations = { count: 0 };
  const googleBooksApiKey = (async (signal: AbortSignal): Promise<string | undefined> => {
    apiKeySignals.push(signal);
    return options.apiKey ? options.apiKey(signal) : undefined;
  }) as GoogleBooksApiKeyProvider;
  googleBooksApiKey.invalidate = () => {
    invalidations.count += 1;
    options.apiKey?.invalidate?.();
  };
  const booksCache =
    options.booksCache ?? createTtlCache<string, unknown[]>({ ttlMs: 30 * 60_000, maxEntries: 200 });
  const recommendationCache =
    options.recommendationCache ??
    createTtlCache<string, RankedRecommendation[]>({ ttlMs: 30 * 60_000, maxEntries: 200 });
  const usage = (options.usage as UsageStub | undefined) ?? usageStub(() => 'ok');
  const deps: HandlerDeps = {
    config,
    bedrock,
    googleBooks,
    googleBooksApiKey,
    logger: options.logger ?? silentLogger,
    limits: options.limits,
    now: options.now,
    booksCache,
    recommendationCache,
    usage,
  };
  return {
    handler: createHandler(deps),
    bedrock,
    googleBooks,
    config,
    apiKeySignals,
    get apiKeyInvalidations() {
      return invalidations.count;
    },
    booksCache,
    recommendationCache,
    usage,
  };
}

export function parseJson<T = ParsedBody>(body: string): T {
  return JSON.parse(body) as T;
}
