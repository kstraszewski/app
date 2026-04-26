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

  const payload = {
    organization_id: session.organizationId,
    case_item_id: id,
    payer_provider_id: textValue(body.payer_provider_id) ?? null,
    status_code: textValue(body.status_code) ?? 'szacowane',
    expected_amount: numberValue(body.expected_amount) ?? 0,
    due_amount: numberValue(body.due_amount) ?? 0,
    paid_amount: numberValue(body.paid_amount) ?? 0,
    currency: textValue(body.currency) ?? 'PLN',
    due_date: textValue(body.due_date) ?? null,
    paid_at: textValue(body.paid_at) ?? null,
    notes: textValue(body.notes) ?? null,
    metadata: asRecord(body.metadata),
  }

  const { data, error } = await session.supabase
    .from('crm_case_item_settlements')
    .upsert(payload, { onConflict: 'case_item_id' })
    .select('*')
    .single()

  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: item.crm_cases?.client_id,
    case_id: item.case_id,
    case_item_id: id,
    activity_type: 'settlement_upserted',
    title: 'Zaktualizowano rozliczenie',
    payload,
  })

  return { data }
})

