import { readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  stringArrayValue,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))

  const patch: Record<string, unknown> = {}
  for (const field of ['display_name', 'status_code', 'lead_source', 'primary_email', 'primary_phone', 'notes'] as const) {
    if (field in body) patch[field] = textValue(body[field]) ?? null
  }
  if ('owner_user_id' in body) patch.owner_user_id = textValue(body.owner_user_id) ?? null
  if ('tags' in body) patch.tags = stringArrayValue(body.tags)
  if ('metadata' in body) patch.metadata = asRecord(body.metadata)

  const { data, error } = await session.supabase
    .from('crm_clients')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: id,
    activity_type: 'client_updated',
    title: 'Zaktualizowano klienta',
    payload: patch,
  })

  return { data }
})

