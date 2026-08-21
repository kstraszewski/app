import { createError } from 'h3'
import type {
  MailAddress,
  MailContextFolderId,
  MailContextThreadListPayload,
  MailContextThreadSummary,
  MailThreadDetail,
  MailThreadListPayload,
  MailThreadSummary,
} from '~~/shared/types/mail'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  activeMailAccessToken,
  requireUserMailConnection,
  type MailConnectionRow,
} from '~~/server/utils/mail-connections'
import {
  loadMailContextThreadLinks,
  resolveMailContextScope,
  type MailContextThreadLinkRow,
} from '~~/server/utils/mail-context'
import {
  mailContextMatchedEmails,
  mailContextSearchPlan,
  mailContextThreadKeyHash,
  parseMailContextScope,
} from '~~/server/utils/mail-context-core'
import {
  mailContextConnectionId,
  mailContextPageTokens,
  mailContextSearch,
  readMailContextJsonObject,
} from '~~/server/utils/mail-context-http'
import { imapSmtpRuntimeForConnection } from '~~/server/utils/mail-imap-runtime'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'
import {
  connectionReferenceSecret,
  handleMailProviderError,
  loadMailThreadPage,
} from '~~/server/utils/mail-thread-page'
import { fetchGmailThread } from '~~/server/utils/mail-providers'

const CONTEXT_FOLDERS: MailContextFolderId[] = ['INBOX', 'SENT']
const LINK_DETAIL_CONCURRENCY = 3

export default defineEventHandler(async (event): Promise<MailContextThreadListPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)
  const body = await readMailContextJsonObject(event, [
    'scope',
    'connectionId',
    'q',
    'pageTokens',
  ])
  const scope = parseMailContextScope(body.scope)
  const connectionId = mailContextConnectionId(body.connectionId)
  const search = mailContextSearch(body.q)
  const pageTokens = mailContextPageTokens(body.pageTokens)
  const requestedFolders = body.pageTokens === undefined
    ? CONTEXT_FOLDERS
    : CONTEXT_FOLDERS.filter(folder => Boolean(pageTokens[folder]))

  const [context, connectionResult] = await Promise.all([
    resolveMailContextScope(session, scope),
    requireUserMailConnection(event, session, connectionId),
  ])
  const { backendData, connection } = connectionResult
  if (connection.status === 'revoked') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Połącz ponownie konto pocztowe.',
    })
  }
  const searchPlan = mailContextSearchPlan(connection.provider, context.emails)

  const linksPromise = loadMailContextThreadLinks(
    backendData,
    session,
    connection.id,
    context.scope,
  )
  const pageResults = searchPlan.emails.length
    ? await Promise.allSettled(requestedFolders.map(folder => loadMailThreadPage(event, {
        connectionId: connection.id,
        folder,
        participantEmails: searchPlan.emails,
        search: search || undefined,
        pageToken: pageTokens[folder],
      })))
    : []
  const links = await linksPromise

  const pageByFolder = new Map<MailContextFolderId, MailThreadListPayload>()
  const pageErrors: unknown[] = []
  let partialFailureCount = 0
  for (const [index, result] of pageResults.entries()) {
    const folder = requestedFolders[index]!
    if (result.status === 'fulfilled') {
      pageByFolder.set(folder, result.value)
      partialFailureCount += result.value.partialFailureCount
    }
    else {
      pageErrors.push(result.reason)
      partialFailureCount += 1
    }
  }
  if (pageResults.length && pageErrors.length === pageResults.length && !links.length) {
    throw pageErrors[0]
  }

  const referenceSecret = connectionReferenceSecret(event, connection)
  const aggregate = new Map<string, AggregatedThread>()
  for (const [folder, page] of pageByFolder) {
    for (const thread of page.data) {
      const matchedEmails = mailContextMatchedEmails(thread, context.emails)
      // Provider-side participant search is followed by a local exact match.
      // This prevents loose full-text implementations from suggesting mail
      // merely because an address appeared in message content.
      if (!matchedEmails.length) continue
      try {
        const keyHash = mailContextThreadKeyHash(
          connection.provider,
          thread.id,
          referenceSecret,
        )
        const current = aggregate.get(keyHash)
        if (!current) {
          aggregate.set(keyHash, {
            summary: thread,
            folders: new Set([folder]),
            matchedEmails: new Set(matchedEmails),
          })
          continue
        }
        current.folders.add(folder)
        for (const email of matchedEmails) current.matchedEmails.add(email)
        if (latestTimestamp(thread) > latestTimestamp(current.summary)) {
          current.summary = thread
        }
      }
      catch {
        partialFailureCount += 1
      }
    }
  }

  const linksByHash = new Map(links.map(link => [link.thread_key_hash, link]))
  const missingLinks = links.filter(link => !aggregate.has(link.thread_key_hash))
  const linkedDetails = await loadLinkedSummaries(
    event,
    backendData,
    connection,
    missingLinks,
    referenceSecret,
  )
  partialFailureCount += linkedDetails.failureCount
  if (linkedDetails.authError) {
    throw await handleMailProviderError(backendData, connection, linkedDetails.authError)
  }
  for (const item of linkedDetails.values) {
    aggregate.set(item.link.thread_key_hash, {
      summary: item.summary,
      folders: new Set(),
      matchedEmails: new Set(mailContextMatchedEmails(item.summary, context.emails)),
    })
  }

  const data: MailContextThreadSummary[] = [...aggregate.entries()]
    .map(([keyHash, item]): MailContextThreadSummary => {
      const link = linksByHash.get(keyHash)
      return {
        ...item.summary,
        connectionId: connection.id,
        folders: [...item.folders],
        linked: Boolean(link),
        suggested: !link && item.matchedEmails.size > 0,
        matchReason: link
          ? link.link_source === 'manual'
            ? 'manual_link'
            : link.link_source === 'bank_mail_agent'
              ? 'bank_mail_agent'
              : 'sent_from_context'
          : item.matchedEmails.size ? 'participant_email' : null,
        matchedEmails: [...item.matchedEmails],
      }
    })
    .sort((left, right) => latestTimestamp(right) - latestTimestamp(left))

  return {
    context: {
      ...context.descriptor,
      emailsTruncated: context.descriptor.emailsTruncated || searchPlan.truncated,
    },
    data,
    nextPageTokens: {
      INBOX: pageByFolder.get('INBOX')?.nextPageToken ?? null,
      SENT: pageByFolder.get('SENT')?.nextPageToken ?? null,
    },
    resultSizeEstimate: data.length,
    partialFailureCount,
  }
})

interface AggregatedThread {
  summary: MailThreadSummary
  folders: Set<MailContextFolderId>
  matchedEmails: Set<string>
}

async function loadLinkedSummaries(
  event: Parameters<typeof imapSmtpRuntimeForConnection>[0],
  backendData: any,
  connection: MailConnectionRow,
  links: MailContextThreadLinkRow[],
  referenceSecret: string,
): Promise<{
  values: Array<{ link: MailContextThreadLinkRow; summary: MailThreadSummary }>
  failureCount: number
  authError: unknown | null
}> {
  if (!links.length) return { values: [], failureCount: 0, authError: null }

  const accessToken = connection.provider === 'imap'
    ? null
    : await activeMailAccessToken(event, backendData, connection)
  const values: Array<{ link: MailContextThreadLinkRow; summary: MailThreadSummary }> = []
  let failureCount = 0
  let authError: unknown | null = null
  let cursor = 0
  await Promise.all(Array.from(
    { length: Math.min(LINK_DETAIL_CONCURRENCY, links.length) },
    async () => {
      while (cursor < links.length) {
        const link = links[cursor++]!
        try {
          const detail = await fetchLinkedDetail(
            event,
            connection,
            link.thread_reference,
            referenceSecret,
            accessToken,
          )
          values.push({
            link,
            summary: threadDetailSummary(detail, link.thread_reference, connection.account_email),
          })
        }
        catch (error) {
          failureCount += 1
          const statusCode = Number((error as { statusCode?: number })?.statusCode)
          if (statusCode === 401 || statusCode === 403) authError ??= error
          // Preserve visibility of the durable relation even when a provider
          // deleted the message or its mailbox is temporarily unavailable.
          values.push({ link, summary: unavailableLinkedSummary(link.thread_reference) })
        }
      }
    },
  ))
  return { values, failureCount, authError }
}

async function fetchLinkedDetail(
  event: Parameters<typeof imapSmtpRuntimeForConnection>[0],
  connection: MailConnectionRow,
  reference: string,
  referenceSecret: string,
  accessToken: string | null,
): Promise<MailThreadDetail> {
  if (connection.provider === 'imap') {
    const module = await import('~~/server/utils/mail-imap-smtp')
    return module.fetchImapSmtpThread(
      imapSmtpRuntimeForConnection(event, connection),
      reference,
    )
  }
  if (connection.provider === 'google') {
    return fetchGmailThread(accessToken!, connection.account_email, reference)
  }
  const module = await import('~~/server/utils/mail-microsoft')
  return module.fetchMicrosoftMailThread(
    accessToken!,
    connection.account_email,
    reference,
    { referenceSecret },
  )
}

function threadDetailSummary(
  detail: MailThreadDetail,
  reference: string,
  accountEmail: string,
): MailThreadSummary {
  const latest = [...detail.messages]
    .sort((left, right) => String(left.sentAt ?? '').localeCompare(String(right.sentAt ?? '')))
    .at(-1)
  const addresses = detail.messages.flatMap(message => [
    ...(message.from ? [message.from] : []),
    ...message.to,
    ...message.cc,
  ])
  const participants = uniqueParticipants(addresses, accountEmail)
  const snippet = String(latest?.bodyText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 240)
  return {
    id: reference,
    latestMessageId: latest?.id,
    messageCount: detail.messages.length,
    participants,
    participantsLabel: participants.map(address => address.label).join(', ') || accountEmail,
    subject: detail.subject || '(bez tematu)',
    snippet,
    latestAt: latest?.sentAt ?? null,
    unread: detail.messages.some(message => message.unread),
    starred: false,
    important: false,
    draft: false,
    hasAttachments: detail.messages.some(message => message.attachments.length > 0),
  }
}

function uniqueParticipants(addresses: MailAddress[], accountEmail: string): MailAddress[] {
  const byEmail = new Map<string, MailAddress>()
  for (const address of addresses) {
    const email = String(address.email ?? '').trim().toLowerCase()
    const key = email || address.label
    if (key && !byEmail.has(key)) byEmail.set(key, address)
  }
  const values = [...byEmail.values()]
  const withoutAccount = values.filter(address => (
    String(address.email ?? '').trim().toLowerCase() !== accountEmail.toLowerCase()
  ))
  return (withoutAccount.length ? withoutAccount : values).slice(0, 20)
}

function unavailableLinkedSummary(reference: string): MailThreadSummary {
  return {
    id: reference,
    messageCount: 0,
    participants: [],
    participantsLabel: 'Powiązany wątek',
    subject: 'Powiązany wątek jest chwilowo niedostępny',
    snippet: 'Powiązanie pozostaje zapisane. Spróbuj odświeżyć skrzynkę później.',
    latestAt: null,
    unread: false,
    starred: false,
    important: false,
    draft: false,
    hasAttachments: false,
  }
}

function latestTimestamp(thread: Pick<MailThreadSummary, 'latestAt'>): number {
  const timestamp = Date.parse(thread.latestAt ?? '')
  return Number.isFinite(timestamp) ? timestamp : 0
}
