const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')

// 既存のTypeScriptだけで純粋関数を読み込み、ブラウザや追加ランナーを不要にする。
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

const { readingProgressForLibrary } = require('../src/lib/reading-progress.ts')
const { applyReadHistory } = require('../src/lib/recommendations.ts')
const { libraryBookKey } = require('../src/lib/library-store.ts')

const book = (overrides = {}) => ({
  id: 'external-volume', source: 'google_books', title: 'VMware徹底入門', authors: [],
  coverUrl: null, description: null, recommendationReason: null, infoUrl: null,
  worldIds: ['tec'], ...overrides,
})
const library = (...books) => Object.fromEntries(books.map(item => [libraryBookKey(item), { book: item, status: 'read', savedAt: 100 }]))
const sorted = set => [...set].sort()

test('固定カタログにない実本も、1冊の完読で親の星とスコアへ反映する', () => {
  const progress = readingProgressForLibrary(library(book()))
  assert.deepEqual(sorted(progress.readWorldIds), ['tec'])
  assert.equal(progress.history.length, 1)
  assert.equal(progress.unlockedChildIds.size, 0)
  assert.deepEqual(applyReadHistory({ tec: 0 }, progress.history), { tec: 2 })
})

test('タイトルで確定した中ジャンルとその親を光らせ、紹介文だけの候補は光らせない', () => {
  const progress = readingProgressForLibrary(library(book({ title: '人工知能入門', description: '数学の紹介' })))
  assert.deepEqual(sorted(progress.readWorldIds), ['tec', 'tec-ai'])
  assert.deepEqual(sorted(progress.unlockedChildIds), ['tec-ai'])
  assert.deepEqual(sorted(progress.suggestedChildIds), ['sci-math'])
})

test('中ジャンルIDしかない本でも親が光り、不明なIDは進行に含めない', () => {
  const progress = readingProgressForLibrary(library(book({ worldIds: ['tec-prog', 'unknown'] })))
  assert.deepEqual(sorted(progress.readWorldIds), ['tec', 'tec-prog'])
  assert.deepEqual(progress.history[0].book.worldIds, ['tec-prog'])
})

test('読む予定の本は、タイトルが分類できても進行に含めない', () => {
  const state = library(book({ title: '人工知能入門' }))
  Object.values(state)[0].status = 'to_read'
  const progress = readingProgressForLibrary(state)
  assert.equal(progress.history.length, 0)
  assert.equal(progress.readWorldIds.size, 0)
  assert.equal(progress.unlockedChildIds.size, 0)
  assert.equal(progress.suggestedChildIds.size, 0)
})

test('別の読了本で確定した中ジャンルを、薄い候補へ戻さない', () => {
  const progress = readingProgressForLibrary(library(
    book({ id: 'suggestion', description: '人工知能の紹介' }),
    book({ id: 'confirmed', title: '人工知能入門' }),
  ))
  assert(progress.unlockedChildIds.has('tec-ai'))
  assert(!progress.suggestedChildIds.has('tec-ai'))
})

test('同じIDでも取得元の異なる本は別々に数え、同じ本の重複履歴は加点しない', () => {
  const progress = readingProgressForLibrary(library(book(), book({ source: 'local_demo' })))
  assert.deepEqual(applyReadHistory({ tec: 0 }, [...progress.history, ...progress.history]), { tec: 4 })
})

test('複数の分野を持つ実本でも、同じ親への二重加点はしない', () => {
  const progress = readingProgressForLibrary(library(book({ worldIds: ['tec', 'tec-prog', 'sci-space'] })))
  assert.deepEqual(applyReadHistory({ tec: 0, sci: 0 }, progress.history), { tec: 1, sci: 1 })
})

test('既存の保存形式の完読も反映し、未読へ戻す・削除すると発光対象から外れる', () => {
  const state = JSON.parse(JSON.stringify(library(book())))
  assert(readingProgressForLibrary(state).readWorldIds.has('tec'))
  Object.values(state)[0].status = 'to_read'
  assert.equal(readingProgressForLibrary(state).readWorldIds.size, 0)
  assert.equal(readingProgressForLibrary({}).readWorldIds.size, 0)
})

test('書誌を持たない従来のデモ履歴もスコアへ反映できる', () => {
  assert.deepEqual(applyReadHistory({ tec: 0 }, [{ bookId: 'pragmatic', readAt: 100 }]), { tec: 2 })
})
