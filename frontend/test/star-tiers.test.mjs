import assert from 'node:assert/strict'
import { test } from 'node:test'
import { starTiersFor } from '../src/lib/star-tiers.ts'

const worlds = [
  { id: 'phi', level: 1 },
  { id: 'soc', level: 1 },
  { id: 'tec', level: 1 },
  { id: 'phi-logic', level: 2 },
]

test('黄色の完読星は一等星、水色のつながり先は二等星、それ以外は三等星', () => {
  const tiers = starTiersFor(worlds, new Set(['phi']), new Set(['soc']), null)
  assert.equal(tiers.phi, 2)
  assert.equal(tiers.soc, 1)
  assert.equal(tiers.tec, 0)
})

test('選択した黄色の星は一等星になり、選択を移すと元の星の等級へ戻る', () => {
  const before = starTiersFor(worlds, new Set(), new Set(), 'phi')
  const after = starTiersFor(worlds, new Set(), new Set(), 'tec')
  assert.equal(before.phi, 2)
  assert.equal(after.phi, 0)
  assert.equal(after.tec, 2)
})

test('つながり先は選択中も水色の二等星、完読したら黄色の一等星にする', () => {
  const cyan = starTiersFor(worlds, new Set(), new Set(['soc']), 'soc')
  const yellow = starTiersFor(worlds, new Set(['soc']), new Set(['soc']), 'soc')
  assert.equal(cyan.soc, 1)
  assert.equal(yellow.soc, 2)
})

test('中ジャンルも自身の色で判定し、親の一等星を引き継がない', () => {
  const cyan = starTiersFor(worlds, new Set(['phi']), new Set(), null)
  assert.equal(cyan['phi-logic'], 1)
  const yellow = starTiersFor(worlds, new Set(['phi', 'phi-logic']), new Set(), null)
  assert.equal(yellow['phi-logic'], 2)
})

test('完読取消・つながり解除を反映し、過去の等級を残さない', () => {
  const before = starTiersFor(worlds, new Set(['phi']), new Set(['soc']), null)
  const after = starTiersFor(worlds, new Set(), new Set(), null)
  assert.equal(before.phi, 2)
  assert.equal(before.soc, 1)
  assert.equal(after.phi, 0)
  assert.equal(after.soc, 0)
})
