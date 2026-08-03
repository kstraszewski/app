import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanMortgageBankFileSearchSnippet,
  mortgageBankFileSearchMatch,
  normalizeMortgageBankFileSearchText,
} from '../server/utils/mortgage-bank-file-search.ts'
import { rankMortgageBankFileOmnisearchResults } from '../server/utils/mortgage-bank-file-omnisearch.ts'

const ingFileId = '00000000-0000-4000-8000-000000000001'
const mbankFileId = '00000000-0000-4000-8000-000000000002'
const ingBankId = '00000000-0000-4000-8000-000000000011'
const mbankBankId = '00000000-0000-4000-8000-000000000012'
const categoryId = '00000000-0000-4000-8000-000000000021'
const ingVersionId = '00000000-0000-4000-8000-000000000031'
const mbankVersionId = '00000000-0000-4000-8000-000000000032'

test('normalizes Polish diacritics before matching bank files', () => {
  assert.equal(
    normalizeMortgageBankFileSearchText('  WYPŁATA kredytu  '),
    'wyplata kredytu',
  )
})

test('matches an unfinished word against a document title', () => {
  assert.equal(
    mortgageBankFileSearchMatch('wnios', [
      'Wniosek o udzielenie kredytu mieszkaniowego',
    ]),
    true,
  )
})

test('matches every unfinished word in a multi-word query', () => {
  assert.equal(
    mortgageBankFileSearchMatch('wnios wypl', [
      'Wniosek o wypłatę transzy lub całości kredytu',
    ]),
    true,
  )
})

test('retains one-edit typo tolerance for complete words', () => {
  assert.equal(
    mortgageBankFileSearchMatch('wniosek kredytv', [
      'Wniosek o udzielenie kredytu mieszkaniowego',
    ]),
    true,
  )
})

test('does not treat ambiguous two-character input as a prefix', () => {
  assert.equal(
    mortgageBankFileSearchMatch('wn', [
      'Wniosek o udzielenie kredytu mieszkaniowego',
    ]),
    false,
  )
})

test('removes internal headline markers from a returned snippet', () => {
  assert.equal(
    cleanMortgageBankFileSearchSnippet(
      'na podstawie ,StopSel=wniosków</b> o udzielenie kredytu',
    ),
    'na podstawie wniosków o udzielenie kredytu',
  )
})

const omnisearchSource = {
  files: [{
    id: ingFileId,
    bank_id: ingBankId,
    category_id: categoryId,
    current_version_id: ingVersionId,
    title: 'Instrukcja oceny dochodu przedsiębiorcy',
    description: 'Procedura kredytowa',
    updated_at: '2026-08-03T12:00:00.000Z',
    storage_path: 'must-not-leak',
  }, {
    id: mbankFileId,
    bank_id: mbankBankId,
    category_id: categoryId,
    current_version_id: mbankVersionId,
    title: 'Wniosek o kredyt hipoteczny',
    updated_at: '2026-08-02T12:00:00.000Z',
  }],
  versions: [{
    id: ingVersionId,
    original_file_name: 'instrukcja-dochodu.pdf',
    status: 'current',
    extracted_text: 'must-not-leak',
  }, {
    id: mbankVersionId,
    original_file_name: 'wniosek-hipoteczny.pdf',
    status: 'current',
  }],
  banks: [
    { id: ingBankId, name: 'ING Bank Śląski' },
    { id: mbankBankId, name: 'mBank' },
  ],
  categories: [{ id: categoryId, label: 'Informacje ogólne' }],
  matches: [{
    file_id: ingFileId,
    snippet: 'słabszy fragment',
    locator: 's. 2',
    page_number: 2,
    score: 0.01,
  }, {
    file_id: ingFileId,
    snippet: 'najlepszy fragment o dochodzie',
    locator: 's. 4',
    page_number: 4,
    score: 0.03,
  }, {
    file_id: mbankFileId,
    snippet: 'semantycznie zbliżony fragment',
    locator: 's. 1',
    page_number: 1,
    score: 0.02,
  }],
}

test('deduplicates vector chunks and ranks a lexical bank-file hit first', () => {
  const results = rankMortgageBankFileOmnisearchResults(
    omnisearchSource,
    'dochód przedsiębiorcy',
    5,
  )

  assert.equal(results.length, 2)
  assert.equal(results[0]?.file_id, ingFileId)
  assert.equal(results[0]?.snippet, 'najlepszy fragment o dochodzie')
  assert.equal(results[0]?.page_number, 4)
  assert.equal(JSON.stringify(results).includes('must-not-leak'), false)
})

test('finds a bank file lexically by institution when embeddings are unavailable', () => {
  const results = rankMortgageBankFileOmnisearchResults({
    ...omnisearchSource,
    matches: [],
  }, 'ING', 5)

  assert.deepEqual(results.map(result => result.file_id), [ingFileId])
  assert.equal(results[0]?.bank_name, 'ING Bank Śląski')
})
