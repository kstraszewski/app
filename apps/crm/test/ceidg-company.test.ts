import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CeidgApiError,
  fetchCeidgCompany,
  normalizeNip,
  parsePublicCompanyQuery,
} from '../server/utils/ceidg-company.ts'

test('normalizes a valid Polish NIP and verifies its checksum', () => {
  assert.equal(normalizeNip('526-025-02-74'), '5260250274')
  assert.throws(() => normalizeNip('5260250275'), /checksum/u)
  assert.throws(() => normalizeNip('PL5260250274'), /10 digits/u)
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
