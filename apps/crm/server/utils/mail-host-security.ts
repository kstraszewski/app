import { lookup as nodeLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

export type MailEndpointKind = 'imap' | 'smtp'
export type MailEndpointSecurity = 'tls' | 'starttls'

export interface MailEndpointConfig {
  host: string
  port: number
  security: MailEndpointSecurity
}

export interface NormalizedMailEndpoint extends MailEndpointConfig {
  host: string
}

export interface ResolvedMailEndpoint extends NormalizedMailEndpoint {
  /** A validated, public address that must be used as the actual socket target. */
  address: string
  family: 4 | 6
  /** All DNS answers are retained for diagnostics, but never re-resolved by a transport. */
  addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>
  /** The original DNS name used for SNI and certificate hostname verification. */
  servername: string
}

export interface MailHostResolverRuntime {
  lookup?: typeof nodeLookup
  timeoutMs?: number
}

export type MailHostSecurityErrorCode =
  | 'INVALID_HOST'
  | 'INVALID_PORT'
  | 'INVALID_SECURITY'
  | 'DNS_FAILED'
  | 'DNS_TIMEOUT'
  | 'DNS_EMPTY'
  | 'NON_PUBLIC_ADDRESS'

export class MailHostSecurityError extends Error {
  readonly code: MailHostSecurityErrorCode

  constructor(code: MailHostSecurityErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'MailHostSecurityError'
    this.code = code
  }
}

const DEFAULT_DNS_TIMEOUT_MS = 5_000
const MAX_DNS_TIMEOUT_MS = 10_000
const MAX_DNS_ANSWERS = 32

/**
 * Allows only the encrypted, standards-based client ports supported by OpenExpert.
 * Port 25 and opportunistic/plaintext modes are deliberately not supported.
 */
export function normalizeMailEndpoint(
  kind: MailEndpointKind,
  input: MailEndpointConfig,
): NormalizedMailEndpoint {
  const host = normalizeMailHostname(input.host)
  const port = Number(input.port)
  if (!Number.isInteger(port)) {
    throw new MailHostSecurityError('INVALID_PORT', 'Port serwera pocztowego jest nieprawidłowy.')
  }
  if (input.security !== 'tls' && input.security !== 'starttls') {
    throw new MailHostSecurityError(
      'INVALID_SECURITY',
      'Połączenie z serwerem pocztowym musi używać TLS.',
    )
  }

  const supported = kind === 'imap'
    ? (port === 993 && input.security === 'tls')
      || (port === 143 && input.security === 'starttls')
    : (port === 465 && input.security === 'tls')
      || (port === 587 && input.security === 'starttls')
  if (!supported) {
    throw new MailHostSecurityError(
      'INVALID_PORT',
      kind === 'imap'
        ? 'IMAP wymaga portu 993 (TLS) albo 143 (wymagany STARTTLS).'
        : 'SMTP wymaga portu 465 (TLS) albo 587 (wymagany STARTTLS).',
    )
  }

  return { host, port, security: input.security }
}

/**
 * Normalizes an internationalized DNS name and rejects URLs and IP literals.
 * Direct IP input is intentionally forbidden so TLS always has a DNS identity.
 */
export function normalizeMailHostname(value: string): string {
  const input = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const withoutTrailingDot = input.endsWith('.') ? input.slice(0, -1) : input
  if (
    !withoutTrailingDot
    || withoutTrailingDot.length > 253
    || /[\u0000-\u0020\u007F:/\\@?#\[\]%]/u.test(withoutTrailingDot)
    || isIP(withoutTrailingDot) !== 0
  ) {
    throw new MailHostSecurityError('INVALID_HOST', 'Nazwa serwera pocztowego jest nieprawidłowa.')
  }

  const ascii = domainToASCII(withoutTrailingDot).toLowerCase()
  const labels = ascii.split('.')
  if (
    !ascii
    || ascii.length > 253
    || labels.length < 2
    || labels.some(label => (
      label.length < 1
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
    ))
  ) {
    throw new MailHostSecurityError('INVALID_HOST', 'Nazwa serwera pocztowego jest nieprawidłowa.')
  }
  return ascii
}

/**
 * Resolves every A/AAAA answer, rejects the whole hostname when any answer is
 * non-public, and returns a concrete address transports must pin their socket to.
 * This all-answers policy plus address pinning closes the DNS-rebinding gap.
 */
export async function resolveSecureMailEndpoint(
  kind: MailEndpointKind,
  input: MailEndpointConfig,
  runtime: MailHostResolverRuntime = {},
): Promise<ResolvedMailEndpoint> {
  const endpoint = normalizeMailEndpoint(kind, input)
  const lookup = runtime.lookup ?? nodeLookup
  const timeoutMs = boundedTimeout(runtime.timeoutMs)

  let answers: Array<{ address: string; family: number }> | { address: string; family: number }
  try {
    answers = await withTimeout(
      lookup(endpoint.host, { all: true, verbatim: true }) as Promise<
        Array<{ address: string; family: number }> | { address: string; family: number }
      >,
      timeoutMs,
      () => new MailHostSecurityError(
        'DNS_TIMEOUT',
        'Przekroczono czas rozpoznawania serwera pocztowego.',
      ),
    )
  } catch (error) {
    if (error instanceof MailHostSecurityError) throw error
    throw new MailHostSecurityError(
      'DNS_FAILED',
      'Nie udało się rozpoznać serwera pocztowego.',
      { cause: error },
    )
  }

  const rawAnswers = Array.isArray(answers) ? answers : [answers]
  if (!rawAnswers.length || rawAnswers.length > MAX_DNS_ANSWERS) {
    throw new MailHostSecurityError(
      'DNS_EMPTY',
      'Serwer pocztowy nie zwrócił prawidłowego adresu.',
    )
  }

  const unique = new Map<string, { address: string; family: 4 | 6 }>()
  for (const answer of rawAnswers) {
    const address = String(answer.address ?? '').trim().toLowerCase()
    const family = isIP(address)
    if ((family !== 4 && family !== 6) || !isPublicMailAddress(address)) {
      throw new MailHostSecurityError(
        'NON_PUBLIC_ADDRESS',
        'Serwer pocztowy wskazuje na niedozwolony adres sieciowy.',
      )
    }
    unique.set(`${family}:${canonicalIp(address)}`, {
      address: canonicalIp(address),
      family,
    })
  }

  const addresses = [...unique.values()]
  if (!addresses.length) {
    throw new MailHostSecurityError(
      'DNS_EMPTY',
      'Serwer pocztowy nie zwrócił prawidłowego adresu.',
    )
  }
  const selected = addresses[0]!
  return {
    ...endpoint,
    ...selected,
    addresses,
    servername: endpoint.host,
  }
}

/** Returns true only for globally routable unicast IPv4/IPv6 addresses. */
export function isPublicMailAddress(value: string): boolean {
  const family = isIP(value)
  if (family === 4) return isPublicIpv4(value)
  if (family === 6) return isPublicIpv6(value)
  return false
}

function isPublicIpv4(value: string): boolean {
  const bytes = parseIpv4(value)
  if (!bytes) return false
  const [a, b, c] = bytes
  if (
    a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
  ) {
    return false
  }
  return true
}

function isPublicIpv6(value: string): boolean {
  const parsed = parseIpv6(value)
  if (parsed === null) return false

  const inRange = (prefix: bigint, bits: number): boolean => {
    const shift = BigInt(128 - bits)
    return (parsed >> shift) === (prefix >> shift)
  }
  const prefix = (value: string): bigint => parseIpv6(value) ?? BigInt(0)

  // IANA currently allocates global unicast addresses from 2000::/3.
  // A strict allow-range also rejects future/reserved spaces by default.
  if (!inRange(prefix('2000::'), 3)) return false

  return !(
    parsed === BigInt(0)
    || parsed === BigInt(1)
    || inRange(prefix('::ffff:0:0'), 96)
    || inRange(prefix('64:ff9b::'), 96)
    || inRange(prefix('64:ff9b:1::'), 48)
    || inRange(prefix('100::'), 64)
    || inRange(prefix('2001::'), 32)
    || inRange(prefix('2001:2::'), 48)
    || inRange(prefix('2001:10::'), 28)
    || inRange(prefix('2001:db8::'), 32)
    || inRange(prefix('2002::'), 16)
    || inRange(prefix('3fff::'), 20)
    || inRange(prefix('fc00::'), 7)
    || inRange(prefix('fe80::'), 10)
    || inRange(prefix('fec0::'), 10)
    || inRange(prefix('ff00::'), 8)
  )
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map(part => Number(part))
  if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null
  return bytes as [number, number, number, number]
}

function parseIpv6(input: string): bigint | null {
  if (!input || input.includes('%') || input.split('::').length > 2) return null
  let value = input.toLowerCase()
  const ipv4Tail = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1]
  if (ipv4Tail) {
    const bytes = parseIpv4(ipv4Tail)
    if (!bytes) return null
    const replacement = `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`
    value = `${value.slice(0, -ipv4Tail.length)}${replacement}`
  }

  const [leftValue, rightValue] = value.split('::')
  const left = leftValue ? leftValue.split(':') : []
  const right = rightValue ? rightValue.split(':') : []
  if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/u.test(part))) return null
  const hasCompression = value.includes('::')
  const missing = 8 - left.length - right.length
  if ((hasCompression && missing < 1) || (!hasCompression && missing !== 0)) return null
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...right]
  if (groups.length !== 8) return null

  return groups.reduce(
    (result, group) => (result << BigInt(16)) | BigInt(Number.parseInt(group, 16)),
    BigInt(0),
  )
}

function canonicalIp(value: string): string {
  if (isIP(value) === 4) return parseIpv4(value)!.join('.')
  const parsed = parseIpv6(value)
  if (parsed === null) return value
  return parsed
    .toString(16)
    .padStart(32, '0')
    .match(/.{4}/gu)!
    .join(':')
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DNS_TIMEOUT_MS
  if (!Number.isInteger(value) || value < 1 || value > MAX_DNS_TIMEOUT_MS) {
    throw new MailHostSecurityError('DNS_TIMEOUT', 'Limit czasu DNS jest nieprawidłowy.')
  }
  return value
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorFactory: () => Error,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(errorFactory()), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
