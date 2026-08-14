import type { MailContextLinkPayload } from '~~/shared/types/mail'
import { requireCrmSession } from '~~/server/utils/crm'
import { requireUserMailConnection } from '~~/server/utils/mail-connections'
import {
  resolveMailContextScope,
  unlinkMailContextThread,
} from '~~/server/utils/mail-context'
import { parseMailContextScope } from '~~/server/utils/mail-context-core'
import {
  mailContextConnectionId,
  mailContextThreadReference,
  readMailContextJsonObject,
} from '~~/server/utils/mail-context-http'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'
import { connectionReferenceSecret } from '~~/server/utils/mail-thread-page'

export default defineEventHandler(async (event): Promise<MailContextLinkPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)
  const body = await readMailContextJsonObject(event, ['scope', 'connectionId', 'threadId'])
  const scope = parseMailContextScope(body.scope)
  const connectionId = mailContextConnectionId(body.connectionId)
  const threadReference = mailContextThreadReference(body.threadId)
  const [resolvedContext, connectionResult] = await Promise.all([
    resolveMailContextScope(session, scope),
    requireUserMailConnection(event, session, connectionId),
  ])
  const { backendData, connection } = connectionResult
  await unlinkMailContextThread(backendData, session, {
    connectionId: connection.id,
    provider: connection.provider,
    referenceSecret: connectionReferenceSecret(event, connection),
    scope: resolvedContext.scope,
    threadReference,
  })
  return { data: { linked: false } }
})
