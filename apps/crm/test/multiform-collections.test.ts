import assert from 'node:assert/strict'
import test from 'node:test'

import {
  changeCollectionCount,
  collectionState,
  normalizeCollectionActiveIndex,
  supportedCollectionItemCount,
} from '../app/utils/multiform-collections.ts'

test('supports a zero-minimum empty collection and opens the first added item', () => {
  const bounds = { minItems: 0, maxItems: 3 }
  const empty = collectionState(undefined, null, bounds)

  assert.deepEqual(empty, {
    count: 0,
    activeIndex: null,
    canAdd: true,
    canRemove: false,
  })
  assert.deepEqual(changeCollectionCount(empty, bounds, 'add'), {
    count: 1,
    activeIndex: 0,
    canAdd: true,
    canRemove: true,
  })
})

test('activates a newly added item and clamps the tab after removal', () => {
  const bounds = { minItems: 1, maxItems: 3 }
  const initial = collectionState(2, 0, bounds)
  const added = changeCollectionCount(initial, bounds, 'add')

  assert.equal(added.count, 3)
  assert.equal(added.activeIndex, 2)
  assert.equal(added.canAdd, false)

  const removed = changeCollectionCount(added, bounds, 'remove')
  assert.equal(removed.count, 2)
  assert.equal(removed.activeIndex, 1)
  assert.equal(removed.canRemove, true)
  assert.equal(normalizeCollectionActiveIndex(99, 2), 1)
})

test('never removes below minItems or adds above the supported maximum', () => {
  const bounds = { minItems: 1, maxItems: 2 }
  const minimum = collectionState(1, 0, bounds)
  const maximum = collectionState(2, 1, bounds)

  assert.deepEqual(changeCollectionCount(minimum, bounds, 'remove'), minimum)
  assert.deepEqual(changeCollectionCount(maximum, bounds, 'add'), maximum)
})

test('counts only contiguous item indexes exposed by prepared fields', () => {
  const fields = [
    { collection: { key: 'tranches', index: 0 } },
    { collection: { key: 'tranches', index: 1 } },
    { collection: { key: 'tranches', index: 3 } },
    { collection: { key: 'applicants', index: 0 } },
  ]

  assert.equal(supportedCollectionItemCount('tranches', 6, fields), 2)
  assert.equal(supportedCollectionItemCount('fees', 4, fields), 0)
})
