import { Buffer } from 'node:buffer'
import { caseUuidPattern } from './case-identifiers.ts'

export interface ClientAttachmentCursor {
  sentAt: string
  id: string
}

const CLIENT_ATTACHMENT_CURSOR_MAX_LENGTH = 512
const clientAttachmentTimestampPattern
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u

export function decodeClientAttachmentCursor(value: string): ClientAttachmentCursor {
  if (
    value.length > CLIENT_ATTACHMENT_CURSOR_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new Error('Invalid client attachment cursor')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  }
  catch {
    throw new Error('Invalid client attachment cursor')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid client attachment cursor')
  }

  const candidate = parsed as Record<string, unknown>
  const keys = Object.keys(candidate).sort()
  if (
    keys.length !== 2
    || keys[0] !== 'id'
    || keys[1] !== 'sentAt'
    || typeof candidate.sentAt !== 'string'
    || !clientAttachmentTimestampPattern.test(candidate.sentAt)
    || !Number.isFinite(Date.parse(candidate.sentAt))
    || typeof candidate.id !== 'string'
    || !caseUuidPattern.test(candidate.id)
  ) {
    throw new Error('Invalid client attachment cursor')
  }

  return {
    // Keep PostgreSQL's microseconds. Date#toISOString would truncate them and
    // could skip sibling attachments that share the same attached_at value.
    sentAt: candidate.sentAt,
    id: candidate.id.toLowerCase(),
  }
}

export function encodeClientAttachmentCursor(cursor: ClientAttachmentCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}
