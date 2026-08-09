import { getQuery, setHeader } from 'h3'
import type { CeidgCompanyLookupResponse } from '#shared/types/ceidg-company'
import {
  CeidgApiError,
  fetchCeidgCompany,
  mapCeidgCompany,
  parsePublicCompanyQuery,
} from '~~/server/utils/ceidg-company'
import { requireCaseMultiformSelection } from '~~/server/utils/case-multiform'

export default defineEventHandler(async (event): Promise<CeidgCompanyLookupResponse> => {
  await requireCaseMultiformSelection(event)
  const nip = parsePublicCompanyQuery(getQuery(event) as Record<string, unknown>)
  const config = useRuntimeConfig(event)
  const ceidg = config.ceidg as { apiBaseUrl?: string, token?: string }

  let payload: Record<string, unknown> | null
  try {
    payload = await fetchCeidgCompany({
      apiBaseUrl: ceidg.apiBaseUrl || 'https://dane.biznes.gov.pl',
      nip,
      token: ceidg.token || '',
    })
  }
  catch (error) {
    if (error instanceof CeidgApiError) {
      throw createError({ statusCode: error.status, statusMessage: error.message })
    }
    throw error
  }

  const company = payload ? mapCeidgCompany(payload, nip) : null
  if (!company) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono firmy w CEIDG.' })
  }

  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return {
    company,
    source: {
      provider: 'CEIDG',
      apiVersion: 'v3',
      retrievedAt: new Date().toISOString(),
    },
  }
})
