import { createError, readBody, setHeader } from 'h3'
import {
  parseAnonymizationGrantRevokeInput,
  throwAdministrativeAccessDbError,
} from '~~/server/utils/administrative-access'
import {
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  requireOrganizationMember,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const userId = uuidValue(getRequiredParam(event, 'userId'), 'userId')
  const grantId = uuidValue(getRequiredParam(event, 'grantId'), 'grantId')
  const input = parseAnonymizationGrantRevokeInput(await readBody(event))
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  await requireAdministrativePermission(session, 'iam.grants.manage')

  const grantResult = await session.dataApi
    .from('crm_client_anonymization_execution_grants')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', grantId)
    .eq('grantee_user_id', userId)
    .maybeSingle()
  throwDbError(grantResult.error)
  if (!grantResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Anonymization grant not found' })
  }

  const { data, error } = await session.dataApi.rpc(
    'revoke_crm_client_anonymization_execution_grant',
    {
      p_organization_id: session.organizationId,
      p_grant_id: grantId,
      p_expected_revision: input.expectedRevision,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    },
  )
  throwAdministrativeAccessDbError(error)

  return data
})
