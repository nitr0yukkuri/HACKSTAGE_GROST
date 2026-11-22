import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  completedWorldIdsFor,
  loadWorldBookLists,
  rememberWorldBooks,
  resetWorldBookListsFallback,
  WORLD_BOOK_LISTS_STORAGE_KEY,
} from '../src/lib/reading-progress.ts'

const originalWindow = globalThis.window
const apiKeys = ['one', 'two', 'three'].map((id) => JSON.stringify(['google_books', id]))
const readLibrary = (keys) => Object.fromEntries(keys.map((key) => [key, { status: 'read' }]))
const mockStorage = () => {
  const items = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => items.set(key, value),
    },
  }
  return items
}

afterEach(() => {
  globalThis.window = originalWindow
  resetWorldBookListsFallback()
})

test('APIの最後の一冊を完読した時点で、その星だけを完読にする', () => {
  const lists = { mon: apiKeys, tec: ['another-book'], empty: [] }
  const library = readLibrary(apiKeys.slice(0, 2))
  library[apiKeys[2]] = { status: 'to_read' }
  assert.deepEqual([...completedWorldIdsFor(lists, library)], [])
  library[apiKeys[2]].status = 'read'
  assert.deepEqual([...completedWorldIdsFor(lists, library)], ['mon'])
})

test('同じIDのサンプル本を完読してもAPI本の完読には数えない', () => {
  const demoKeys = ['one', 'two', 'three'].map((id) => JSON.stringify(['local_demo', id]))
  assert.equal(completedWorldIdsFor({ mon: apiKeys }, readLibrary(demoKeys)).size, 0)
})

test('表示した本の組を保存し、再読み込み後も完読を復元する', () => {
  mockStorage()
  rememberWorldBooks('mon', apiKeys, {})
  resetWorldBookListsFallback()
  assert.deepEqual([...completedWorldIdsFor(loadWorldBookLists(), readLibrary(apiKeys))], ['mon'])
})

test('別の星へ移動しても、前の星の完読判定を保持する', () => {
  mockStorage()
  rememberWorldBooks('mon', apiKeys, {})
  const lists = rememberWorldBooks('tec', ['unread'], readLibrary(apiKeys))
  assert.deepEqual([...completedWorldIdsFor(lists, readLibrary(apiKeys))], ['mon'])
  assert.deepEqual(lists.tec, ['unread'])
})

test('APIの検索結果が変わっても完読した本の組を保持する', () => {
  mockStorage()
  rememberWorldBooks('mon', apiKeys, {})
  const lists = rememberWorldBooks('mon', ['new-result'], readLibrary(apiKeys))
  assert.deepEqual(lists.mon, apiKeys)
  assert.equal(completedWorldIdsFor(lists, readLibrary(apiKeys)).has('mon'), true)
})

test('未完読の星では、最新の表示内容を判定対象にする', () => {
  mockStorage()
  rememberWorldBooks('mon', apiKeys, {})
  const lists = rememberWorldBooks('mon', [apiKeys[0], 'new-result'], readLibrary(apiKeys.slice(0, 2)))
  assert.deepEqual(lists.mon, [apiKeys[0], 'new-result'])
  assert.equal(completedWorldIdsFor(lists, readLibrary(apiKeys)).has('mon'), false)
})

test('空のAPI結果では完読にせず、保存済みの組も消さない', () => {
  mockStorage()
  assert.deepEqual(rememberWorldBooks('mon', [], {}), {})
  rememberWorldBooks('mon', apiKeys, {})
  assert.deepEqual(rememberWorldBooks('mon', [], {}).mon, apiKeys)
})

test('完読を取り消したり本を削除したら、完読判定も解除する', () => {
  const lists = { mon: apiKeys }
  const library = readLibrary(apiKeys)
  library[apiKeys[0]].status = 'to_read'
  assert.equal(completedWorldIdsFor(lists, library).has('mon'), false)
  delete library[apiKeys[0]]
  assert.equal(completedWorldIdsFor(lists, library).has('mon'), false)
})

test('ストレージが使えなくても、このタブ内で判定できる', () => {
  globalThis.window = { localStorage: {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
  } }
  rememberWorldBooks('mon', apiKeys, {})
  assert.equal(completedWorldIdsFor(loadWorldBookLists(), readLibrary(apiKeys)).has('mon'), true)
})

test('保存データの不正な組を無視する', () => {
  const items = mockStorage()
  items.set(WORLD_BOOK_LISTS_STORAGE_KEY, JSON.stringify({ mon: apiKeys, tec: [42], soc: null, empty: [] }))
  assert.deepEqual(loadWorldBookLists(), { mon: apiKeys })
})
