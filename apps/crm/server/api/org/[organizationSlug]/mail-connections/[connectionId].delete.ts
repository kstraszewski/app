import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  loadUserMailConnection,
} from '~~/server/utils/mail-connections'
import {
  revokeMailOAuthToken,
} from '~~/server/utils/mail-providers'
import {
  decryptMailSecret,
  mailConnectionSecretContext,
} from '~~/server/utils/mail-crypto'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'

export default defineEventHandler(async (event) => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)
  const connectionId = getRequiredParam(event, 'connectionId')
  const { backendData, connection } = await loadUserMailConnection(
    event,
    session,
    connectionId,
  )
  if (!connection) {
    throw createError({ statusCode: 404, statusMessage: 'Mail connection not found' })
  }

  if (connection.provider === 'google') try {
    const token = decryptMailSecret(
      event,
      connection.encrypted_refresh_token || connection.encrypted_access_token,
      mailConnectionSecretContext({
        organizationId: connection.organization_id,
        ownerUserId: connection.owner_user_id,
        connectionId: connection.id,
        purpose: connection.encrypted_refresh_token ? 'refresh-token' : 'access-token',
      }),
    )
    if (token) await revokeMailOAuthToken(token)
  }
  catch {
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
