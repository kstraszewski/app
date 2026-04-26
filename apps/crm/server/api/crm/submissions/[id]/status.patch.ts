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
  if (['zaakceptowane', 'odrzucone', 'wycofane'].includes(statusCode)) {
    patch.decision_at = new Date().toISOString()
  }
  if (textValue(body.notes)) {
    patch.notes = textValue(body.notes)
  }

  const { data, error } = await session.supabase
    .from('crm_item_submissions')
    .update(patch)
    .eq('id', id)
    .select('*, crm_case_items(case_id, crm_cases(client_id))')
    .single()

  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: data.crm_case_items?.crm_cases?.client_id,
    case_id: data.crm_case_items?.case_id,
    case_item_id: data.case_item_id,
    submission_id: id,
    activity_type: 'status_changed',
    title: 'Zmieniono status zgloszenia',
    body: textValue(body.note),
    payload: { status_code: statusCode },
  })

  return { data }
})
