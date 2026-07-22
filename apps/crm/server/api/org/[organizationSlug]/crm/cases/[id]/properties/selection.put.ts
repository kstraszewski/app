import { createError, readBody } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const propertyId = requiredText(body.property_id, 'property_id')

  if (!caseUuidPattern.test(caseId) || !caseUuidPattern.test(propertyId)) {
    throw createError({ statusCode: 404, statusMessage: 'Property not found' })
  }

  const [{ data: caseRow, error: caseError }, { data: property, error: propertyError }] = await Promise.all([
    session.supabase
      .from('crm_cases')
      .select('id, client_id')
      .eq('organization_id', session.organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    session.supabase
      .from('crm_properties')
      .select('id, address, city')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('id', propertyId)
      .maybeSingle(),
  ])
  throwDbError(caseError)
  throwDbError(propertyError)
  if (!caseRow) throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  if (!property) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  const { data, error } = await session.supabase
    .from('crm_case_property_selections')
    .upsert({
      organization_id: session.organizationId,
      case_id: caseId,
      property_id: propertyId,
      selected_by_user_id: session.userId,
      selected_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,case_id' })
    .select('case_id, property_id, selected_by_user_id, selected_at')
    .single()
  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: caseRow.client_id,
    case_id: caseId,
    activity_type: 'property_selected',
    title: 'Wybrano nieruchomość do finansowania',
    body: [property.address, property.city].filter(Boolean).join(', '),
    payload: { property_id: propertyId },
  })

  return { data }
})
