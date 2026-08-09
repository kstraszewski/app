import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CeidgApiError,
  fetchCeidgCompany,
  mapCeidgCompany,
  normalizeNip,
  parsePublicCompanyQuery,
} from '../server/utils/ceidg-company.ts'

test('normalizes a valid Polish NIP and verifies its checksum', () => {
  assert.equal(normalizeNip('526-025-02-74'), '5260250274')
  assert.throws(() => normalizeNip('5260250275'), /checksum/u)
  assert.throws(() => normalizeNip('PL5260250274'), /10 digits/u)
})

test('maps the CEIDG company record to the internal form contract', () => {
  const result = mapCeidgCompany({
    firma: [{
      id: 'ceidg-company-id',
      nazwa: 'Przykładowa firma Jan Kowalski',
      status: 'AKTYWNY',
      wlasciciel: { nip: '5260250274', regon: '123456789' },
      adresDzialalnosci: {
        ulica: 'Prosta',
        budynek: '1',
        lokal: '2',
        kod: '00-001',
        miasto: 'Warszawa',
        kraj: 'Polska',
      },
      adresKorespondencyjny: {
        ulica: 'Długa',
        nrDomu: '3',
        kodPocztowy: '00-002',
        miejscowosc: 'Warszawa',
      },
      dataRozpoczecia: '2020-01-02',
      dataZawieszenia: '2024-03-04',
      dataWznowienia: '2024-04-05',
      dataZaprzestania: '2025-06-07',
      dataWykreslenia: '2025-07-08',
      pkdGlowny: { kod: '6201Z', nazwa: 'Działalność związana z oprogramowaniem' },
      pkd: [
        { kod: '6201Z', nazwa: 'Działalność związana z oprogramowaniem' },
        { kod: '6202Z', nazwa: 'Doradztwo informatyczne' },
      ],
      email: 'firma@example.com',
      telefon: '+48123456789',
      www: 'https://example.com',
    }],
  }, '5260250274')

  assert.ok(result)
  assert.equal(result.name, 'Przykładowa firma Jan Kowalski')
  assert.equal(result.nip, '5260250274')
  assert.equal(result.regon, '123456789')
  assert.equal(result.businessAddress, 'Prosta 1/2, 00-001 Warszawa, Polska')
  assert.equal(result.correspondenceAddress, 'Długa 3, 00-002 Warszawa')
  assert.deepEqual(result.mainPkd, {
    code: '6201Z',
    name: 'Działalność związana z oprogramowaniem',
  })
  assert.equal(result.pkd.length, 2)
  assert.equal(result.legalForm, 'Jednoosobowa działalność gospodarcza')
})

test('accepts exactly one nip query parameter', () => {
  assert.equal(parsePublicCompanyQuery({ nip: '5260250274' }), '5260250274')
  assert.throws(
    () => parsePublicCompanyQuery({ nip: '5260250274', refresh: '1' }),
    /Exactly one query parameter/u,
  )
  assert.throws(
    () => parsePublicCompanyQuery({ nip: ['5260250274', '5260250274'] }),
    /provided once/u,
  )
})

test('forwards the complete CEIDG v3 response without reducing fields', async () => {
  const upstream = {
    firma: [{
      id: 'company-id',
      nazwa: 'Przykładowa firma',
      rokPkd: '2025',
      pkdGlowny: { kod: '6201Z', nazwa: 'Działalność związana z oprogramowaniem' },
      pkd: [{ kod: '6201Z', nazwa: 'Działalność związana z oprogramowaniem' }],
      zakazy: [{ typ: 'example', opis: 'pełny rekord pozostaje dostępny' }],
    }],
    properties: { 'dc:title': 'firma' },
  }
  let requestUrl = ''
  let authorization = ''
  const fetcher: typeof fetch = async (input, init) => {
    requestUrl = String(input)
    authorization = new Headers(init?.headers).get('Authorization') || ''
    return Response.json(upstream)
  }

  const result = await fetchCeidgCompany({
    apiBaseUrl: 'https://dane.biznes.gov.pl',
    fetcher,
    nip: '5260250274',
    token: 'secret-token',
  })

  assert.deepEqual(result, upstream)
  assert.equal(requestUrl, 'https://dane.biznes.gov.pl/api/ceidg/v3/firma?nip=5260250274')
  assert.equal(authorization, 'Bearer secret-token')
})

test('maps CEIDG empty and authorization responses without exposing details', async () => {
  const noContentFetcher: typeof fetch = async () => new Response(null, { status: 204 })
  assert.equal(await fetchCeidgCompany({
    apiBaseUrl: 'https://dane.biznes.gov.pl',
    fetcher: noContentFetcher,
    nip: '5260250274',
    token: 'secret-token',
  }), null)

  const unauthorizedFetcher: typeof fetch = async () => new Response('sensitive upstream body', { status: 401 })
  await assert.rejects(
    fetchCeidgCompany({
      apiBaseUrl: 'https://dane.biznes.gov.pl',
      fetcher: unauthorizedFetcher,
      nip: '5260250274',
      token: 'secret-token',
    }),
    (error: unknown) => error instanceof CeidgApiError
      && error.status === 503
      && !error.message.includes('sensitive upstream body'),
  )
})
