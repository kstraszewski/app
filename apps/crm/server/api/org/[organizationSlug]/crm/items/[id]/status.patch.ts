import { readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const statusCode = requiredText(body.status_code, 'status_code')
  const patch: Record<string, unknown> = { status_code: statusCode }
  if (statusCode === 'uruchomiony' || statusCode === 'aktywna' || statusCode === 'zamknieta') {
    patch.won_at = new Date().toISOString()
  }
  if (statusCode === 'utracony' || statusCode === 'utracona') {
    patch.lost_at = new Date().toISOString()
  }

  const { data, error } = await session.dataApi
    .from('crm_case_items')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .select('*, crm_cases(client_id)')
    .single()

  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: data.crm_cases?.client_id,
    case_id: data.case_id,
    case_item_id: id,
    activity_type: 'status_changed',
    title: 'Zmieniono status produktu',
    body: textValue(body.note),
    payload: { status_code: statusCode },
  })

  return { data }
})
