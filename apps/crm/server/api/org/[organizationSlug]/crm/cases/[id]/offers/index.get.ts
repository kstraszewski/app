import { assertUuid } from '~~/server/utils/case-documents'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  assertUuid(caseId, 'case id')

  const [caseResult, offersResult] = await Promise.all([
    session.dataApi
      .from('crm_cases')
      .select('title')
      .eq('organization_id', session.organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    session.dataApi
      .from('crm_case_offer_snapshots')
      .select('mortgage_product_id, version_key, scenario_snapshot')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .order('saved_at', { ascending: false }),
  ])
  throwDbError(caseResult.error)
  throwDbError(offersResult.error)
  if (!caseResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  return {
    data: {
      title: String(caseResult.data.title),
      offers: offersResult.data ?? [],
    },
  }
})
