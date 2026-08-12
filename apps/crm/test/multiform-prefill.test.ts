import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalDisbursementTypeFromIntake,
  canonicalLoanPurposeFromIntake,
  multiformApplicantDefaults,
  splitPolishStreetAddress,
} from '../app/utils/multiform-prefill.ts'

test('prefills applicant identity from the resolved person profile', () => {
  assert.deepEqual(
    multiformApplicantDefaults(
      { label: 'Aleksandra Maria Zielińska', pesel: '85821435745' },
      { primary_email: 'aleksandra@example.local', primary_phone: '+48123456789' },
    ),
    {
      firstName: 'Aleksandra',
      lastName: 'Maria Zielińska',
      pesel: '85821435745',
      email: 'aleksandra@example.local',
      phone: '+48123456789',
      birthDate: '',
    },
  )
})

test('prefers structured names over splitting the display label', () => {
  assert.deepEqual(
    multiformApplicantDefaults({
      label: 'Anna Maria Kowalska',
      firstName: 'Anna Maria',
      lastName: 'Kowalska',
      pesel: null,
    }),
    {
      firstName: 'Anna Maria',
      lastName: 'Kowalska',
      pesel: '',
      email: '',
      phone: '',
      birthDate: '',
    },
  )
})

test('maps available intake answers to canonical form values', () => {
  assert.equal(canonicalLoanPurposeFromIntake('purchase_primary'), 'purchase_primary')
  assert.equal(canonicalLoanPurposeFromIntake('refinance'), 'refinancing')
  assert.equal(canonicalLoanPurposeFromIntake(null), undefined)
  assert.equal(canonicalDisbursementTypeFromIntake(true), 'tranches')
  assert.equal(canonicalDisbursementTypeFromIntake(false), 'single')
  assert.equal(canonicalDisbursementTypeFromIntake(null), undefined)
})

test('splits a Polish street line without guessing missing address parts', () => {
  assert.deepEqual(splitPolishStreetAddress('ul. Bukowska 12A/34, 60-812 Poznań'), {
    street: 'Bukowska',
    houseNumber: '12A',
    unitNumber: '34',
  })
  assert.deepEqual(splitPolishStreetAddress('Rynek Główny'), {
    street: 'Rynek Główny',
    houseNumber: '',
    unitNumber: '',
  })
})
