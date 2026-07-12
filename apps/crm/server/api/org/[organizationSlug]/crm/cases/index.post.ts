import { readBody } from 'h3'
import {
  asRecord,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const clientId = requiredText(body.client_id, 'client_id')
  const title = requiredText(body.title, 'title')

  const { data: client, error: clientError } = await session.supabase
    .from('crm_clients')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', clientId)
    .maybeSingle()
  if (clientError || !client) throwDbError(clientError ?? { message: 'Client not found' }, 404)

  const { data, error } = await session.supabase
    .from('crm_cases')
    .insert({
      organization_id: session.organizationId,
      client_id: clientId,
      owner_user_id: textValue(body.owner_user_id) ?? session.userId,
      title,
      description: textValue(body.description) ?? null,
      status_code: textValue(body.status_code) ?? 'nowa',
      priority: textValue(body.priority) ?? 'normal',
      metadata: asRecord(body.metadata),
    })
    .select('*')
    .single()

  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: clientId,
    case_id: data.id,
    activity_type: 'case_created',
    title: 'Dodano sprawe',
    body: title,
  })

  return { data }
})
