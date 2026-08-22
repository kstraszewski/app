import { createHash } from 'node:crypto'
import {
  decryptMailSecretValue,
  encryptMailSecretValue,
} from './mail-crypto-core.ts'
import type { CrmAgentMailCoverageLimitation } from '../../shared/types/agent-mail.ts'

export const MAIL_AGENT_SEARCH_CURSOR_MAX_LENGTH = 24_000
export const MAIL_AGENT_SEARCH_CURSOR_TTL_MS = 60 * 60 * 1_000

const cursorContext = 'openexpert/crm-agent-mail-search-cursor/v2'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface MailAgentSearchCursorSource {
  connectionId: string
  folder: 'ALL' | 'INBOX' | 'SENT'
  pageToken: string
  pageSize: number
  processedMessageCount: number
}

export interface MailAgentSearchCursorState {
  sources: MailAgentSearchCursorSource[]
  partialFailureCount: number
  omittedLinkedThreadCount: number
  omittedResultCount: number
  limitations: CrmAgentMailCoverageLimitation[]
}

interface EncodedCursor {
  v: 2
  b: string
  e: number
  f: number
  l: number
  m: CrmAgentMailCoverageLimitation[]
  r: number
  s: Array<{ c: string; f: 'ALL' | 'INBOX' | 'SENT'; n: number; p: string; z: number }>
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
    if (Object.keys(record).sort().join(',') !== 'c,f,n,p,z') throw invalidCursor()
    const connectionId = String(record.c ?? '').trim().toLowerCase()
    const folder = String(record.f ?? '') as 'ALL' | 'INBOX' | 'SENT'
    const pageToken = String(record.p ?? '').trim()
    const pageSize = Number(record.z)
    const processedMessageCount = Number(record.n)
    const key = `${connectionId}:${folder}`
    if (
      !uuidPattern.test(connectionId)
      || !['ALL', 'INBOX', 'SENT'].includes(folder)
      || !pageToken
      || pageToken.length > 6_000
      || /[\u0000-\u001F\u007F]/u.test(pageToken)
      || !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > 20
      || !Number.isSafeInteger(processedMessageCount)
      || processedMessageCount < 0
      || processedMessageCount > 1_000
      || seen.has(key)
    ) throw invalidCursor()
    seen.add(key)
    return { connectionId, folder, pageToken, pageSize, processedMessageCount }
  })
}

function boundedCount(value: unknown, maximum: number): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0 || count > maximum) throw invalidCursor()
  return count
}

function parsedLimitations(value: unknown): CrmAgentMailCoverageLimitation[] {
  if (!Array.isArray(value) || value.length > 3) throw invalidCursor()
  const allowed = new Set<CrmAgentMailCoverageLimitation>([
    'imap_all_folders_unavailable',
    'imap_search_window',
    'microsoft_search_result_limit',
  ])
  const limitations = [...new Set(value.map(item => String(item)))]
  if (limitations.some(item => !allowed.has(item as CrmAgentMailCoverageLimitation))) {
    throw invalidCursor()
  }
  return limitations.sort() as CrmAgentMailCoverageLimitation[]
}

export function sealMailAgentSearchCursor(
  binding: string,
  state: MailAgentSearchCursorState,
  secret: string,
  now = Date.now(),
): string | null {
  if (!state.sources.length) return null
  if (!/^[0-9a-f]{64}$/u.test(binding) || !Number.isSafeInteger(now)) throw invalidCursor()
  const normalized = parsedSources(state.sources.map(source => ({
    c: source.connectionId,
    f: source.folder,
    n: source.processedMessageCount,
    p: source.pageToken,
    z: source.pageSize,
  })))
  const payload: EncodedCursor = {
    v: 2,
    b: binding,
    e: now + MAIL_AGENT_SEARCH_CURSOR_TTL_MS,
    f: boundedCount(state.partialFailureCount, 1_000),
    l: boundedCount(state.omittedLinkedThreadCount, 100_000),
    m: parsedLimitations(state.limitations),
    r: boundedCount(state.omittedResultCount, 10_000),
    s: normalized.map(source => ({
      c: source.connectionId,
      f: source.folder,
      n: source.processedMessageCount,
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
): MailAgentSearchCursorState {
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
      || Object.keys(parsed).sort().join(',') !== 'b,e,f,l,m,r,s,v'
      || parsed.v !== 2
      || parsed.b !== binding
      || !Number.isSafeInteger(parsed.e)
      || Number(parsed.e) <= now
    ) throw invalidCursor()
    return {
      sources: parsedSources(parsed.s),
      partialFailureCount: boundedCount(parsed.f, 1_000),
      omittedLinkedThreadCount: boundedCount(parsed.l, 100_000),
      omittedResultCount: boundedCount(parsed.r, 10_000),
      limitations: parsedLimitations(parsed.m),
    }
  }
  catch {
    throw invalidCursor()
  }
}
