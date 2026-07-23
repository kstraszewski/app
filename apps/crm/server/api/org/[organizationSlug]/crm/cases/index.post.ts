import { readBody } from 'h3'
import {
  asRecord,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  stringArrayValue,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import { caseUuidPattern } from '~~/server/utils/cases'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const title = requiredText(body.title ?? body.name, 'title')
  const legacyClientId = textValue(body.client_id)
  const clientIds = [...new Set([
    ...stringArrayValue(body.client_ids),
    ...(legacyClientId ? [legacyClientId] : []),
  ])]

  if (!clientIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'client_ids is required' })
  }
  if (clientIds.some(clientId => !caseUuidPattern.test(clientId))) {
    throw createError({ statusCode: 400, statusMessage: 'client_ids must contain UUIDs' })
  }

  const { data, error } = await session.supabase.rpc('create_crm_case_simple', {
    p_organization_id: session.organizationId,
    p_title: title,
    p_client_ids: clientIds,
    p_owner_user_id: session.userId,
  })
  throwDbError(error, error?.code === '22023' ? 400 : 500)

  await recordCrmActivity(session, {
    client_id: clientIds[0],
    case_id: data.id,
    activity_type: 'case_created',
    title: 'Dodano sprawę',
    body: title,
    payload: { client_ids: clientIds },
  })

  return { data }
})
