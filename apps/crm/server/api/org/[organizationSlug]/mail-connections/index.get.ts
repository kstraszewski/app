import type { MailConnectionPayload } from '../../../../../shared/types/mail.ts'
import { requireCrmSession } from '~~/server/utils/crm'
import { loadUserMailConnection } from '~~/server/utils/mail-connections'
import {
  mailProviderAvailability,
  mailTokenIncludesSendAccess,
} from '~~/server/utils/mail-providers'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'

export default defineEventHandler(async (event): Promise<MailConnectionPayload> => {
  setPrivateMailResponseHeaders(event)
  const session = await requireCrmSession(event)
  const { connection } = await loadUserMailConnection(event, session)
  const configured = mailProviderAvailability(event)
  const returnTo = `/org/${encodeURIComponent(session.organizationSlug)}/mail`
  const connectPath = configured
    ? `/api/org/${encodeURIComponent(session.organizationSlug)}/mail-connections/google/connect?returnTo=${encodeURIComponent(returnTo)}`
    : null

  return {
    configured,
    provider: {
      id: 'google',
      label: 'Gmail',
      connectPath,
    },
    connection: connection ? {
      id: connection.id,
      provider: 'google',
      accountEmail: connection.account_email,
      capabilities: {
        canSend: mailTokenIncludesSendAccess(connection.scopes),
      },
      status: connection.status,
      errorMessage: connection.last_error,
      updatedAt: connection.updated_at,
    } : null,
  }
})
