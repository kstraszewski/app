import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeInstitutionSearch,
  searchInstitutions,
  type InstitutionSearchable,
} from '../app/utils/mortgage-institution-search.ts'

const institutions: InstitutionSearchable[] = [
  {
    id: 'erste',
    name: 'Erste Bank Polska',
    slug: 'erste',
    websiteUrl: 'https://www.erste.pl',
    aliases: [
      { name: 'Santander Bank Polska', kind: 'former_name', validTo: '2026-12-31' },
      { name: 'santander.pl', kind: 'former_domain' },
      { name: 'SBP', kind: 'short_name' },
    ],
  },
  {
    id: 'ing',
    name: 'ING Bank Śląski',
    slug: 'ing',
    websiteUrl: 'https://www.ing.pl',
  },
  {
    id: 'pekao',
    name: 'Bank Pekao',
    slug: 'pekao',
    websiteUrl: 'https://www.pekao.com.pl',
  },
]

test('normalizes Polish diacritics, punctuation and URL prefixes', () => {
  assert.equal(normalizeInstitutionSearch('  Łódzki Bank Śląski  '), 'lodzki bank slaski')
  assert.equal(normalizeInstitutionSearch('https://www.pekao.com.pl/oferta'), 'pekao com pl oferta')
})

test('searches current names without Polish diacritics', () => {
  const hits = searchInstitutions(institutions, 'bank slaski')
  assert.deepEqual(hits.map(hit => hit.item.id), ['ing'])
  assert.equal(hits[0]?.matchedOn?.source, 'name')
})

test('tolerates a typo in a historical name and explains the match', () => {
  const hits = searchInstitutions(institutions, 'santader')
  assert.deepEqual(hits.map(hit => hit.item.id), ['erste'])
  assert.deepEqual(hits[0]?.matchedOn, {
    source: 'former_name',
    label: 'Santander Bank Polska',
  })

  assert.equal(searchInstitutions(institutions, 'santnader').at(0)?.item.id, 'erste')
})

test('searches by domain, slug and short alias', () => {
  assert.equal(searchInstitutions(institutions, 'pekao.com').at(0)?.item.id, 'pekao')
  assert.equal(searchInstitutions(institutions, 'ing').at(0)?.item.id, 'ing')
  assert.equal(searchInstitutions(institutions, 'sbp').at(0)?.item.id, 'erste')
  assert.deepEqual(searchInstitutions(institutions, 'santander.pl').at(0)?.matchedOn, {
    source: 'former_domain',
    label: 'santander.pl',
  })
})

test('can combine tokens found in the current and former brands', () => {
  const hits = searchInstitutions(institutions, 'erste santander')
  assert.deepEqual(hits.map(hit => hit.item.id), ['erste'])
})

test('does not use typo matching for ambiguous three-character queries', () => {
  assert.deepEqual(searchInstitutions(institutions, 'ink'), [])
})
