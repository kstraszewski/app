import { readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requireOrganizationAdmin,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const teamId = getRequiredParam(event, 'teamId')
  const body = asRecord(await readBody(event))
  const patch: Record<string, unknown> = {}

  for (const field of ['name', 'slug', 'kind', 'description'] as const) {
    if (field in body) patch[field] = textValue(body[field]) ?? null
  }

  const { data, error } = await session.supabase
    .from('teams')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('id', teamId)
    .select('*')
    .single()

  throwDbError(error, 404)
  return { data }
})
