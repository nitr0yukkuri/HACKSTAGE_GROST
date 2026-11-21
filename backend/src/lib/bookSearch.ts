import type { RequestContext } from './context.js';
import { AppError, type ErrorDetail } from './errors.js';
import { codePointLength, getQueryParameter } from './http.js';
import { GoogleBooksError } from './googleBooks.js';
import { USAGE_CONSUME_TIMEOUT_MS } from './usage.js';

const API_KEY_FETCH_MS = 2_000;
const MAX_QUERY_CODE_POINTS = 128;

/** 星別推薦と単純検索で共通する検索語の検証。 */
export function readBooksSearchQuery(ctx: RequestContext): string {
  const { present, value } = getQueryParameter(ctx.event, 'q');
  if (!present || typeof value !== 'string') {
    throw validationError([{ field: 'q', code: 'INVALID_REQUEST_SHAPE' }]);
  }
  const trimmed = value.trim();
  const length = codePointLength(trimmed);
  if (length < 1 || length > MAX_QUERY_CODE_POINTS) {
    throw validationError([{ field: 'q', code: 'INVALID_REQUEST_SHAPE' }]);
  }
  return trimmed;
}

/**
 * キャッシュ、SSMキー、日次カウンター、タイムアウト、Google Books呼び出しを一元化する。
 * テーマ推薦と探索検索は同じ検索語なら同じ生結果を再利用する。
 */
export async function searchGoogleBooksItems(
  ctx: RequestContext,
  query: string,
): Promise<unknown[]> {
  if (ctx.deadline.expired()) throw booksTimeout();

  const searchStarted = ctx.deps.now();
  const cachedItems = ctx.deps.booksCache.get(query, ctx.deps.now());
  if (cachedItems !== undefined) {
    ctx.meta.upstreams.push({
      name: 'google_books',
      durationMs: 0,
      outcome: 'ok',
      cached: true,
    });
    return cachedItems;
  }

  const apiKey = await readApiKey(ctx);
  if (ctx.deadline.expired()) throw booksTimeout();

  const searchBudgetMs = ctx.deps.limits.booksSearchMs - (ctx.deps.now() - searchStarted);
  if (searchBudgetMs <= 0) {
    ctx.meta.upstreams.push({
      name: 'google_books',
      durationMs: ctx.deps.now() - searchStarted,
      outcome: 'timeout',
    });
    throw booksTimeout();
  }

  // Cache miss だけ、Google Books を呼ぶ直前に日次枠を消費する。
  const usage = await ctx.deps.usage.consume(
    'google_books',
    ctx.deadline.signalFor(Math.min(USAGE_CONSUME_TIMEOUT_MS, searchBudgetMs)),
    ctx.requestId,
    ctx.event.requestContext?.http?.sourceIp,
  );
  if (usage === 'exceeded') throw new AppError(429, 'RATE_LIMITED');

  const searchRemainingMs = ctx.deps.limits.booksSearchMs - (ctx.deps.now() - searchStarted);
  if (searchRemainingMs <= 0 || ctx.deadline.expired()) {
    ctx.meta.upstreams.push({
      name: 'google_books',
      durationMs: ctx.deps.now() - searchStarted,
      outcome: 'timeout',
    });
    throw booksTimeout();
  }

  if (usage === 'unavailable') {
    // カウンター障害時は枠を迂回させない（fail-closed）。
    throw new AppError(502, 'BOOKS_UPSTREAM_ERROR');
  }

  try {
    const rawItems = await ctx.deps.googleBooks.search(
      query,
      apiKey,
      ctx.deadline.signalFor(searchRemainingMs),
    );
    ctx.meta.upstreams.push({
      name: 'google_books',
      durationMs: ctx.deps.now() - searchStarted,
      outcome: 'ok',
    });
    ctx.deps.booksCache.set(query, rawItems, ctx.deps.now());
    return rawItems;
  } catch (error) {
    const timedOut =
      (error instanceof GoogleBooksError && error.kind === 'timeout') || isAbortError(error);
    ctx.deps.logger.warn({
      event: 'google_books_failed',
      requestId: ctx.requestId,
      kind: error instanceof GoogleBooksError ? error.kind : 'unknown',
      statusCode: error instanceof GoogleBooksError ? error.statusCode : undefined,
    });
    ctx.meta.upstreams.push({
      name: 'google_books',
      durationMs: ctx.deps.now() - searchStarted,
      outcome: timedOut ? 'timeout' : 'error',
    });
    if (timedOut) throw booksTimeout();
    if (
      error instanceof GoogleBooksError &&
      error.kind === 'http' &&
      isKeyRejectedStatus(error.statusCode)
    ) {
      ctx.deps.googleBooksApiKey.invalidate();
    }
    throw new AppError(502, 'BOOKS_UPSTREAM_ERROR');
  }
}

async function readApiKey(ctx: RequestContext): Promise<string | undefined> {
  try {
    return await ctx.deps.googleBooksApiKey(
      ctx.deadline.signalFor(Math.min(API_KEY_FETCH_MS, ctx.deps.limits.booksSearchMs)),
    );
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  return (error as { code?: unknown }).code === 'ABORT_ERR';
}

function isKeyRejectedStatus(statusCode: number | undefined): boolean {
  return statusCode === 400 || statusCode === 401 || statusCode === 403;
}

function validationError(details: ErrorDetail[]): AppError {
  return new AppError(422, 'VALIDATION_ERROR', '検索語を確認してください。', details);
}

function booksTimeout(): AppError {
  return new AppError(504, 'UPSTREAM_TIMEOUT', '時間内に書籍情報を取得できませんでした。');
}
