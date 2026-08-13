import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyIntermediarySettings } from '../shared/intermediary-settings.ts'
import {
  applyIntermediaryCooperatingLenderSelection,
  applyIntermediaryLenderSelection,
  buildIntermediaryLenders,
} from '../server/utils/intermediary-lenders.ts'

test('builds a sorted bank catalogue using the active legal-name alias', () => {
  const lenders = buildIntermediaryLenders(
    [
      { id: 'bank-b', name: 'Bank Beta' },
      { id: 'bank-a', name: 'Bank Alfa' },
      { id: 'bank-a', name: 'Duplikat techniczny' },
      { id: '', name: 'Brak identyfikatora' },
    ],
    [
      {
        bank_id: 'bank-b',
        value: 'Beta Bank Spółka Akcyjna',
        valid_from: '2025-01-01',
        valid_to: null,
      },
      {
        bank_id: 'bank-b',
        value: 'Przyszła nazwa Beta Bank',
        valid_from: '2027-01-01',
        valid_to: null,
      },
      {
        bank_id: 'bank-a',
        value: 'Nieaktualna nazwa Alfa Bank',
        valid_from: '2020-01-01',
        valid_to: '2024-12-31',
      },
    ],
    '2026-08-13',
  )

  assert.deepEqual(lenders, [
    { id: 'bank-a', name: 'Bank Alfa' },
    { id: 'bank-b', name: 'Beta Bank Spółka Akcyjna' },
  ])
})

test('resolves selected ids to a canonical, deduplicated legal-name snapshot', () => {
  const settings = createEmptyIntermediarySettings()
  settings.relationship.lenderBankIds = ['bank-b', 'missing', 'bank-a', 'bank-b']
  settings.relationship.lenderNames = ['Nazwa podana przez klienta API']

  const selection = applyIntermediaryLenderSelection(settings, [
    { id: 'bank-a', name: 'Wspólna nazwa banku' },
    { id: 'bank-b', name: ' wspólna nazwa banku ' },
    { id: 'bank-c', name: 'Inny bank' },
  ])

  assert.deepEqual(selection.invalidIds, ['missing'])
  assert.deepEqual(selection.settings.relationship.lenderBankIds, ['bank-a', 'bank-b'])
  assert.deepEqual(selection.settings.relationship.lenderNames, ['Wspólna nazwa banku'])
})

test('resolves the cooperation snapshot without changing the represented lender list', () => {
  const settings = createEmptyIntermediarySettings()
  settings.relationship.cooperatingLenderBankIds = ['bank-c', 'missing', 'bank-a']
  settings.relationship.cooperatingLenderNames = ['Nazwa przesłana przez klienta API']
  settings.relationship.lenderBankIds = ['bank-b']
  settings.relationship.lenderNames = ['Historyczna nazwa reprezentowanego banku']

  const selection = applyIntermediaryCooperatingLenderSelection(settings, [
    { id: 'bank-a', name: 'Bank Alfa S.A.' },
    { id: 'bank-b', name: 'Bank Beta S.A.' },
    { id: 'bank-c', name: 'Bank Gamma S.A.' },
  ])

  assert.deepEqual(selection.invalidIds, ['missing'])
  assert.deepEqual(
    selection.settings.relationship.cooperatingLenderBankIds,
    ['bank-a', 'bank-c'],
  )
  assert.deepEqual(
    selection.settings.relationship.cooperatingLenderNames,
    ['Bank Alfa S.A.', 'Bank Gamma S.A.'],
  )
  assert.deepEqual(selection.settings.relationship.lenderBankIds, ['bank-b'])
  assert.deepEqual(
    selection.settings.relationship.lenderNames,
    ['Historyczna nazwa reprezentowanego banku'],
  )
})
