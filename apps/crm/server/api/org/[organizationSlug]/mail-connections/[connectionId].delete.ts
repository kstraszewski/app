import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  loadUserMailConnection,
} from '~~/server/utils/mail-connections'
import {
  decryptMailSecret,
  revokeMailOAuthToken,
} from '~~/server/utils/mail-providers'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'

export default defineEventHandler(async (event) => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)
  const connectionId = getRequiredParam(event, 'connectionId')
  const { backendData, connection } = await loadUserMailConnection(event, session)
  if (!connection || connection.id !== connectionId) {
    throw createError({ statusCode: 404, statusMessage: 'Mail connection not found' })
  }

  try {
    const token = decryptMailSecret(
      event,
      connection.encrypted_refresh_token || connection.encrypted_access_token,
    )
    if (token) await revokeMailOAuthToken(token)
  } catch {
    // Local deletion must remain available if Google is unavailable or the
    // OAuth configuration has already been removed.
  }

  const result = await backendData
    .from('mail_connections')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('id', connection.id)
  throwDbError(result.error)
  return { ok: true }
})
