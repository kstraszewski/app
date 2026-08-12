import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, readBody, setHeader } from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import { serverAuth } from '~~/server/utils/platform-auth'
import {
  asRecord,
  requireLinkedClientPortalSession,
  requiredUuid,
} from '~~/server/utils/portal-auth'

function throwConsentMutationError(
  error: { code?: string } | null | undefined,
): never {
  const code = String(error?.code ?? '')

  if (code === 'P0002') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Consent not found',
      data: { code: 'CONSENT_NOT_FOUND' },
    })
  }
  if (code === '23514') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent is no longer active',
      data: { code: 'CONSENT_NOT_ACTIVE' },
    })
  }
  if (code === '23505') {
    throw createError({
      statusCode: 409,
      statusMessage: 'This request key has already been used',
      data: { code: 'IDEMPOTENCY_KEY_REUSED' },
    })
  }
  if (code === '22023') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid consent withdrawal request',
      data: { code: 'INVALID_REQUEST' },
    })
  }

  console.error('[client-portal] consent withdrawal failed', { code })
  throw createError({
    statusCode: 500,
    statusMessage: 'Consent could not be withdrawn',
  })
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')

  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const session = await requireLinkedClientPortalSession(event)
  const body = asRecord(await readBody(event))
  const organizationId = requiredUuid(body.organizationId, 'organizationId')
  const clientId = requiredUuid(body.clientId, 'clientId')
  const clientPersonId = requiredUuid(body.clientPersonId, 'clientPersonId')
  const definitionId = requiredUuid(body.definitionId, 'definitionId')
  const idempotencyKey = requiredUuid(body.idempotencyKey, 'idempotencyKey')

  const exactLink = session.links.some(link => (
    link.organizationId === organizationId
    && link.clientId === clientId
    && link.clientPersonId === clientPersonId
  ))
  if (!exactLink) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Consent not found',
      data: { code: 'CONSENT_NOT_FOUND' },
    })
  }

  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('withdraw_client_portal_consent', {
    p_auth_user_id: session.identity.userId,
    p_organization_id: organizationId,
    p_client_id: clientId,
    p_client_person_id: clientPersonId,
    p_definition_id: definitionId,
    p_idempotency_key: idempotencyKey,
  })
  if (result.error) throwConsentMutationError(result.error)

  return { data: result.data }
})
