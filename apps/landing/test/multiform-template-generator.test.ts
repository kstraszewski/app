import assert from 'node:assert/strict'
import test from 'node:test'

import { compactCanonicalCatalog } from '@openexpert/multiform/template-generator'

interface CatalogItem {
  canonicalKey: string
  form?: { question: string, helpText?: string }
  semanticDescription: string
  semanticRole: string
  aiMappingHints: { aliases: string[], exclude: string[] }
  collection?: { key: string, index: number, displayIndex: number, relativeKey: string }
  computed?: boolean
  valueFrom?: string[]
  valueFormat?: string
}

test('serializes applicants 0-4 and the full semantic contract for the AI mapper', () => {
  const catalog = JSON.parse(compactCanonicalCatalog()) as CatalogItem[]
  const byKey = new Map(catalog.map(item => [item.canonicalKey, item]))

  const fifthPesel = byKey.get('applicants.4.pesel')
  assert.equal(fifthPesel?.collection?.index, 4)
  assert.equal(fifthPesel?.collection?.displayIndex, 5)
  assert.match(fifthPesel?.form?.question ?? '', /piątego wnioskodawcy/)
  assert.equal(fifthPesel?.semanticRole, 'person.identifier.pesel')
  assert.ok(fifthPesel?.aiMappingHints.aliases.includes('nr PESEL'))
  assert.ok(fifthPesel?.aiMappingHints.exclude.includes('numer dowodu'))

  const thirdFullName = byKey.get('applicants.2.fullName')
  assert.equal(thirdFullName?.computed, true)
  assert.deepEqual(thirdFullName?.valueFrom, [
    'applicants.2.firstName',
    'applicants.2.lastName',
  ])
  assert.equal(thirdFullName?.valueFormat, 'fullName')

  const submissionPlace = byKey.get('application.place')
  assert.match(submissionPlace?.semanticDescription ?? '', /formalnie składany/)
  assert.ok(submissionPlace?.aiMappingHints.exclude.includes('miejscowość nieruchomości'))
})
