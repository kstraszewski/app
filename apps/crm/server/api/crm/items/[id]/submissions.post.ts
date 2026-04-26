import { readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  numberValue,
  recordCrmActivity,
  requireCrmSession,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))

  const { data: item, error: itemError } = await session.supabase
    .from('crm_case_items')
    .select('id, case_id, crm_cases(client_id)')
    .eq('id', id)
    .single()
  throwDbError(itemError, 404)

  const { data, error } = await session.supabase
    .from('crm_item_submissions')
    .insert({
      organization_id: session.organizationId,
      case_item_id: id,
      provider_id: textValue(body.provider_id) ?? null,
      status_code: textValue(body.status_code) ?? 'draft',
      external_reference: textValue(body.external_reference) ?? null,
      submitted_at: textValue(body.submitted_at) ?? null,
      decision_at: textValue(body.decision_at) ?? null,
      offered_amount: numberValue(body.offered_amount) ?? null,
      premium_amount: numberValue(body.premium_amount) ?? null,
      currency: textValue(body.currency) ?? 'PLN',
      notes: textValue(body.notes) ?? null,
      metadata: asRecord(body.metadata),
    })
    .select('*')
    .single()

  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: item.crm_cases?.client_id,
    case_id: item.case_id,
    case_item_id: id,
    submission_id: data.id,
    activity_type: 'submission_created',
    title: 'Dodano zgloszenie do instytucji',
    body: textValue(body.notes),
  })

  return { data }
})

