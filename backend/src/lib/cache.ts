/**
 * Lambda 実行環境内のメモリキャッシュ。
 *
 * 目的は公開 API の外部呼び出し（Google Books・Bedrock）の回数を抑え、
 * 費用とクォータの消費を減らすこと。プロセスをまたいだ共有はせず、
 * 実行環境ごとに独立して持つ。失敗した結果は呼び出し側で保存しない。
 *
 * - `get` は期限切れの項目を破棄して undefined を返す。
 * - `set` は同じキーを入れ直した場合に挿入順の末尾へ移す。
 * - 件数上限を超えたら、最も古く挿入したものから捨てる（Map の挿入順）。
 * - 時計は呼び出し側から渡す（テストで TTL を検証できるようにするため）。
 */

export interface TtlCache<K, V> {
  get(key: K, now: number): V | undefined;
  set(key: K, value: V, now: number): void;
  /** 現在の保持件数（期限切れの掃除は行わない）。 */
  readonly size: number;
}

export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export function createTtlCache<K, V>(options: TtlCacheOptions): TtlCache<K, V> {
  const entries = new Map<K, CacheEntry<V>>();

  return {
    get(key: K, now: number): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      // 期限ちょうどは期限切れとして扱う。
      if (now >= entry.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },

    set(key: K, value: V, now: number): void {
      // 同じキーを入れ直したときは挿入順を末尾へ更新する。
      entries.delete(key);
      entries.set(key, { value, expiresAt: now + options.ttlMs });
      // 上限超過時は最も古い挿入から捨てる。
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },

    get size(): number {
      return entries.size;
    },
  };
}
