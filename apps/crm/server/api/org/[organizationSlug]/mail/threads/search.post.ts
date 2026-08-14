import { getHeader } from 'h3'
import type {
  MailFolderId,
  MailThreadListPayload,
} from '../../../../../../shared/types/mail.ts'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'
import { loadMailThreadPage } from '~~/server/utils/mail-thread-page'
import { readBoundedRequestBody } from '~~/server/utils/mail-multipart'

const MAIL_FOLDERS: MailFolderId[] = ['INBOX', 'STARRED', 'SENT', 'DRAFT']
const MAX_PAGE_TOKEN_CHARACTERS = 4_096
const MAX_SEARCH_REQUEST_BYTES = 8_192

export default defineEventHandler(async (event): Promise<MailThreadListPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)

  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Wyszukiwanie wymaga formatu JSON.' })
  }
  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_SEARCH_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Zapytanie wyszukiwania jest zbyt duże.' })
  }

  let body: Record<string, unknown>
  try {
    const rawBody = await readBoundedRequestBody(event, MAX_SEARCH_REQUEST_BYTES)
    body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
  } catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 413) throw error
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe zapytanie wyszukiwania.' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe zapytanie wyszukiwania.' })
  }
  const allowedFields = new Set(['connectionId', 'folder', 'q', 'pageToken'])
  if (Object.keys(body).some(key => !allowedFields.has(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Zapytanie zawiera nieobsługiwane pole.' })
  }

  const connectionId = String(body.connectionId ?? '').trim()
  const folder = String(body.folder ?? 'INBOX').toUpperCase() as MailFolderId
  const search = String(body.q ?? '').trim()
  const pageToken = String(body.pageToken ?? '').trim()
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'Mail connection ID is required' })
  }
  if (!MAIL_FOLDERS.includes(folder)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid mail folder' })
  }
  if (!search || search.length > 500 || /[\u0000-\u001F\u007F]/u.test(search)) {
    throw createError({ statusCode: 400, statusMessage: 'Zapytanie wyszukiwania jest nieprawidłowe.' })
  }
  if (pageToken.length > MAX_PAGE_TOKEN_CHARACTERS) {
    throw createError({ statusCode: 400, statusMessage: 'Mail page token is too long' })
  }

  return loadMailThreadPage(event, {
    connectionId,
    folder,
    search,
    pageToken: pageToken || undefined,
  })
})
