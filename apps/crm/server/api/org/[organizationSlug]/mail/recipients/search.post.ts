import { getHeader } from 'h3'
import type { MailRecipientSearchPayload } from '../../../../../../shared/types/mail.ts'
import { parseClientSearchFilters, searchCrmClients } from '~~/server/utils/clients'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  crmMailRecipientSuggestions,
  providerMailRecipientSuggestions,
} from '~~/server/utils/mail-recipient-search'
import {
  BoundedMailRecipientSearchCache,
  mailRecipientSearchCacheKey,
} from '~~/server/utils/mail-recipient-search-cache'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'
import { readBoundedRequestBody } from '~~/server/utils/mail-multipart'
import { loadMailThreadPage } from '~~/server/utils/mail-thread-page'
import { requireUserMailConnection } from '~~/server/utils/mail-connections'

const MAX_REQUEST_BYTES = 4_096
const connectionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const providerRecipientCache = new BoundedMailRecipientSearchCache<
  MailRecipientSearchPayload['data']['provider']
>(2 * 60_000, 128)

export default defineEventHandler(async (event): Promise<MailRecipientSearchPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)

  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Wyszukiwanie wymaga formatu JSON.' })
  }
  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Zapytanie wyszukiwania jest zbyt duże.' })
  }

  let body: Record<string, unknown>
  try {
    const rawBody = await readBoundedRequestBody(event, MAX_REQUEST_BYTES)
    body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
  }
  catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 413) throw error
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe zapytanie wyszukiwania.' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe zapytanie wyszukiwania.' })
  }
  const allowedFields = new Set(['q', 'connectionId', 'limit'])
  if (Object.keys(body).some(key => !allowedFields.has(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Zapytanie zawiera nieobsługiwane pole.' })
  }

  const query = String(body.q ?? '').trim().replace(/\s+/gu, ' ')
  if (query.length < 2 || query.length > 100 || /[\u0000-\u001F\u007F]/u.test(query)) {
    throw createError({ statusCode: 400, statusMessage: 'Wpisz od 2 do 100 znaków.' })
  }
  const connectionId = String(body.connectionId ?? '').trim()
  if (connectionId && !connectionIdPattern.test(connectionId)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe połączenie pocztowe.' })
  }
  const rawLimit = body.limit === undefined ? 8 : Number(body.limit)
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 10) {
    throw createError({ statusCode: 400, statusMessage: 'Limit musi mieścić się między 1 a 10.' })
  }
  const limit = rawLimit

  const crmPromise = searchCrmClients(session, parseClientSearchFilters({
    q: query,
    sort: 'relevance',
    limit: Math.min(40, limit * 4),
  }, session))
  const providerPromise = connectionId
    ? providerRecipientCache.getOrLoad(mailRecipientSearchCacheKey({
        organizationId: session.organizationId,
        ownerUserId: session.userId,
        connectionId,
        query,
        limit,
      }), async () => {
        const { connection } = await requireUserMailConnection(event, session, connectionId)
        const pageResults = await Promise.allSettled([
          loadMailThreadPage(event, {
            connectionId,
            folder: 'INBOX',
            search: query,
            maxResults: limit,
          }),
          loadMailThreadPage(event, {
            connectionId,
            folder: 'SENT',
            search: query,
            maxResults: limit,
          }),
        ])
        const pages = pageResults.flatMap(result => (
          result.status === 'fulfilled' ? [result.value] : []
        ))
        if (!pages.length) {
          const failure = pageResults.find(result => result.status === 'rejected')
          throw failure?.reason ?? new Error('mail provider search unavailable')
        }
        return providerMailRecipientSuggestions(
          pages.flatMap(page => page.data),
          query,
          connectionId,
          limit,
          connection.account_email,
        )
      })
    : Promise.resolve([] as MailRecipientSearchPayload['data']['provider'])

  const [crmResult, providerResults] = await Promise.allSettled([
    crmPromise,
    providerPromise,
  ])
  const crm = crmResult.status === 'fulfilled'
    ? crmMailRecipientSuggestions(crmResult.value.data, query, limit)
    : []
  const provider = providerResults.status === 'fulfilled' ? providerResults.value : []

  return {
    data: { crm, provider },
    sources: {
      crm: crmResult.status === 'fulfilled' ? 'ok' : 'unavailable',
      provider: !connectionId
        ? 'skipped'
        : providerResults.status === 'fulfilled' ? 'ok' : 'unavailable',
    },
  }
})
