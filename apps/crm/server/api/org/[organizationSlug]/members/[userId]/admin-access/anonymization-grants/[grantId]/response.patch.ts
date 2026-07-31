import { createError, readBody, setHeader } from 'h3'
import {
  parseAnonymizationGrantApproveInput,
  parseAnonymizationGrantRejectInput,
  throwAdministrativeAccessDbError,
} from '~~/server/utils/administrative-access'
import {
  asRecord,
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  requireOrganizationMember,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

const allowedBodyKeys = new Set([
  'action',
  'expectedRevision',
  'idempotencyKey',
  'reason',
])

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const userId = uuidValue(getRequiredParam(event, 'userId'), 'userId')
  const grantId = uuidValue(getRequiredParam(event, 'grantId'), 'grantId')
  const body = asRecord(await readBody(event))
  const unexpectedKey = Object.keys(body).sort().find(key => !allowedBodyKeys.has(key))
  if (unexpectedKey) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported field in body: ${unexpectedKey}`,
    })
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    throw createError({
      statusCode: 400,
      statusMessage: 'action must be approve or reject',
    })
  }
  const input = body.action === 'approve'
    ? parseAnonymizationGrantApproveInput({
        expectedRevision: body.expectedRevision,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason,
      })
    : parseAnonymizationGrantRejectInput({
        expectedRevision: body.expectedRevision,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason,
      })
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  await requireAdministrativePermission(session, 'privacy.grants.approve')

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
    'respond_crm_client_anonymization_execution_grant',
    {
      p_organization_id: session.organizationId,
      p_grant_id: grantId,
      p_expected_revision: input.expectedRevision,
      p_action: body.action,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    },
  )
  throwAdministrativeAccessDbError(error)

  return data
})
