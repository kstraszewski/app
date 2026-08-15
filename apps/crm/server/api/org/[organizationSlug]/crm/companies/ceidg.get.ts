import { getQuery, setHeader } from 'h3'
import type { CeidgCompanyLookupResponse } from '#shared/types/ceidg-company'
import { parseCompanyLookupQuery } from '~~/server/utils/ceidg-company'
import { lookupConfiguredCeidgCompany } from '~~/server/utils/ceidg-company-runtime'
import { assertCeidgLookupRateLimit } from '~~/server/utils/ceidg-rate-limit'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event): Promise<CeidgCompanyLookupResponse> => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  const nip = parseCompanyLookupQuery(getQuery(event) as Record<string, unknown>)
  await assertCeidgLookupRateLimit(event, session.userId)
  const response = await lookupConfiguredCeidgCompany(event, nip)

  return response
})
