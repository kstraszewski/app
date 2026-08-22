import type {
  CrmAgentMailAttachmentFilter,
  CrmAgentMailFolder,
  CrmAgentMailMatchReason,
  CrmAgentMailSearchResponse,
  CrmAgentMailThreadSummary,
} from '../../../../shared/types/agent-mail.ts'
import type {
  MailAddress,
  MailContextFolderId,
  MailThreadDetail,
  MailThreadSummary,
} from '../../../../shared/types/mail.ts'
import { assertCrmAgentMailRateLimit } from '~~/server/utils/mail-agent-rate-limit'
import {
  createMailAgentSearchCursor,
  openMailAgentSearchCursor,
} from '~~/server/utils/mail-agent-search-cursor'
import {
  MAIL_AGENT_SEARCH_CURSOR_MAX_LENGTH,
  mailAgentSearchBinding,
} from '~~/server/utils/mail-agent-search-cursor-core'
import { createMailAgentThreadReference } from '~~/server/utils/mail-agent-thread-reference'
import {
  readCrmAgentMailRequest,
  requireCrmAgentMailSession,
} from '~~/server/utils/mail-agent-service'
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
  loadUserMailConnections,
  type MailConnectionRow,
} from '~~/server/utils/mail-connections'
import { fetchMailThreadDetailForConnection } from '~~/server/utils/mail-thread-detail'
import {
  connectionReferenceSecret,
  fetchMailThreadPageForConnection,
} from '~~/server/utils/mail-thread-page'

const maximumConnections = 5
const maximumThreads = 12
const maximumLinkedDetails = 12
const providerPageSize = 20

interface CandidateThread {
  connection: MailConnectionRow
  summary: MailThreadSummary
  folders: Set<MailContextFolderId>
  matchedEmails: Set<string>
  link: MailContextThreadLinkRow | null
}

function invalidRequest(): never {
  throw createError({ statusCode: 400, statusMessage: 'Parametry wyszukiwania poczty są nieprawidłowe.' })
}

function optionalQuery(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return invalidRequest()
  const normalized = value.trim()
  if (!normalized || normalized.length > 500 || /[\u0000-\u001F\u007F]/u.test(normalized)) {
    return invalidRequest()
  }
  return normalized
}

function optionalEmail(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return invalidRequest()
  const normalized = value.trim().toLowerCase()
  if (
    normalized.length < 3
    || normalized.length > 320
    || !/^[^\s@<>]+@[^\s@<>]+$/u.test(normalized)
    || /[\u0000-\u001F\u007F]/u.test(normalized)
  ) return invalidRequest()
  return normalized
}

function requestedFolder(value: unknown): CrmAgentMailFolder {
  if (value === undefined || value === 'all') return 'all'
  if (value === 'inbox' || value === 'sent') return value
  return invalidRequest()
}

function requestedAttachmentFilter(value: unknown): CrmAgentMailAttachmentFilter {
  if (value === undefined || value === 'any') return 'any'
  if (value === 'with_attachments') return value
  return invalidRequest()
}

function requestedLimit(value: unknown): number {
  if (value === undefined) return 8
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumThreads) return invalidRequest()
  return limit
}

function optionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return invalidRequest()
  const cursor = value.trim()
  if (!cursor || cursor.length > MAIL_AGENT_SEARCH_CURSOR_MAX_LENGTH) return invalidRequest()
  return cursor
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) || 0 : 0
}

async function mapSettled<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<{ values: R[], failureCount: number }> {
  const output = new Array<R | null>(values.length).fill(null)
  let nextIndex = 0
  let failureCount = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    let index: number
    while ((index = nextIndex++) < values.length) {
      try {
        output[index] = await task(values[index]!)
      }
      catch {
        failureCount += 1
      }
    }
  })
  await Promise.all(workers)
  return {
    values: output.filter((value): value is R => value !== null),
    failureCount,
  }
}

function requestedFolders(folder: CrmAgentMailFolder): MailContextFolderId[] {
  if (folder === 'inbox') return ['INBOX']
  if (folder === 'sent') return ['SENT']
  return ['INBOX', 'SENT']
}

function linkMatchReason(link: MailContextThreadLinkRow): CrmAgentMailMatchReason {
  if (link.link_source === 'manual') return 'manual_link'
  if (link.link_source === 'bank_mail_agent') return 'bank_mail_agent'
  return 'sent_from_context'
}

function messageIsSent(message: MailThreadDetail['messages'][number], accountEmail: string): boolean {
  return String(message.from?.email ?? '').trim().toLowerCase() === accountEmail.trim().toLowerCase()
}

function detailFolders(detail: MailThreadDetail, accountEmail: string): Set<MailContextFolderId> {
  const folders = new Set<MailContextFolderId>()
  for (const message of detail.messages) {
    folders.add(messageIsSent(message, accountEmail) ? 'SENT' : 'INBOX')
  }
  return folders
}

function uniqueParticipants(addresses: MailAddress[], accountEmail: string): MailAddress[] {
  const byKey = new Map<string, MailAddress>()
  for (const address of addresses) {
    const email = String(address.email ?? '').trim().toLowerCase()
    const key = email || address.label
    if (key && !byKey.has(key)) byKey.set(key, address)
  }
  const values = [...byKey.values()]
  const external = values.filter(address => (
    String(address.email ?? '').trim().toLowerCase() !== accountEmail.trim().toLowerCase()
  ))
  return (external.length ? external : values).slice(0, 20)
}

function summaryFromDetail(
  detail: MailThreadDetail,
  reference: string,
  accountEmail: string,
): MailThreadSummary {
  const sorted = [...detail.messages]
    .sort((left, right) => String(left.sentAt ?? '').localeCompare(String(right.sentAt ?? '')))
  const latest = sorted.at(-1)
  const participants = uniqueParticipants(detail.messages.flatMap(message => [
    ...(message.from ? [message.from] : []),
    ...message.to,
    ...message.cc,
  ]), accountEmail)
  return {
    id: reference,
    latestMessageId: latest?.id,
    messageCount: detail.messages.length + detail.omittedMessageCount,
    participants,
    participantsLabel: participants.map(address => address.label).join(', ') || accountEmail,
    subject: detail.subject || '(bez tematu)',
    snippet: String(latest?.bodyText ?? '').replace(/\s+/gu, ' ').trim().slice(0, 600),
    latestAt: latest?.sentAt ?? null,
    unread: detail.messages.some(message => message.unread),
    starred: false,
    important: false,
    draft: false,
    hasAttachments: detail.messages.some(message => message.attachments.length > 0),
  }
}

function detailMatchesQuery(detail: MailThreadDetail, query: string | undefined): boolean {
  if (!query) return true
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean)
  const searchable = [
    detail.subject,
    ...detail.messages.flatMap(message => [
      message.subject,
      message.from?.label ?? '',
      ...message.to.map(address => address.label),
      ...message.cc.map(address => address.label),
      message.bodyText,
      ...message.attachments.map(attachment => attachment.filename),
    ]),
  ].join('\n').toLowerCase()
  return terms.every(term => searchable.includes(term))
}

function folderMatches(candidateFolders: Set<MailContextFolderId>, folder: CrmAgentMailFolder): boolean {
  return folder === 'all'
    || candidateFolders.has(folder === 'sent' ? 'SENT' : 'INBOX')
}

function providerParticipantEmails(
  provider: MailConnectionRow['provider'],
  emails: string[],
  query: string | undefined,
): string[] | undefined {
  if (!emails.length) return undefined
  if (provider === 'imap') return emails

  const separatorLength = query ? (provider === 'google' ? 1 : 11) : 0
  const availableCharacters = 500 - (query?.length ?? 0) - separatorLength
  const plan = mailContextSearchPlan(provider, emails, availableCharacters)
  // A partial participant query would silently omit some CRM addresses. A
  // broad provider page plus the exact local participant filter is slower but
  // complete and keeps pagination honest.
  return plan.truncated ? undefined : emails
}

export default defineEventHandler(async (event): Promise<CrmAgentMailSearchResponse> => {
  const session = await requireCrmAgentMailSession(event)
  await assertCrmAgentMailRateLimit(event, session.userId, 'search')
  const body = await readCrmAgentMailRequest(event)
  const allowedFields = new Set([
    'query',
    'participantEmail',
    'scope',
    'folder',
    'attachmentFilter',
    'limit',
    'cursor',
  ])
  if (Object.keys(body).some(key => !allowedFields.has(key))) invalidRequest()

  const query = optionalQuery(body.query)
  const participantEmail = optionalEmail(body.participantEmail)
  const scope = body.scope === undefined ? null : parseMailContextScope(body.scope)
  if (scope && participantEmail) invalidRequest()
  const folder = requestedFolder(body.folder)
  const attachmentFilter = requestedAttachmentFilter(body.attachmentFilter)
  const limit = requestedLimit(body.limit)
  const cursor = optionalCursor(body.cursor)
  const context = scope ? await resolveMailContextScope(session, scope) : null
  const expectedEmails = context?.emails ?? (participantEmail ? [participantEmail] : [])
  const searchBinding = mailAgentSearchBinding({
    query: query ?? null,
    participantEmail: participantEmail ?? null,
    scope,
    folder,
    attachmentFilter,
    limit,
  })

  const loaded = await loadUserMailConnections(event, session)
  const eligibleConnections = loaded.connections
    .filter(connection => connection.status !== 'revoked')
    .slice(0, maximumConnections)
  if (loaded.connections.length > 0 && eligibleConnections.length === 0) {
    throw createError({ statusCode: 409, statusMessage: 'Połącz ponownie konto pocztowe.' })
  }

  const folders = requestedFolders(folder)
  const connectionsById = new Map(eligibleConnections.map(connection => [connection.id, connection]))
  const continuationSources = cursor
    ? openMailAgentSearchCursor(event, session, cursor, searchBinding)
    : null
  const pageSources = continuationSources
    ? continuationSources.map((source) => {
        const connection = connectionsById.get(source.connectionId)
        if (!connection || !folders.includes(source.folder)) invalidRequest()
        return {
          connection,
          folder: source.folder,
          pageToken: source.pageToken,
          pageSize: source.pageSize,
        }
      })
    : context && expectedEmails.length === 0
      ? []
      : eligibleConnections.flatMap(connection => folders.map(mailFolder => ({
          connection,
          folder: mailFolder,
          pageToken: undefined as string | undefined,
          pageSize: undefined as number | undefined,
        })))
  const perSourcePageSize = Math.min(
    providerPageSize,
    Math.max(1, Math.floor(limit / Math.max(1, pageSources.length))),
  )
  const [pages, linkGroups] = await Promise.all([
    mapSettled(pageSources, maximumConnections, async source => ({
      ...source,
      page: await fetchMailThreadPageForConnection(event, {
        backendData: loaded.backendData,
        session,
        connection: source.connection,
        folder: source.folder,
        search: query,
        participantEmails: providerParticipantEmails(
          source.connection.provider,
          expectedEmails,
          query,
        ),
        pageToken: source.pageToken,
        maxResults: source.pageSize ?? perSourcePageSize,
        observeBankMail: false,
      }),
    })),
    context && !cursor
      ? mapSettled(eligibleConnections, maximumConnections, async connection => ({
          connection,
          links: await loadMailContextThreadLinks(
            loaded.backendData,
            session,
            connection.id,
            context.scope,
          ),
        }))
      : Promise.resolve({ values: [], failureCount: 0 }),
  ])
  if (pageSources.length > 0 && pages.values.length === 0 && pages.failureCount > 0) {
    throw createError({ statusCode: 502, statusMessage: 'Nie udało się przeszukać podłączonych skrzynek.' })
  }
  if (
    context
    && expectedEmails.length === 0
    && eligibleConnections.length > 0
    && linkGroups.values.length === 0
    && linkGroups.failureCount > 0
  ) {
    throw createError({ statusCode: 502, statusMessage: 'Nie udało się odczytać powiązań poczty dla tego kontekstu.' })
  }

  let partialFailureCount = pages.failureCount
    + linkGroups.failureCount
    + Math.max(0, loaded.connections.length - eligibleConnections.length)
    + pages.values.reduce((sum, value) => sum + value.page.partialFailureCount, 0)
  const aggregate = new Map<string, CandidateThread>()

  for (const { connection, folder: sourceFolder, page } of pages.values) {
    const referenceSecret = connectionReferenceSecret(event, connection)
    for (const summary of page.data) {
      if (attachmentFilter === 'with_attachments' && !summary.hasAttachments) continue
      const matchedEmails = expectedEmails.length
        ? mailContextMatchedEmails(summary, expectedEmails)
        : []
      if (expectedEmails.length && !matchedEmails.length) continue
      try {
        const keyHash = mailContextThreadKeyHash(connection.provider, summary.id, referenceSecret)
        const key = `${connection.id}:${keyHash}`
        const existing = aggregate.get(key)
        if (existing) {
          existing.folders.add(sourceFolder)
          for (const email of matchedEmails) existing.matchedEmails.add(email)
          if (timestamp(summary.latestAt) > timestamp(existing.summary.latestAt)) {
            existing.summary = summary
          }
        }
        else {
          aggregate.set(key, {
            connection,
            summary,
            folders: new Set([sourceFolder]),
            matchedEmails: new Set(matchedEmails),
            link: null,
          })
        }
      }
      catch {
        partialFailureCount += 1
      }
    }
  }

  const missingLinks: Array<{ connection: MailConnectionRow; link: MailContextThreadLinkRow }> = []
  for (const group of linkGroups.values) {
    for (const link of group.links) {
      const key = `${group.connection.id}:${link.thread_key_hash}`
      const existing = aggregate.get(key)
      if (existing) existing.link = link
      else missingLinks.push({ connection: group.connection, link })
    }
  }
  missingLinks.sort((left, right) => right.link.updated_at.localeCompare(left.link.updated_at))
  const omittedLinkedThreadCount = Math.max(0, missingLinks.length - maximumLinkedDetails)

  const linkedDetails = await mapSettled(
    missingLinks.slice(0, maximumLinkedDetails),
    maximumConnections,
    async ({ connection, link }) => ({
      connection,
      link,
      detail: await fetchMailThreadDetailForConnection(event, {
        backendData: loaded.backendData,
        session,
        connection,
        threadId: link.thread_reference,
        observeBankMail: false,
      }),
    }),
  )
  partialFailureCount += linkedDetails.failureCount
  for (const { connection, link, detail } of linkedDetails.values) {
    const candidateFolders = detailFolders(detail, connection.account_email)
    if (!folderMatches(candidateFolders, folder)) continue
    if (!detailMatchesQuery(detail, query)) continue
    const summary = summaryFromDetail(detail, link.thread_reference, connection.account_email)
    if (attachmentFilter === 'with_attachments' && !summary.hasAttachments) continue
    const key = `${connection.id}:${link.thread_key_hash}`
    aggregate.set(key, {
      connection,
      summary,
      folders: candidateFolders,
      matchedEmails: new Set(mailContextMatchedEmails(summary, expectedEmails)),
      link,
    })
  }

  const sortedCandidates = [...aggregate.values()]
    .filter(candidate => folderMatches(candidate.folders, folder))
    .sort((left, right) => timestamp(right.summary.latestAt) - timestamp(left.summary.latestAt))
  const resultLimit = Math.min(maximumThreads, Math.max(limit, pageSources.length))
  const omittedResultCount = Math.max(0, sortedCandidates.length - resultLimit)
  const expectedEmailSet = new Set(expectedEmails)
  const threads: CrmAgentMailThreadSummary[] = sortedCandidates
    .slice(0, resultLimit)
    .map((candidate) => {
      const participantBound = !candidate.link && expectedEmails.length > 0
      const matchReason: CrmAgentMailMatchReason = candidate.link
        ? linkMatchReason(candidate.link)
        : participantBound ? 'participant_email' : 'mailbox_search'
      return {
        reference: createMailAgentThreadReference({
          connectionId: candidate.connection.id,
          threadId: candidate.summary.id,
          accessMode: candidate.link
            ? 'linked'
            : participantBound ? 'participants' : 'mailbox',
          participantEmails: participantBound ? expectedEmails : [],
        }, connectionReferenceSecret(event, candidate.connection)),
        mailbox: candidate.connection.account_email,
        provider: candidate.connection.provider,
        folders: [...candidate.folders]
          .sort()
          .map(value => value === 'SENT' ? 'sent' as const : 'inbox' as const),
        matchReason,
        matchedEmails: [...candidate.matchedEmails],
        participants: candidate.summary.participants
          .filter(address => !participantBound || (
            address.email && expectedEmailSet.has(address.email.trim().toLowerCase())
          ))
          .slice(0, 20).map(address => ({
            name: address.name,
            email: address.email,
            label: address.label,
          })),
        subject: candidate.summary.subject,
        latestAt: candidate.summary.latestAt,
        listedMessageCount: candidate.summary.messageCount,
        // A provider thread summary can point at an unrelated latest message
        // in a mixed thread. Exact participant-bound content is exposed only
        // after read_mail_threads filters individual messages.
        snippet: participantBound ? '' : candidate.summary.snippet.slice(0, 600),
        hasAttachments: candidate.summary.hasAttachments,
        url: `/org/${encodeURIComponent(session.organizationSlug)}/mail`,
      }
    })

  const nextSources = pages.values.flatMap(({ connection, folder: sourceFolder, page, pageSize }) => (
    page.nextPageToken
      ? [{
          connectionId: connection.id,
          folder: sourceFolder,
          pageToken: page.nextPageToken,
          pageSize: pageSize ?? perSourcePageSize,
        }]
      : []
  ))
  const nextCursor = createMailAgentSearchCursor(
    event,
    session,
    searchBinding,
    nextSources,
  )
  const complete = nextSources.length === 0
    && partialFailureCount === 0
    && !context?.descriptor.emailsTruncated
    && omittedLinkedThreadCount === 0
    && omittedResultCount === 0
  const coverageReason = complete
    ? 'complete' as const
    : nextCursor
      ? 'more_available' as const
      : partialFailureCount > 0
        ? 'partial_failure' as const
        : context?.descriptor.emailsTruncated
          ? 'context_email_limit' as const
          : omittedLinkedThreadCount > 0
            ? 'linked_window_limit' as const
            : omittedResultCount > 0
              ? 'result_window_limit' as const
              : 'continuation_unavailable' as const

  return {
    data: {
      folder,
      attachmentFilter,
      query: query ?? null,
      participantEmail: participantEmail ?? null,
      context: context
        ? {
            type: context.scope.type,
            id: context.scope.id,
            label: context.descriptor.label,
            emailCount: context.descriptor.emailCount,
            emailsTruncated: context.descriptor.emailsTruncated,
          }
        : null,
      searchedAccountCount: eligibleConnections.length,
      partialFailureCount,
      coverage: {
        complete,
        nextCursor,
        omittedLinkedThreadCount,
        omittedResultCount,
        reason: coverageReason,
      },
      threads,
    },
  }
})
