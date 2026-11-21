import type { RequestContext } from '../lib/context.js';
import { worldIdsForCategories } from '../lib/bookCategories.js';
import { readBooksSearchQuery, searchGoogleBooksItems } from '../lib/bookSearch.js';
import { normalizeVolumes } from '../lib/googleBooks.js';
import { jsonResponse, type ApiResponse } from '../lib/http.js';

const MAX_SEARCH_RESULTS = 12;

export async function handleBookSearch(ctx: RequestContext): Promise<ApiResponse> {
  const query = readBooksSearchQuery(ctx);
  const rawItems = await searchGoogleBooksItems(ctx, query);
  const categoriesById = readCategoriesById(rawItems);
  const seenIds = new Set<string>();
  const items = normalizeVolumes(rawItems)
    .flatMap((book) => {
      if (seenIds.has(book.id)) return [];
      seenIds.add(book.id);
      return [{
        ...book,
        source: 'google_books' as const,
        recommendationReason: null,
        worldIds: worldIdsForCategories(categoriesById.get(book.id) ?? []),
      }];
    })
    .slice(0, MAX_SEARCH_RESULTS);

  ctx.meta.resultCount = items.length;
  return jsonResponse(200, { requestId: ctx.requestId, items });
}

function readCategoriesById(items: readonly unknown[]): Map<string, string[]> {
  const categoriesById = new Map<string, string[]>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const id = item.id.trim();
    if (!id) continue;
    const volumeInfo = isRecord(item.volumeInfo) ? item.volumeInfo : null;
    const categories = Array.isArray(volumeInfo?.categories)
      ? volumeInfo.categories.filter((category): category is string => typeof category === 'string')
      : [];
    categoriesById.set(id, [...new Set([...(categoriesById.get(id) ?? []), ...categories])]);
  }
  return categoriesById;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
