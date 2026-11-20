import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import type { BedrockGateway } from './bedrock.js';
import type { TtlCache } from './cache.js';
import type { AppConfig, GoogleBooksApiKeyProvider } from './config.js';
import type { Deadline, Limits } from './deadline.js';
import type { GoogleBooksGateway } from './googleBooks.js';
import type { Logger } from './log.js';
import type { UsageCounter } from './usage.js';

export type UpstreamOutcome = 'ok' | 'error' | 'timeout' | 'skipped';

export interface UpstreamTrace {
  name: 'bedrock' | 'google_books';
  durationMs: number;
  outcome: UpstreamOutcome;
  /** 実行環境内のメモリキャッシュから返した場合だけ true。 */
  cached?: boolean;
}

/** Google Books の検索結果（`search` が返した生 items 配列）。キーは trim 後の検索語。 */
export type BooksSearchCache = TtlCache<string, unknown[]>;

/** 順位付きの推薦選定。成功した選定だけを保存する。 */
export interface RankedRecommendation {
  id: string;
  reason: string | null;
}

/** 推薦選定キャッシュ（キャッシュキー → 推薦順の書籍IDと理由）。 */
export type RecommendationCache = TtlCache<string, RankedRecommendation[]>;

/** ログに出すためだけのメタ情報。回答内容やプロンプトは入れない。 */
export interface RequestMeta {
  resultCount?: number;
  upstreams: UpstreamTrace[];
}

export interface AppDeps {
  config: AppConfig;
  bedrock: BedrockGateway;
  googleBooks: GoogleBooksGateway;
  /** Google Books API キーの取得。信号で打ち切られ、失敗時は undefined を返す。 */
  googleBooksApiKey: GoogleBooksApiKeyProvider;
  logger: Logger;
  limits: Limits;
  now: () => number;
  /** Google Books の検索結果キャッシュ（実行環境内メモリ）。 */
  booksCache: BooksSearchCache;
  /** 推薦理由キャッシュ（実行環境内メモリ）。 */
  recommendationCache: RecommendationCache;
  /** 日次の外部呼び出し上限。テーブル未設定なら常に ok。 */
  usage: UsageCounter;
}

export interface RequestContext {
  event: APIGatewayProxyEventV2;
  requestId: string;
  deadline: Deadline;
  deps: AppDeps;
  meta: RequestMeta;
}
