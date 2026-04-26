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

  const patch: Record<string, unknown> = {}
  for (const field of ['title', 'description', 'status_code', 'priority'] as const) {
    if (field in body) patch[field] = textValue(body[field]) ?? null
  }
  if ('owner_user_id' in body) patch.owner_user_id = textValue(body.owner_user_id) ?? null
  if ('progress_percent' in body) patch.progress_percent = numberValue(body.progress_percent) ?? 0
  if ('closed_at' in body) patch.closed_at = textValue(body.closed_at) ?? null
  if ('metadata' in body) patch.metadata = asRecord(body.metadata)

  const { data, error } = await session.supabase
    .from('crm_cases')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  throwDbError(error)

  if ('status_code' in patch) {
    await recordCrmActivity(session, {
      client_id: data.client_id,
      case_id: id,
      activity_type: 'status_changed',
      title: 'Zmieniono status sprawy',
      payload: { status_code: patch.status_code },
    })
  }

  return { data }
})

