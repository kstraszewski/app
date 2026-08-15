import { createError, getHeader, type H3Event } from 'h3'
import { readBoundedRequestBody } from './mail-multipart.ts'

const MAX_MAIL_CONTEXT_REQUEST_BYTES = 16_384

export async function readMailContextJsonObject(
  event: H3Event,
  allowedFields: readonly string[],
): Promise<Record<string, unknown>> {
  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Żądanie wymaga formatu JSON.' })
  }
  const lengthHeader = getHeader(event, 'content-length')?.trim() ?? ''
  const contentLength = lengthHeader ? Number(lengthHeader) : 0
  if (
    (lengthHeader && (!/^\d+$/u.test(lengthHeader) || !Number.isSafeInteger(contentLength)))
    || contentLength > MAX_MAIL_CONTEXT_REQUEST_BYTES
  ) {
    throw createError({ statusCode: 413, statusMessage: 'Żądanie jest zbyt duże.' })
  }

  let body: unknown
  try {
    const raw = await readBoundedRequestBody(event, MAX_MAIL_CONTEXT_REQUEST_BYTES)
    body = JSON.parse(raw.toString('utf8'))
  }
  catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 413) throw error
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe żądanie poczty.' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe żądanie poczty.' })
  }
  const record = body as Record<string, unknown>
  const allowed = new Set(allowedFields)
  if (Object.keys(record).some(key => !allowed.has(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Żądanie zawiera nieobsługiwane pole.' })
  }
  return record
}

export function mailContextConnectionId(value: unknown): string {
  const id = String(value ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe konto pocztowe.' })
  }
  return id
}

export function mailContextThreadReference(value: unknown): string {
  const reference = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(reference)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy identyfikator wątku.' })
  }
  return reference
}

export function mailContextPageTokens(
  value: unknown,
): Partial<Record<'INBOX' | 'SENT', string>> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe kursory poczty.' })
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => key !== 'INBOX' && key !== 'SENT')) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe kursory poczty.' })
  }
  const result: Partial<Record<'INBOX' | 'SENT', string>> = {}
  for (const folder of ['INBOX', 'SENT'] as const) {
    if (record[folder] === undefined || record[folder] === null || record[folder] === '') continue
    const token = String(record[folder]).trim()
    if (!/^[A-Za-z0-9_.~-]{1,4096}$/u.test(token)) {
      throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy kursor poczty.' })
    }
    result[folder] = token
  }
  return result
}

export function mailContextSearch(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe wyszukiwanie poczty.' })
  }
  const search = value.trim()
  if (search.length > 200 || /[\u0000-\u001F\u007F]/u.test(search)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowe wyszukiwanie poczty.' })
  }
  return search
}
