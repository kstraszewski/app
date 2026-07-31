import { setHeader } from 'h3'
import { throwAdministrativeAccessDbError } from '~~/server/utils/administrative-access'
import {
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  requireOrganizationMember,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const userId = uuidValue(getRequiredParam(event, 'userId'), 'userId')
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  if (userId !== session.userId) {
    await requireAdministrativePermission(session, 'iam.members.read')
  }

  const { data, error } = await session.dataApi.rpc(
    'get_organization_user_admin_access',
    {
      p_organization_id: session.organizationId,
      p_user_id: userId,
    },
  )
  throwAdministrativeAccessDbError(error)

  return { data }
})
