import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanMortgageBankFileSearchSnippet,
  mortgageBankFileSearchMatch,
  normalizeMortgageBankFileSearchText,
} from '../server/utils/mortgage-bank-file-search.ts'

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
