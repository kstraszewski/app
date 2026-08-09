import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ceidgCompanyPrefillValues,
  mergeCeidgCompanyIntoEmptyFields,
} from '../app/utils/ceidg-company-prefill.ts'

const company = {
  ceidgId: 'company-id',
  name: 'Przykładowa firma',
  nip: '5260250274',
  regon: '123456789',
  legalForm: 'Jednoosobowa działalność gospodarcza',
  status: 'AKTYWNY',
  businessAddress: 'Prosta 1, 00-001 Warszawa',
  correspondenceAddress: 'Długa 2, 00-002 Warszawa',
  startDate: '2020-01-02T00:00:00Z',
  suspensionDate: '',
  resumeDate: '',
  terminationDate: '',
  removalDate: '',
  mainPkd: { code: '6201Z', name: 'Działalność związana z oprogramowaniem' },
  pkd: [
    { code: '6201Z', name: 'Działalność związana z oprogramowaniem' },
    { code: '6202Z', name: 'Doradztwo informatyczne' },
  ],
  email: 'firma@example.com',
  phone: '+48123456789',
  website: 'https://example.com',
}

test('converts CEIDG data to applicant-relative Multiwniosek values', () => {
  const values = ceidgCompanyPrefillValues(company)

  assert.equal(values.businessNip, '5260250274')
  assert.equal(values.businessStartDate, '2020-01-02')
  assert.equal(values.pkdCode, '6201Z')
  assert.equal(
    values.businessPkdCodes,
    '6201Z — Działalność związana z oprogramowaniem\n6202Z — Doradztwo informatyczne',
  )
  assert.equal(values.businessActiveOrRecentlySuspended, true)
})

test('fills only empty available fields and preserves manually entered values', () => {
  const result = mergeCeidgCompanyIntoEmptyFields(
    {
      'applicants.1.businessName': 'Nazwa wpisana ręcznie',
      'applicants.1.businessNip': '5260250274',
      'applicants.1.businessRegon': '',
    },
    new Set([
      'applicants.1.businessName',
      'applicants.1.businessNip',
      'applicants.1.businessRegon',
    ]),
    1,
    company,
  )

  assert.equal(result.values['applicants.1.businessName'], 'Nazwa wpisana ręcznie')
  assert.equal(result.values['applicants.1.businessRegon'], '123456789')
  assert.equal(result.values['applicants.1.businessEmail'], undefined)
  assert.equal(result.filledCount, 1)
  assert.equal(result.preservedCount, 1)
})
