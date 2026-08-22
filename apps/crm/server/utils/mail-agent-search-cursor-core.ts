import { createHash } from 'node:crypto'
import {
  decryptMailSecretValue,
  encryptMailSecretValue,
} from './mail-crypto-core.ts'

export const MAIL_AGENT_SEARCH_CURSOR_MAX_LENGTH = 24_000
export const MAIL_AGENT_SEARCH_CURSOR_TTL_MS = 60 * 60 * 1_000

const cursorContext = 'openexpert/crm-agent-mail-search-cursor/v1'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface MailAgentSearchCursorSource {
  connectionId: string
  folder: 'INBOX' | 'SENT'
  pageToken: string
  pageSize: number
}

interface EncodedCursor {
  v: 1
  b: string
  e: number
  s: Array<{ c: string; f: 'INBOX' | 'SENT'; p: string; z: number }>
}

function invalidCursor(): TypeError {
  return new TypeError('Kontynuacja wyszukiwania poczty jest nieprawidłowa albo wygasła.')
}

export function mailAgentSearchBinding(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function parsedSources(value: unknown): MailAgentSearchCursorSource[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw invalidCursor()
  const seen = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidCursor()
    const record = item as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'c,f,p,z') throw invalidCursor()
    const connectionId = String(record.c ?? '').trim().toLowerCase()
    const folder = String(record.f ?? '') as 'INBOX' | 'SENT'
    const pageToken = String(record.p ?? '').trim()
    const pageSize = Number(record.z)
    const key = `${connectionId}:${folder}`
    if (
      !uuidPattern.test(connectionId)
      || !['INBOX', 'SENT'].includes(folder)
      || !pageToken
      || pageToken.length > 6_000
      || /[\u0000-\u001F\u007F]/u.test(pageToken)
      || !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > 20
      || seen.has(key)
    ) throw invalidCursor()
    seen.add(key)
    return { connectionId, folder, pageToken, pageSize }
  })
}

export function sealMailAgentSearchCursor(
  binding: string,
  sources: MailAgentSearchCursorSource[],
  secret: string,
  now = Date.now(),
): string | null {
  if (!sources.length) return null
  if (!/^[0-9a-f]{64}$/u.test(binding) || !Number.isSafeInteger(now)) throw invalidCursor()
  const normalized = parsedSources(sources.map(source => ({
    c: source.connectionId,
    f: source.folder,
    p: source.pageToken,
    z: source.pageSize,
  })))
  const payload: EncodedCursor = {
    v: 1,
    b: binding,
    e: now + MAIL_AGENT_SEARCH_CURSOR_TTL_MS,
    s: normalized.map(source => ({
      c: source.connectionId,
      f: source.folder,
      p: source.pageToken,
      z: source.pageSize,
    })),
  }
  const cursor = encryptMailSecretValue(secret, JSON.stringify(payload), cursorContext)
  return cursor.length <= MAIL_AGENT_SEARCH_CURSOR_MAX_LENGTH ? cursor : null
}

export function unsealMailAgentSearchCursor(
  cursor: string,
  binding: string,
  secret: string,
  now = Date.now(),
): MailAgentSearchCursorSource[] {
  if (
    typeof cursor !== 'string'
    || !cursor
    || cursor.length > MAIL_AGENT_SEARCH_CURSOR_MAX_LENGTH
    || !/^[0-9a-f]{64}$/u.test(binding)
    || !Number.isSafeInteger(now)
  ) throw invalidCursor()
  try {
    const plaintext = decryptMailSecretValue(secret, cursor, cursorContext)
    const parsed = JSON.parse(plaintext) as Partial<EncodedCursor>
    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || Object.keys(parsed).sort().join(',') !== 'b,e,s,v'
      || parsed.v !== 1
      || parsed.b !== binding
      || !Number.isSafeInteger(parsed.e)
      || Number(parsed.e) <= now
    ) throw invalidCursor()
    return parsedSources(parsed.s)
  }
  catch {
    throw invalidCursor()
  }
}
