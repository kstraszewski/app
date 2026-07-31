import { createError, readBody, setHeader } from 'h3'
import { throwAdministrativeAccessDbError } from '~~/server/utils/administrative-access'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

const allowedBodyKeys = new Set([
  'grantId',
  'expectedRevision',
  'idempotencyKey',
  'confirmation',
])

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const requestId = uuidValue(
    getRequiredParam(event, 'requestId'),
    'requestId',
  )
  const body = asRecord(await readBody(event))
  const unsupportedField = Object.keys(body)
    .filter(key => !allowedBodyKeys.has(key))
    .sort()[0]

  if (unsupportedField) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported field in body: ${unsupportedField}`,
    })
  }

  const grantId = uuidValue(body.grantId, 'grantId')
  const idempotencyKey = uuidValue(body.idempotencyKey, 'idempotencyKey')
  const expectedRevision = body.expectedRevision
  if (
    typeof expectedRevision !== 'number'
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 1
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'expectedRevision must be a positive safe integer',
    })
  }

  if (body.confirmation !== 'ANONIMIZUJ') {
    throw createError({
      statusCode: 400,
      statusMessage: 'confirmation must equal ANONIMIZUJ',
    })
  }

  setHeader(event, 'Cache-Control', 'private, no-store')

  const { data, error } = await session.dataApi.rpc(
    'execute_crm_client_anonymization_request',
    {
      p_organization_id: session.organizationId,
      p_request_id: requestId,
      p_grant_id: grantId,
      p_expected_revision: expectedRevision,
      p_idempotency_key: idempotencyKey,
      p_confirmation: body.confirmation,
    },
  )
  throwAdministrativeAccessDbError(error)

  return data
})
