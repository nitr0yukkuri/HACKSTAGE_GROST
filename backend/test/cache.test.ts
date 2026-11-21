import { describe, expect, it } from 'vitest';

import { createTtlCache } from '../src/lib/cache.js';

describe('createTtlCache', () => {
  it('TTL 内は同じ値を返し、TTL 経過後は undefined になる', () => {
    const cache = createTtlCache<string, number>({ ttlMs: 30 * 60_000, maxEntries: 200 });
    cache.set('key', 1, 0);

    expect(cache.get('key', 0)).toBe(1);
    // 期限の1ミリ秒前はまだ有効。
    expect(cache.get('key', 30 * 60_000 - 1)).toBe(1);
    // 期限ちょうどは期限切れ。
    expect(cache.get('key', 30 * 60_000)).toBeUndefined();
  });

  it('期限切れの項目は保持件数から除かれる', () => {
    const cache = createTtlCache<string, number>({ ttlMs: 1_000, maxEntries: 200 });
    cache.set('a', 1, 0);
    cache.set('b', 2, 0);
    expect(cache.size).toBe(2);

    expect(cache.get('a', 1_000)).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('上限を超えたら最も古く挿入したものから捨てる', () => {
    const cache = createTtlCache<string, number>({ ttlMs: 60_000, maxEntries: 2 });
    cache.set('a', 1, 0);
    cache.set('b', 2, 0);
    cache.set('c', 3, 0);

    expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.get('b', 0)).toBe(2);
    expect(cache.get('c', 0)).toBe(3);
  });

  it('同じキーを入れ直すと挿入順が末尾になり、次の追加で捨てられない', () => {
    const cache = createTtlCache<string, number>({ ttlMs: 60_000, maxEntries: 2 });
    cache.set('a', 1, 0);
    cache.set('b', 2, 0);
    cache.set('a', 10, 100);
    cache.set('c', 3, 200);

    expect(cache.get('a', 200)).toBe(10);
    expect(cache.get('b', 200)).toBeUndefined();
    expect(cache.get('c', 200)).toBe(3);
  });
});
