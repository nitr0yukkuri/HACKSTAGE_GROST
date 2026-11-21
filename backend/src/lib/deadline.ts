/**
 * リクエスト全体の期限管理。
 *
 * API 全体は 25 秒。各外部呼び出しには「段階上限」と
 * 「全体の残り時間 − 応答余裕」の短い方を AbortSignal で適用する。
 */

export interface Limits {
  /** API 全体の処理期限（ミリ秒）。 */
  totalMs: number;
  /** Bedrock の星・検索語選出の段階上限。 */
  seedBedrockMs: number;
  /** Google Books 検索の段階上限。 */
  booksSearchMs: number;
  /** Bedrock の理由生成の段階上限。 */
  recommendationMs: number;
  /** 応答・整形のために残す余裕。 */
  responseReserveMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  totalMs: 25_000,
  seedBedrockMs: 15_000,
  booksSearchMs: 6_000,
  recommendationMs: 10_000,
  responseReserveMs: 1_000,
};

export interface Deadline {
  readonly startedAt: number;
  /** 全体期限までの残り（ミリ秒）。負になりうる。 */
  remainingMs(): number;
  /** 応答余裕を引いた残り時間が 0 以下なら true。 */
  expired(): boolean;
  /** 段階上限と残り時間の短い方で AbortSignal を作る。 */
  signalFor(stageMs: number): AbortSignal;
}

export function createDeadline(
  totalMs: number = DEFAULT_LIMITS.totalMs,
  reserveMs: number = DEFAULT_LIMITS.responseReserveMs,
  now: () => number = Date.now,
): Deadline {
  const startedAt = now();
  const remainingMs = (): number => totalMs - (now() - startedAt);

  return {
    startedAt,
    remainingMs,
    expired: () => remainingMs() - reserveMs <= 0,
    signalFor: (stageMs: number) => {
      const budget = Math.min(stageMs, remainingMs() - reserveMs);
      return AbortSignal.timeout(Math.max(1, Math.floor(budget)));
    },
  };
}
