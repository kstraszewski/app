import { readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const { data, error } = await session.supabase.rpc('add_organization_member_by_email', {
    organization_id: session.organizationId,
    email: requiredText(body.email, 'email').toLowerCase(),
    role: textValue(body.role) ?? 'expert',
  })

  throwDbError(error, error?.message === 'user_not_found' ? 404 : 500)
  return { data: Array.isArray(data) ? data[0] : data }
})
