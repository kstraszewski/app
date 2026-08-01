import { createError, readBody, setHeader } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import { updateClientPortalAccess } from '~~/server/utils/client-portal-access'
import { asRecord, getRequiredParam, requireCrmSession } from '~~/server/utils/crm'

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a boolean` })
  }
  return value
}

function expectedRevision(value: unknown): number {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw createError({ statusCode: 400, statusMessage: 'expected_revision must be a non-negative integer' })
  }
  return revision
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const body = asRecord(await readBody(event))
  const portalEnabled = requiredBoolean(body.portal_enabled, 'portal_enabled')
  const multiformEnabled = requiredBoolean(body.multiform_enabled, 'multiform_enabled')
  const resendInvitation = body.resend_invitation === undefined
    ? false
    : requiredBoolean(body.resend_invitation, 'resend_invitation')
  if (multiformEnabled && !portalEnabled) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Multiwniosek można udostępnić dopiero po włączeniu panelu klienta.',
    })
  }

  setHeader(event, 'Cache-Control', 'private, no-store')
  return updateClientPortalAccess(event, session, caseId, {
    portalEnabled,
    multiformEnabled,
    expectedRevision: expectedRevision(body.expected_revision),
    resendInvitation,
  })
})
