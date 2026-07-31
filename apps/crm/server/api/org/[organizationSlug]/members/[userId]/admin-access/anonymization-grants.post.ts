import { readBody, setHeader } from 'h3'
import {
  parseAnonymizationGrantCreateInput,
  throwAdministrativeAccessDbError,
} from '~~/server/utils/administrative-access'
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
  const input = parseAnonymizationGrantCreateInput(await readBody(event))
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  await requireAdministrativePermission(session, 'privacy.grants.request')

  const { data, error } = await session.dataApi.rpc(
    'request_crm_client_anonymization_execution_grant',
    {
      p_organization_id: session.organizationId,
      p_request_id: input.requestId,
      p_grantee_user_id: userId,
      p_approver_user_id: input.approverUserId,
      p_justification: input.justification,
      p_expires_at: input.expiresAt,
      p_idempotency_key: input.idempotencyKey,
    },
  )
  throwAdministrativeAccessDbError(error)

  return data
})
