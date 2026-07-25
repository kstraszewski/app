import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalJson,
  semanticVersionDigest,
} from '../scripts/sync-mortgage-catalog.mjs'

test('kanonizuje obiekty niezależnie od kolejności kluczy', () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: 2, a: 1 } }),
    canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }),
  )
})

test('hash wersji ignoruje klucz techniczny, ale wykrywa zmianę parametrów', () => {
  const version = {
    versionKey: 'bank-product-2026-07-25',
    fixedRatePct: 6.25,
    requirements: [{ code: 'income', required: true }],
  }

  assert.equal(
    semanticVersionDigest(version),
    semanticVersionDigest({ ...version, versionKey: 'renamed-key' }),
  )
  assert.notEqual(
    semanticVersionDigest(version),
    semanticVersionDigest({ ...version, fixedRatePct: 6.35 }),
  )
})
