import { createError, getHeader, type H3Event } from 'h3'
import { z } from 'zod'
import type { ImapSmtpConnectionInput } from '../../shared/types/mail.ts'
import { requireSameOriginMailRequest } from './mail-http.ts'
import { readBoundedRequestBody } from './mail-multipart.ts'

const MAX_SETUP_REQUEST_BYTES = 12_000
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const FORCED_OAUTH_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
])

/**
 * Canonical comparison form for the mailbox identity declared by the user.
 * Do not apply provider-specific aliases (dots, plus-addressing, etc.): two
 * syntactically different addresses may genuinely be different mailboxes.
 */
export function normalizeMailAccountEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function sameMailAccountEmail(left: string, right: string): boolean {
  return normalizeMailAccountEmail(left) === normalizeMailAccountEmail(right)
}

const setupSchema = z.object({
  replacementConnectionId: z.uuid().optional(),
  displayName: z.string().trim().max(120).default(''),
  accountEmail: z.string().trim().toLowerCase().email().max(254),
  imapHost: z.string().trim().toLowerCase().max(253),
  imapPort: z.number().int(),
  imapSecurity: z.enum(['tls', 'starttls']),
  imapUsername: z.string().trim().min(1).max(320),
  imapPassword: z.string().min(1).max(1_024),
  smtpHost: z.string().trim().toLowerCase().max(253),
  smtpPort: z.number().int(),
  smtpSecurity: z.enum(['tls', 'starttls']),
  smtpUsername: z.string().trim().min(1).max(320),
  smtpPassword: z.string().min(1).max(1_024),
}).strict()

export async function readImapSmtpConnectionInput(
  event: H3Event,
): Promise<ImapSmtpConnectionInput> {
  requireSameOriginMailRequest(event)
  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Konfiguracja poczty wymaga formatu JSON.' })
  }
  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_SETUP_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Konfiguracja poczty jest zbyt duża.' })
  }

  let payload: unknown
  try {
    const raw = await readBoundedRequestBody(event, MAX_SETUP_REQUEST_BYTES)
    payload = JSON.parse(raw.toString('utf8'))
  }
  catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 413) throw error
    throw createError({ statusCode: 400, statusMessage: 'Konfiguracja poczty jest nieprawidłowa.' })
  }
  const parsed = setupSchema.safeParse(payload)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Sprawdź adresy serwerów, porty i dane logowania.',
    })
  }
  const input = parsed.data
  assertNoControls(input)
  assertHostname(input.imapHost)
  assertHostname(input.smtpHost)
  assertTransport(input.imapPort, input.imapSecurity, 'IMAP')
  assertTransport(input.smtpPort, input.smtpSecurity, 'SMTP')

  const emailDomain = input.accountEmail.split('@').at(-1) || ''
  if (FORCED_OAUTH_DOMAINS.has(emailDomain)) {
    throw createError({
      statusCode: 409,
      statusMessage: emailDomain.includes('gmail')
        ? 'Dla Gmaila użyj bezpiecznego połączenia Google OAuth.'
        : 'Dla Outlooka użyj bezpiecznego połączenia Microsoft OAuth.',
    })
  }
  return input
}

function assertNoControls(input: ImapSmtpConnectionInput): void {
  const values = Object.values(input).filter(value => typeof value === 'string')
  if (values.some(value => /[\u0000-\u001F\u007F]/u.test(value))) {
    throw createError({ statusCode: 400, statusMessage: 'Konfiguracja zawiera niedozwolone znaki.' })
  }
}

function assertHostname(hostname: string): void {
  if (
    !HOSTNAME_PATTERN.test(hostname)
    || hostname === 'localhost'
    || hostname.endsWith('.local')
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.internal')
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Podaj publiczną nazwę hosta serwera pocztowego.' })
  }
}

function assertTransport(
  port: number,
  security: 'tls' | 'starttls',
  protocol: 'IMAP' | 'SMTP',
): void {
  const valid = protocol === 'IMAP'
    ? (port === 993 && security === 'tls') || (port === 143 && security === 'starttls')
    : (port === 465 && security === 'tls') || (port === 587 && security === 'starttls')
  if (!valid) {
    throw createError({
      statusCode: 400,
      statusMessage: `${protocol}: dozwolone są wyłącznie standardowe porty z wymaganym TLS.`,
    })
  }
}
