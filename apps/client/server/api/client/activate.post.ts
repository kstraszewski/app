import { createError, readBody, setHeader } from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  asRecord,
  requirePortalIdentity,
  requiredUuid,
} from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const identity = await requirePortalIdentity(event)
  const body = asRecord(await readBody(event))
  const invitationId = requiredUuid(body.invitationId, 'invitationId')
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('claim_client_portal_invitation', {
    p_invitation_id: invitationId,
    p_auth_user_id: identity.userId,
  })

  if (result.error) {
    const code = String(result.error.code ?? '')
    if (code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'This customer profile is already linked to another account',
      })
    }
    if (code === 'P0002') {
      throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
    }
    console.error('[client-portal] invitation claim failed', {
      code,
      message: String(result.error.message ?? ''),
    })
    throw createError({
      statusCode: 500,
      statusMessage: 'Invitation could not be activated',
    })
  }

  return { data: result.data }
})
