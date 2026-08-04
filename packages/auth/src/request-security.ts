import { isIP } from 'node:net'

const HEADER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

function normalizeIpAddress(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? ''
  if (!candidate || candidate.includes(',') || isIP(candidate) === 0) return null
  if (isIP(candidate) === 4) return candidate

  try {
    return new URL(`http://[${candidate}]/`).hostname.replace(/^\[|\]$/gu, '')
  }
  catch {
    return null
  }
}

/**
 * Resolves an address only from explicitly trusted, single-value proxy
 * headers. When no trusted header is configured, the direct socket address is
 * used instead. Comma-separated X-Forwarded-For chains are intentionally not
 * accepted without a proxy allowlist.
 */
export function getOpenExpertTrustedClientIp(input: {
  headers: Headers
  directAddress?: string | null
  trustedHeaderNames?: readonly string[]
}): string {
  for (const rawName of input.trustedHeaderNames ?? []) {
    const name = rawName.trim().toLowerCase()
    if (!HEADER_NAME_PATTERN.test(name)) continue
    const address = normalizeIpAddress(input.headers.get(name))
    if (address) return address
  }
  return normalizeIpAddress(input.directAddress) ?? 'unknown'
}

/**
 * Public auth-message wrappers accept browser JSON calls from their own
 * origin only. Requiring JSON also prevents a cross-site HTML form from
 * becoming a mail/SMS trigger.
 */
export function isOpenExpertSameOriginJsonRequest(
  headers: Headers,
  baseURL: string,
): boolean {
  const contentType = headers.get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (contentType !== 'application/json') return false

  const fetchSite = headers.get('sec-fetch-site')?.trim().toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return false
  }

  let expectedOrigin: string
  try {
    expectedOrigin = new URL(baseURL).origin
  }
  catch {
    return false
  }

  const origin = headers.get('origin')?.trim()
  if (origin) return origin === expectedOrigin

  const referer = headers.get('referer')?.trim()
  if (!referer) return false
  try {
    return new URL(referer).origin === expectedOrigin
  }
  catch {
    return false
  }
}
