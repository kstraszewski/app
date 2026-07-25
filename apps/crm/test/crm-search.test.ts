import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCrmSearchQuery } from '../server/utils/search.ts'

test('normalizes formatted CRM identifiers to digits', () => {
  assert.equal(normalizeCrmSearchQuery('+48 501 210-101'), '48501210101')
  assert.equal(normalizeCrmSearchQuery('851-000-00-00'), '8510000000')
  assert.equal(normalizeCrmSearchQuery('850101 12345'), '85010112345')
})

test('preserves natural-language and short numeric searches', () => {
  assert.equal(normalizeCrmSearchQuery('  Paweł   Król  '), 'Paweł Król')
  assert.equal(normalizeCrmSearchQuery('Kredyt firmowy / dom'), 'Kredyt firmowy / dom')
  assert.equal(normalizeCrmSearchQuery('12'), '12')
  assert.equal(normalizeCrmSearchQuery('   '), undefined)
  assert.equal(normalizeCrmSearchQuery(undefined), undefined)
})
