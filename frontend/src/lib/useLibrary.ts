'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LIBRARY_CHANGE_EVENT,
  LIBRARY_STORAGE_KEY,
  loadLibrary,
  removeBook,
  resetLibraryFallback,
  saveBook,
  setBookReadStatus,
  type LibraryState,
  type ReadingStatus,
} from './library-store'
import type { Book } from '../types/hoshirube'

export default function useLibrary() {
  const [entries, setEntries] = useState<LibraryState>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sync = () => setEntries(loadLibrary())
    const onStorage = (event: StorageEvent) => {
      if (event.key === null) resetLibraryFallback()
      if (event.key === LIBRARY_STORAGE_KEY || event.key === null) sync()
    }

    sync()
    setReady(true)
    window.addEventListener(LIBRARY_CHANGE_EVENT, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(LIBRARY_CHANGE_EVENT, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const save = useCallback((book: Book, themeId?: string) => saveBook(book, themeId), [])
  const setReadStatus = useCallback((bookId: string, status: ReadingStatus) => setBookReadStatus(bookId, status), [])
  const remove = useCallback((bookId: string) => removeBook(bookId), [])

  return { entries, ready, save, setReadStatus, remove }
}
