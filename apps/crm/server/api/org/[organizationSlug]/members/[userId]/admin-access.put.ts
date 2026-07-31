import { readBody, setHeader } from 'h3'
import {
  parseAdministrativeAccessPutInput,
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
  const input = parseAdministrativeAccessPutInput(await readBody(event))
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  await requireAdministrativePermission(session, 'iam.roles.manage')

  const consentGrant = input.consentPublishingGrant
  const { data, error } = await session.dataApi.rpc(
    'set_organization_user_admin_access',
    {
      p_organization_id: session.organizationId,
      p_user_id: userId,
      p_expected_revision: input.expectedRevision,
      p_idempotency_key: input.idempotencyKey,
      p_role_keys: input.roles,
      p_consent_publish: Boolean(consentGrant),
      p_consent_justification: consentGrant?.justification ?? null,
      p_consent_expires_at: consentGrant?.expiresAt ?? null,
      p_change_reason: input.changeReason,
    },
  )
  throwAdministrativeAccessDbError(error)

  return data
})
