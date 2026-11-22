import type { LibraryState } from './library-store'

export type WorldBookLists = Record<string, string[]>

export const WORLD_BOOK_LISTS_STORAGE_KEY = 'hoshirube:world-books:v1'
let memoryFallback: WorldBookLists = {}

export function isWorldComplete(bookKeys: readonly string[], library: LibraryState): boolean {
  return bookKeys.length > 0 && bookKeys.every((key) => library[key]?.status === 'read')
}

export function completedWorldIdsFor(bookLists: WorldBookLists, library: LibraryState): Set<string> {
  return new Set(Object.entries(bookLists)
    .filter(([, keys]) => isWorldComplete(keys, library))
    .map(([worldId]) => worldId))
}

export function resetWorldBookListsFallback(): void {
  memoryFallback = {}
}

export function loadWorldBookLists(): WorldBookLists {
  if (typeof window === 'undefined') return {}
  try {
    const stored = window.localStorage.getItem(WORLD_BOOK_LISTS_STORAGE_KEY)
    if (stored === null) return memoryFallback
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    memoryFallback = Object.fromEntries(Object.entries(parsed).filter(([, keys]) =>
      Array.isArray(keys) && keys.length > 0 &&
      keys.every((key) => typeof key === 'string' && key.length > 0),
    ))
    return memoryFallback
  } catch {
    return memoryFallback
  }
}

/** APIで実際に表示した本を記録する。完読済みの組は検索結果が変わっても保持する。 */
export function rememberWorldBooks(worldId: string, bookKeys: string[], library: LibraryState): WorldBookLists {
  const previous = loadWorldBookLists()
  if (bookKeys.length === 0 || isWorldComplete(previous[worldId] ?? [], library)) return previous

  const next = { ...previous, [worldId]: [...new Set(bookKeys)] }
  memoryFallback = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(WORLD_BOOK_LISTS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storageが使えなくても、このタブ内では完読判定を続ける。
    }
  }
  return next
}
