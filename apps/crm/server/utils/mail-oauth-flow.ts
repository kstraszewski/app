export type MailOAuthProvider = 'google' | 'microsoft'

export interface MailOAuthFlow {
  state: string
  provider: MailOAuthProvider
  organizationSlug: string
  ownerUserId: string
  returnTo: string
  codeVerifier: string
  expiresAt: number
  replacementConnectionId?: string
  expectedAccountId?: string
}

/** Kept only so callbacks started immediately before a deployment can finish. */
export const LEGACY_MAIL_OAUTH_COOKIE = 'openexpert-mail-oauth'
export const MAIL_OAUTH_COOKIE_PREFIX = `${LEGACY_MAIL_OAUTH_COOKIE}-`
export const MAX_ACTIVE_MAIL_OAUTH_FLOWS = 4

const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/u
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_COOKIE_HEADER_BYTES = 32 * 1024
const MAX_COOKIE_PARTS_TO_SCAN = 128
const MAX_FLOW_COOKIE_NAMES_TO_RETURN = 16

export function safeMailOAuthReturnTo(
  value: string | undefined,
  organizationSlug: string,
): string {
  const organizationPrefix = `/org/${encodeURIComponent(organizationSlug)}`
  const defaultReturnTo = `${organizationPrefix}/mail`
  if (!value || !isBoundedLocalReturnTo(value)) return defaultReturnTo
  try {
    const base = new URL('https://openexpert.invalid')
    const parsed = new URL(value, base)
    if (parsed.origin !== base.origin) return defaultReturnTo
    if (parsed.pathname === defaultReturnTo) {
      return `${parsed.pathname}${parsed.search}`
    }
    const escapedPrefix = organizationPrefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const contextualPath = new RegExp(
      `^${escapedPrefix}/(?:clients|cases)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      'iu',
    )
    if (
      contextualPath.test(parsed.pathname)
      && parsed.searchParams.getAll('view').length === 1
      && parsed.searchParams.get('view') === 'mail'
    ) {
      return `${parsed.pathname}?view=mail`
    }
    return defaultReturnTo
  }
  catch {
    return defaultReturnTo
  }
}

export function mailOAuthCookieName(state: string): string {
  if (!OAUTH_STATE_PATTERN.test(state)) {
    throw new TypeError('Mail OAuth state is invalid')
  }
  return `${MAIL_OAUTH_COOKIE_PREFIX}${state}`
}

export function mailOAuthStateFromCookieName(name: string): string | null {
  if (!name.startsWith(MAIL_OAUTH_COOKIE_PREFIX)) return null
  const state = name.slice(MAIL_OAUTH_COOKIE_PREFIX.length)
  return OAUTH_STATE_PATTERN.test(state) ? state : null
}

export function mailOAuthFlowSecretContext(state: string): string {
  mailOAuthCookieName(state)
  return `openexpert-mail-oauth-flow-v1:${state}`
}

export function mailOAuthCookieNames(cookieHeader: string | undefined): string[] {
  if (!cookieHeader || Buffer.byteLength(cookieHeader, 'utf8') > MAX_COOKIE_HEADER_BYTES) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const part of cookieHeader.split(';').slice(0, MAX_COOKIE_PARTS_TO_SCAN)) {
    const separator = part.indexOf('=')
    const name = (separator < 0 ? part : part.slice(0, separator)).trim()
    if (!mailOAuthStateFromCookieName(name) || seen.has(name)) continue
    seen.add(name)
    result.push(name)
    if (result.length >= MAX_FLOW_COOKIE_NAMES_TO_RETURN) break
  }
  return result
}

export function validatedMailOAuthFlow(
  value: unknown,
  expectedState?: string,
): MailOAuthFlow {
  const flow = value as Partial<MailOAuthFlow> | null
  if (
    !flow
    || typeof flow !== 'object'
    || typeof flow.state !== 'string'
    || !OAUTH_STATE_PATTERN.test(flow.state)
    || (expectedState !== undefined && flow.state !== expectedState)
    || !['google', 'microsoft'].includes(String(flow.provider))
    || typeof flow.organizationSlug !== 'string'
    || !isBoundedOpaqueValue(flow.organizationSlug, 200)
    || typeof flow.ownerUserId !== 'string'
    || !UUID_PATTERN.test(flow.ownerUserId)
    || typeof flow.returnTo !== 'string'
    || !isBoundedLocalReturnTo(flow.returnTo)
    || typeof flow.codeVerifier !== 'string'
    || !PKCE_VERIFIER_PATTERN.test(flow.codeVerifier)
    || !Number.isSafeInteger(flow.expiresAt)
    || Number(flow.expiresAt) <= 0
    || !optionalUuid(flow.replacementConnectionId)
    || !optionalBoundedValue(flow.expectedAccountId, 500)
  ) {
    throw new TypeError('Mail OAuth flow is invalid')
  }
  return flow as MailOAuthFlow
}

function isBoundedLocalReturnTo(value: string): boolean {
  return value.length >= 1
    && value.length <= 1_024
    && value.startsWith('/')
    && !value.startsWith('//')
    && !/[\u0000-\u001F\u007F]/u.test(value)
}

function isBoundedOpaqueValue(value: string, maxLength: number): boolean {
  return value.length >= 1
    && value.length <= maxLength
    && !/[\u0000-\u001F\u007F]/u.test(value)
}

function optionalBoundedValue(value: unknown, maxLength: number): boolean {
  return value === undefined
    || (typeof value === 'string' && Boolean(value) && value.length <= maxLength)
}

function optionalUuid(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && UUID_PATTERN.test(value))
}
