import { createError, readBody } from 'h3'
import { asRecord, getRequiredParam, requireCrmSession, requiredText, throwDbError } from '~~/server/utils/crm'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const offerId = requiredText(body.offer_id, 'offer_id')
  assertUuid(offerId, 'offer_id')
  await requireCrmCase(session, caseId)

  const { data: application, error: applicationError } = await session.supabase
    .from('crm_case_bank_applications')
    .select('offer_id')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('offer_id', offerId)
    .maybeSingle()
  throwDbError(applicationError)
  if (!application) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Najpierw dodaj tę ofertę do równoległych wniosków bankowych.',
    })
  }

  const { data, error } = await session.supabase
    .from('crm_case_offer_selections')
    .upsert({
      organization_id: session.organizationId,
      case_id: caseId,
      offer_id: offerId,
      selected_by_user_id: session.userId,
      selected_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,case_id' })
    .select('case_id, offer_id, selected_by_user_id, selected_at')
    .single()
  throwDbError(error)
  return { data }
})
