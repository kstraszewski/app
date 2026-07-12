import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  stringArrayValue,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))

  const patch: Record<string, unknown> = {}
  for (const field of ['display_name', 'status_code', 'lead_source', 'primary_email', 'primary_phone', 'notes'] as const) {
    if (field in body) patch[field] = textValue(body[field]) ?? null
  }
  if ('owner_user_id' in body) {
    const ownerUserId = textValue(body.owner_user_id)
    if (!ownerUserId || !uuidPattern.test(ownerUserId)) {
      throw createError({ statusCode: 400, statusMessage: 'owner_user_id must be a UUID' })
    }
    if (session.role !== 'admin') {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only an organization administrator can change the client owner.',
      })
    }

    const { data: ownerMembership, error: ownerMembershipError } = await session.supabase
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', ownerUserId)
      .maybeSingle()
    throwDbError(ownerMembershipError)
    if (!ownerMembership) {
      throw createError({
        statusCode: 400,
        statusMessage: 'owner_user_id must identify a member of the organization',
      })
    }

    patch.owner_user_id = ownerUserId
  }
  if ('tags' in body) patch.tags = stringArrayValue(body.tags)
  if ('metadata' in body) patch.metadata = asRecord(body.metadata)

  const { data, error } = await session.supabase
    .from('crm_clients')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .select('*')
    .single()

  if (error?.message?.includes('client_owner_assignment_admin_required')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an organization administrator can change the client owner.',
    })
  }
  throwDbError(error)

  await recordCrmActivity(session, {
    client_id: id,
    activity_type: 'client_updated',
    title: 'Zaktualizowano klienta',
    payload: patch,
  })

  return { data }
})
