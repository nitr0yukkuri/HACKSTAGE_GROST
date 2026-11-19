import { BOOKS } from '../data/books'
import type { Book } from '../types/hoshirube'

export type ReadingStatus = 'to_read' | 'read'

export interface LibraryEntry {
  status: ReadingStatus
  savedAt: number
  book: Book
}

export type LibraryState = Record<string, LibraryEntry>

export const LIBRARY_STORAGE_KEY = 'hoshirube:library:v2'
const LEGACY_LIBRARY_STORAGE_KEY = 'hoshirube:library:v1'
export const LIBRARY_CHANGE_EVENT = 'hoshirube:library-change'

let memoryFallback: LibraryState = {}

export function libraryBookKey(book: Pick<Book, 'source' | 'id'>): string {
  return JSON.stringify([book.source, book.id])
}

export function resetLibraryFallback(): void {
  memoryFallback = {}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function parseBook(value: unknown): Book | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.title) ||
      (value.source !== 'google_books' && value.source !== 'local_demo') ||
      !Array.isArray(value.authors) || !value.authors.every((author) => typeof author === 'string') ||
      !(value.coverUrl === null || (typeof value.coverUrl === 'string' && value.coverUrl.startsWith('https://'))) ||
      !(value.description === null || typeof value.description === 'string') ||
      !(value.recommendationReason === null || typeof value.recommendationReason === 'string') ||
      !(value.infoUrl === null || (typeof value.infoUrl === 'string' && /^https:\/\/books\.google\.(com|co\.jp)\//.test(value.infoUrl))) ||
      !Array.isArray(value.worldIds) || !value.worldIds.every((id) => typeof id === 'string')) return null

  return {
    id: value.id,
    source: value.source,
    title: value.title,
    authors: value.authors,
    coverUrl: value.coverUrl,
    description: value.description,
    recommendationReason: value.recommendationReason,
    infoUrl: value.infoUrl,
    worldIds: [...new Set(value.worldIds)],
  }
}

function parseLibrary(value: unknown): LibraryState {
  if (!isRecord(value)) return {}

  const entries: LibraryState = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || (raw.status !== 'to_read' && raw.status !== 'read') ||
        typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt)) continue
    const book = parseBook(raw.book)
    if (!book || libraryBookKey(book) !== key) continue
    entries[key] = { status: raw.status, savedAt: raw.savedAt, book }
  }
  return entries
}

function migrateLegacyLibrary(): LibraryState {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(LEGACY_LIBRARY_STORAGE_KEY)
    if (!raw) return {}
    const legacy: unknown = JSON.parse(raw)
    if (!isRecord(legacy)) return {}
    const migrated: LibraryState = {}
    for (const [id, value] of Object.entries(legacy)) {
      const book = BOOKS.find((candidate) => candidate.source === 'local_demo' && candidate.id === id)
      if (!book || !isRecord(value) || (value.status !== 'to_read' && value.status !== 'read') ||
          typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) continue
      migrated[libraryBookKey(book)] = { status: value.status, savedAt: value.savedAt, book }
    }
    return migrated
  } catch {
    return {}
  }
}

export function loadLibrary(): LibraryState {
  if (typeof window === 'undefined') return {}
  try {
    const stored = window.localStorage.getItem(LIBRARY_STORAGE_KEY)
    if (stored !== null) {
      memoryFallback = parseLibrary(JSON.parse(stored))
      return memoryFallback
    }
    memoryFallback = migrateLegacyLibrary()
    if (Object.keys(memoryFallback).length > 0) {
      window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(memoryFallback))
    }
    return memoryFallback
  } catch {
    return memoryFallback
  }
}

function persistLibrary(next: LibraryState): void {
  memoryFallback = next
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Keep this tab usable when browser storage is unavailable or full.
  }
  window.dispatchEvent(new Event(LIBRARY_CHANGE_EVENT))
}

export function saveBook(book: Book, themeId: string): void {
  const key = libraryBookKey(book)
  const current = loadLibrary()
  const previous = current[key]
  const savedBook: Book = {
    ...book,
    worldIds: [...new Set([...(previous?.book.worldIds ?? []), ...book.worldIds, themeId])],
  }
  persistLibrary({
    ...current,
    [key]: {
      status: previous?.status ?? 'to_read',
      savedAt: previous?.savedAt ?? Date.now(),
      book: savedBook,
    },
  })
}

export function setBookReadStatus(bookKey: string, status: ReadingStatus): void {
  const current = loadLibrary()
  if (!current[bookKey]) return
  persistLibrary({ ...current, [bookKey]: { ...current[bookKey], status } })
}

export function removeBook(bookKey: string): void {
  const current = loadLibrary()
  if (!current[bookKey]) return
  const next = { ...current }
  delete next[bookKey]
  persistLibrary(next)
}
