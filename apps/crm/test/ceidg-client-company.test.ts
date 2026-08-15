import assert from 'node:assert/strict'
import test from 'node:test'

import type { CeidgCompanyData } from '../shared/types/ceidg-company.ts'
import {
  ceidgClientCompanySummary,
  mergeCeidgCompanyIntoClientMetadata,
  preserveCeidgClientCompanyMetadata,
  sanitizeCeidgClientCompanyMetadataInput,
  stripCeidgClientCompanyMetadata,
} from '../shared/utils/ceidg-client-company.ts'

const company: CeidgCompanyData = {
  ceidgId: 'company-id',
  name: 'Przykładowa firma',
  nip: '5260250274',
  regon: '123456789',
  legalForm: 'Jednoosobowa działalność gospodarcza',
  status: 'AKTYWNY',
  businessAddress: 'Prosta 1, 00-001 Warszawa, Polska',
  correspondenceAddress: '',
  startDate: '2020-01-02',
  suspensionDate: '',
  resumeDate: '',
  terminationDate: '',
  removalDate: '',
  mainPkd: { code: '62.01.Z', name: 'Działalność związana z oprogramowaniem' },
  pkd: [{ code: '62.01.Z', name: 'Działalność związana z oprogramowaniem' }],
  email: 'firma@example.com',
  phone: '+48 600 000 000',
  website: 'https://example.com',
}

const source = {
  provider: 'CEIDG' as const,
  apiVersion: 'v3' as const,
  retrievedAt: '2026-08-15T08:00:00.000Z',
}

test('stores searchable CEIDG identifiers and removes conflicting legacy identifiers', () => {
  const result = mergeCeidgCompanyIntoClientMetadata({
    client_type: 'company',
    krs: '0000123456',
    lead_score: 12,
    tax_id: '1111111111',
  }, company, source)

  assert.equal(result.lead_score, 12)
  assert.equal(result.client_type, 'company')
  assert.equal(result.nip, '5260250274')
  assert.equal(result.regon, '123456789')
  assert.equal(result.registry_name, 'Przykładowa firma')
  assert.equal(result.registry_number, 'company-id')
  assert.equal(result.registry_source, 'CEIDG')
  assert.equal(result.registry_api_version, 'v3')
  assert.equal('tax_id' in result, false)
  assert.equal('krs' in result, false)
  assert.deepEqual(result.pkd_codes, [{
    code: '62.01.Z',
    name: 'Działalność związana z oprogramowaniem',
  }])
})

test('refresh replaces stale CEIDG fields and summary reads the saved snapshot', () => {
  const result = mergeCeidgCompanyIntoClientMetadata({
    company_phone: 'stary numer',
    correspondence_address: 'stary adres',
    custom: true,
  }, { ...company, phone: '', correspondenceAddress: '' }, source)

  assert.equal('company_phone' in result, false)
  assert.equal('correspondence_address' in result, false)
  assert.equal(result.custom, true)
  assert.deepEqual(ceidgClientCompanySummary(result), {
    address: 'Prosta 1, 00-001 Warszawa, Polska',
    email: 'firma@example.com',
    legalForm: 'Jednoosobowa działalność gospodarcza',
    mainPkdCode: '62.01.Z',
    mainPkdName: 'Działalność związana z oprogramowaniem',
    name: 'Przykładowa firma',
    nip: '5260250274',
    phone: '',
    regon: '123456789',
    registryNumber: 'company-id',
    retrievedAt: '2026-08-15T08:00:00.000Z',
    status: 'AKTYWNY',
    website: 'https://example.com',
  })
})

test('does not present a NIP without the CEIDG source marker', () => {
  assert.equal(ceidgClientCompanySummary({ nip: '5260250274' }), null)
})

test('strips caller-controlled CEIDG provenance while retaining generic company metadata', () => {
  assert.deepEqual(stripCeidgClientCompanyMetadata({
    client_type: 'company',
    custom: true,
    krs: '0000123456',
    nip: '5260250274',
    registry_source: 'CEIDG',
    tax_id: '1111111111',
  }), {
    client_type: 'company',
    custom: true,
    krs: '0000123456',
    tax_id: '1111111111',
  })
})

test('retains generic identifiers but removes an unverified CEIDG provenance claim', () => {
  assert.deepEqual(sanitizeCeidgClientCompanyMetadataInput({
    client_type: 'company',
    nip: '5260250274',
    regon: '123456789',
    registry_name: 'Nazwa z innego procesu',
    registry_number: 'external-id',
    registry_source: ' ceidg ',
    registry_status: 'AKTYWNY',
    business_address: 'Podrobiony adres',
  }), {
    client_type: 'company',
    nip: '5260250274',
    regon: '123456789',
    registry_name: 'Nazwa z innego procesu',
    registry_number: 'external-id',
  })
})

test('leaves non-CEIDG company metadata unchanged', () => {
  const metadata = {
    client_type: 'company',
    nip: '5260250274',
    regon: '123456789',
    registry_number: 'external-id',
    registry_source: 'KRS',
  }
  assert.deepEqual(sanitizeCeidgClientCompanyMetadataInput(metadata), metadata)
})

test('preserves the persisted CEIDG snapshot instead of accepting forged registry fields', () => {
  const persisted = mergeCeidgCompanyIntoClientMetadata({ custom: 'old' }, company, source)
  const result = preserveCeidgClientCompanyMetadata({
    custom: 'new',
    krs: '0000123456',
    nip: '1111111111',
    registry_source: 'CEIDG',
    tax_id: '1111111111',
  }, persisted)

  assert.equal(result.custom, 'new')
  assert.equal(result.nip, company.nip)
  assert.equal(result.registry_name, company.name)
  assert.equal(result.registry_retrieved_at, source.retrievedAt)
  assert.equal('tax_id' in result, false)
  assert.equal('krs' in result, false)
})

test('allows ordinary company metadata to change when it is not a CEIDG snapshot', () => {
  assert.deepEqual(preserveCeidgClientCompanyMetadata({
    nip: '5260250274',
    registry_name: 'Nowa nazwa KRS',
    registry_source: 'KRS',
  }, {
    nip: '1111111111',
    registry_name: 'Stara nazwa KRS',
    registry_source: 'KRS',
  }), {
    nip: '5260250274',
    registry_name: 'Nowa nazwa KRS',
    registry_source: 'KRS',
  })
})
