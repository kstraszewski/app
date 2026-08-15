import { getQuery, setHeader } from 'h3'
import {
  CeidgApiError,
  fetchCeidgCompany,
  parseCompanyLookupQuery,
} from '~~/server/utils/ceidg-company'
import { assertCeidgLookupRateLimit } from '~~/server/utils/ceidg-rate-limit'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  const nip = parseCompanyLookupQuery(getQuery(event) as Record<string, unknown>)
  await assertCeidgLookupRateLimit(event)
  const config = useRuntimeConfig(event)
  const ceidg = config.ceidg as { apiBaseUrl?: string, token?: string }

  let payload: Record<string, unknown> | null
  try {
    payload = await fetchCeidgCompany({
      apiBaseUrl: ceidg.apiBaseUrl || 'https://dane.biznes.gov.pl',
      nip,
      token: ceidg.token || '',
    })
  } catch (error) {
    if (error instanceof CeidgApiError) {
      throw createError({ statusCode: error.status, statusMessage: error.message })
    }
    throw error
  }

  if (!payload) {
    throw createError({ statusCode: 404, statusMessage: 'Company was not found in CEIDG' })
  }

  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=3600')
  setHeader(event, 'Vercel-CDN-Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')

  return {
    nip,
    source: {
      apiVersion: 'v3',
      provider: 'CEIDG',
      retrievedAt: new Date().toISOString(),
    },
    data: payload,
  }
})
