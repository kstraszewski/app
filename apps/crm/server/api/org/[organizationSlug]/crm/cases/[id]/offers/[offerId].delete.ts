import { serverDataBackend } from '~~/server/utils/data-api'
import { createError } from 'h3'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const offerId = getRequiredParam(event, 'offerId')

  const { data: application, error: applicationError } = await session.dataApi
    .from('crm_case_bank_applications')
    .select('submission_id')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('offer_id', offerId)
    .maybeSingle()
  throwDbError(applicationError)
  if (application) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Oferta jest używana przez wniosek bankowy. Najpierw wycofaj lub usuń wniosek.',
    })
  }

  // The database only allows the trusted server to mutate frozen offer
  // snapshots. Membership, case ownership and application usage were checked
  // above before elevating this narrowly-scoped delete.
  const backendData = serverDataBackend(event) as any
  const { data, error } = await backendData
    .from('crm_case_offer_snapshots')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', offerId)
    .select('id')
    .maybeSingle()
  throwDbError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Saved offer not found' })

  return { data }
})
