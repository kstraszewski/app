import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CeidgApiError,
  fetchCeidgCompany,
  lookupCeidgCompany,
  mapCeidgCompany,
  normalizeNip,
  parseCompanyLookupQuery,
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
  assert.equal(parseCompanyLookupQuery({ nip: '5260250274' }), '5260250274')
  assert.throws(
    () => parseCompanyLookupQuery({ nip: '5260250274', refresh: '1' }),
    /Exactly one query parameter/u,
  )
  assert.throws(
    () => parseCompanyLookupQuery({ nip: ['5260250274', '5260250274'] }),
    /provided once/u,
  )
})

test('returns the mapped private lookup contract and a sanitized not-found error', async () => {
  const result = await lookupCeidgCompany({
    apiBaseUrl: 'https://dane.biznes.gov.pl',
    fetcher: async () => Response.json({
      firma: [{
        id: 'company-id',
        nazwa: 'Przykładowa firma',
        wlasciciel: { nip: '5260250274' },
      }],
    }),
    nip: '5260250274',
    token: 'secret-token',
  })
  assert.equal(result.ceidgId, 'company-id')
  assert.equal(result.nip, '5260250274')

  await assert.rejects(
    lookupCeidgCompany({
      apiBaseUrl: 'https://dane.biznes.gov.pl',
      fetcher: async () => new Response(null, { status: 204 }),
      nip: '5260250274',
      token: 'secret-token',
    }),
    (error: unknown) => {
      const candidate = error as { statusCode?: number, statusMessage?: string }
      return candidate.statusCode === 404
        && candidate.statusMessage === 'Nie znaleziono firmy w CEIDG.'
    },
  )
})

test('rejects malformed or mismatched CEIDG company records', async () => {
  const lookup = (firma: Record<string, unknown>) => lookupCeidgCompany({
    apiBaseUrl: 'https://dane.biznes.gov.pl',
    fetcher: async () => Response.json({ firma: [firma] }),
    nip: '5260250274',
    token: 'secret-token',
  })

  for (const firma of [
    {},
    { id: 'company-id', nazwa: 'Firma bez NIP' },
    { id: 'company-id', nazwa: 'Inna firma', wlasciciel: { nip: '1111111111' } },
  ]) {
    await assert.rejects(lookup(firma), (error: unknown) => {
      const candidate = error as { statusCode?: number, statusMessage?: string }
      return candidate.statusCode === 502
        && candidate.statusMessage === 'CEIDG API returned an invalid company record'
    })
  }
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
