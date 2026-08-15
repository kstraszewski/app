import { getQuery, setHeader } from 'h3'
import type { CeidgCompanyLookupResponse } from '#shared/types/ceidg-company'
import { parseCompanyLookupQuery } from '~~/server/utils/ceidg-company'
import { lookupConfiguredCeidgCompany } from '~~/server/utils/ceidg-company-runtime'
import { assertCeidgLookupRateLimit } from '~~/server/utils/ceidg-rate-limit'
import { requireCaseMultiformSelection } from '~~/server/utils/case-multiform'

export default defineEventHandler(async (event): Promise<CeidgCompanyLookupResponse> => {
  const selection = await requireCaseMultiformSelection(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  const nip = parseCompanyLookupQuery(getQuery(event) as Record<string, unknown>)
  await assertCeidgLookupRateLimit(event, selection.userId)
  const response = await lookupConfiguredCeidgCompany(event, nip)

  return response
})
