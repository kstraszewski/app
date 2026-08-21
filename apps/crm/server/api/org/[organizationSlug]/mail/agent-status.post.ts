import { getHeader } from 'h3'
import type {
  MailBankAgentStatus,
  MailBankAgentStatusPayload,
} from '../../../../../shared/types/mail.ts'
import {
  bankMailProviderMessageIdentitySha256,
  mapBankMailAgentStatuses,
  parseBankMailAgentStatusRequest,
} from '~~/server/utils/bank-mail-agent-status-core'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'
import { readBoundedRequestBody } from '~~/server/utils/mail-multipart'
import { requireUserMailConnection } from '~~/server/utils/mail-connections'
import { openImapMessageReference } from '~~/server/utils/mail-imap-smtp'
import { connectionReferenceSecret } from '~~/server/utils/mail-thread-page'
import { resolveMailContextScope } from '~~/server/utils/mail-context'

const MAX_REQUEST_BYTES = 220_000

export default defineEventHandler(async (event): Promise<MailBankAgentStatusPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)

  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Sprawdzanie analizy wymaga formatu JSON.' })
  }
  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Zapytanie o stan analizy jest zbyt duże.' })
  }

  let input
  try {
    const rawBody = await readBoundedRequestBody(event, MAX_REQUEST_BYTES)
    input = parseBankMailAgentStatusRequest(JSON.parse(rawBody.toString('utf8')))
  }
  catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 413) throw error
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error
        ? error.message
        : 'Nieprawidłowe zapytanie o stan analizy.',
    })
  }

  const { connection } = await requireUserMailConnection(event, session, input.connectionId)
  const referenceSecret = connection.provider === 'imap'
    ? connectionReferenceSecret(event, connection)
    : ''
  const identities = input.messageIds.map((messageId) => {
    const imapIdentity = connection.provider === 'imap'
      ? openImapMessageReference(messageId, referenceSecret)
      : undefined
    return {
      messageId,
      sha256: bankMailProviderMessageIdentitySha256(
        connection.provider,
        messageId,
        imapIdentity,
      ),
    }
  })

  const { data, error } = await session.dataApi.rpc('get_my_mail_bank_agent_statuses', {
    p_organization_id: session.organizationId,
    p_connection_id: connection.id,
    p_provider_message_id_hashes: [...new Set(identities.map(identity => identity.sha256))],
  })
  if (error) {
    throw createError({ statusCode: 503, statusMessage: 'Stan analizy wiadomości jest chwilowo niedostępny.' })
  }

  const statuses = mapBankMailAgentStatuses(identities, data)
  await enrichLinkedCaseContexts(session, statuses)
  return { data: statuses }
})

async function enrichLinkedCaseContexts(
  session: Awaited<ReturnType<typeof requireCrmSession>>,
  statuses: MailBankAgentStatus[],
): Promise<void> {
  const caseIds = [...new Set(statuses
    .map(status => status.link?.state === 'linked' ? status.link.caseId : null)
    .filter((caseId): caseId is string => Boolean(caseId)))]
  if (!caseIds.length) return

  const descriptors = new Map<string, Awaited<ReturnType<typeof resolveMailContextScope>>['descriptor']>()
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, caseIds.length) }, async () => {
    while (cursor < caseIds.length) {
      const caseId = caseIds[cursor++]!
      try {
        const resolved = await resolveMailContextScope(session, { type: 'case', id: caseId })
        descriptors.set(caseId, resolved.descriptor)
      }
      catch {
        // The controlled analysis result remains useful even if a linked CRM
        // entity was removed or is temporarily unavailable.
      }
    }
  }))

  for (const status of statuses) {
    const caseId = status.link?.state === 'linked' ? status.link.caseId : null
    const descriptor = caseId ? descriptors.get(caseId) : undefined
    if (!descriptor) continue
    status.context = {
      case: { id: descriptor.id, label: descriptor.label },
      clients: (descriptor.relatedClients ?? []).map(client => ({
        id: client.id,
        label: client.label,
        isPrimary: client.isPrimary,
      })),
    }
  }
}
