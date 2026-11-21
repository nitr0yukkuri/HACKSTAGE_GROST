import { WORLDS } from '../data/worlds'
import type { LibraryState } from './library-store'

export interface ReadingLink {
  from: string
  to: string
  reason: 'shared-book' | 'reading-journey'
}

const parentById = new Map(
  WORLDS.map((world) => [world.id, world.parentId ?? world.id]),
)

const parentIds = new Set(
  WORLDS.filter((world) => world.level === 1).map((world) => world.id),
)

function parentsForBook(worldIds: string[]): string[] {
  return [...new Set(
    worldIds
      .map((id) => parentById.get(id))
      .filter((id): id is string => id !== undefined && parentIds.has(id)),
  )]
}

export function readingLinksForLibrary(
  library: LibraryState,
): ReadingLink[] {
  const readEntries = Object.entries(library)
    .filter(([, entry]) => entry.status === 'read')
    .sort((a, b) =>
      a[1].savedAt - b[1].savedAt || a[0].localeCompare(b[0]),
    )

  const links = new Map<string, ReadingLink>()

  const addLink = (
    a: string,
    b: string,
    reason: ReadingLink['reason'],
  ) => {
    if (a === b) return

    const [from, to] = [a, b].sort()
    const key = `${from}:${to}`
    const previous = links.get(key)

    if (!previous || reason === 'shared-book') {
      links.set(key, { from, to, reason })
    }
  }

  // 1冊が複数の大ジャンルに属する場合の接続
  for (const [, entry] of readEntries) {
    const parents = parentsForBook(entry.book.worldIds)

    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        addLink(parents[i], parents[j], 'shared-book')
      }
    }
  }

  // 保存日時順で隣り合う読了本の分野を接続する暫定処理
  for (let i = 1; i < readEntries.length; i++) {
    const previous = parentsForBook(readEntries[i - 1][1].book.worldIds)
    const current = parentsForBook(readEntries[i][1].book.worldIds)

    for (const from of previous) {
      for (const to of current) {
        addLink(from, to, 'reading-journey')
      }
    }
  }

  return [...links.values()]
}
