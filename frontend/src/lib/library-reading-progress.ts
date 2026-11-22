import { WORLDS } from '../data/worlds'
import type { Book } from '../types/hoshirube'
import { classifyBook } from './book-classification'
import type { LibraryState } from './library-store'
import type { ReadEntry } from './recommendations'

export interface ReadingProgress {
  history: (ReadEntry & { book: Book })[]
  readWorldIds: Set<string>
  unlockedChildIds: Set<string>
  suggestedChildIds: Set<string>
}

const worldById = new Map(WORLDS.map((world) => [world.id, world]))

/** 保存済みの書誌を正本に、取得元によらず読了した分野を集計する。 */
export function readingProgressForLibrary(library: LibraryState): ReadingProgress {
  const history: ReadingProgress['history'] = []
  const readWorldIds = new Set<string>()
  const unlockedChildIds = new Set<string>()
  const suggestedChildIds = new Set<string>()

  for (const entry of Object.values(library)) {
    if (entry.status !== 'read') continue

    const classification = classifyBook(entry.book)
    const worldIds = [...new Set([
      ...entry.book.worldIds,
      ...classification.confirmedIds,
    ])].filter((id) => worldById.has(id))

    history.push({
      bookId: entry.book.id,
      readAt: entry.savedAt,
      book: { ...entry.book, worldIds },
    })

    for (const id of worldIds) {
      readWorldIds.add(id)
      const parentId = worldById.get(id)?.parentId
      if (parentId) {
        readWorldIds.add(parentId)
        unlockedChildIds.add(id)
      }
    }
    classification.suggestedIds.forEach((id) => suggestedChildIds.add(id))
  }

  // 別の読了本で確定した中ジャンルは、薄い候補の表示へ戻さない。
  unlockedChildIds.forEach((id) => suggestedChildIds.delete(id))
  return { history, readWorldIds, unlockedChildIds, suggestedChildIds }
}
