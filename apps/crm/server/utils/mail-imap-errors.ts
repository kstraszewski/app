import { createError, type H3Error } from 'h3'
import { MailHostSecurityError } from './mail-host-security.ts'
import {
  ImapSmtpConfigurationError,
  ImapSmtpDeliveryError,
  ImapSmtpMailboxStateError,
} from './mail-imap-smtp.ts'

export type ImapSmtpErrorOperation = 'setup' | 'read' | 'send'

type ImapSmtpErrorKind =
  | 'request'
  | 'mailbox-state'
  | 'configuration'
  | 'credentials'
  | 'authentication'
  | 'tls'
  | 'timeout'
  | 'transport'
  | 'delivery-rejected'
  | 'delivery-ambiguous'
  | 'unknown'

const AUTH_CODES = new Set([
  'AUTHENTICATIONFAILED',
  'EAUTH',
  'LOGINFAILED',
  'NOAUTH',
  'UNAUTHORIZED',
])
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_SSL_CERTIFICATE_VERIFY_FAILED',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])
const TIMEOUT_CODES = new Set([
  'CONNECT_TIMEOUT',
  'ECONNECTIONTIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ETIMEOUT',
  'ETIMEDOUT',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'GREETING_TIMEOUT',
  'LOCKTIMEOUT',
  'UPGRADE_TIMEOUT',
])
const TRANSPORT_CODES = new Set([
  'CLOSEDAFTERCONNECTTEXT',
  'CLOSEDAFTERCONNECTTLS',
  'EAI_AGAIN',
  'ECONNECTIONCLOSED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNECTION',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ESOCKET',
  'NOCONNECTION',
])
const CREDENTIAL_STATUS_MESSAGES = new Set([
  'Konfiguracja skrzynki IMAP/SMTP jest niekompletna.',
  'Mail credentials are unavailable',
  'Stored mail credentials are invalid',
])
const CONNECTION_FAILURE_REASON = Symbol('openexpert.imapSmtpConnectionFailureReason')

/**
 * Converts every generic IMAP/SMTP failure crossing an API boundary into a
 * small, reviewed set of user-facing errors. Provider responses, hostnames,
 * usernames and secrets are deliberately never copied to the H3 payload.
 */
export function safeImapSmtpError(
  error: unknown,
  operation: ImapSmtpErrorOperation,
): H3Error<{ deliveryAmbiguous?: true }> {
  const kind = classifyImapSmtpError(error)
  const mapped = createSafeImapSmtpError(kind, operation)
  const failureReason = imapSmtpConnectionFailureReason(error)
  if (failureReason) {
    Object.defineProperty(mapped, CONNECTION_FAILURE_REASON, {
      configurable: false,
      enumerable: false,
      value: failureReason,
      writable: false,
    })
  }
  return mapped
}

function createSafeImapSmtpError(
  kind: ImapSmtpErrorKind,
  operation: ImapSmtpErrorOperation,
): H3Error<{ deliveryAmbiguous?: true }> {
  if (kind === 'delivery-ambiguous') {
    return createError({
      statusCode: 502,
      statusMessage: 'Nie udało się potwierdzić wysyłki. Sprawdź folder Wysłane przed ponowieniem.',
      data: { deliveryAmbiguous: true },
    })
  }
  if (kind === 'delivery-rejected') {
    return createError({
      statusCode: 502,
      statusMessage: 'Serwer SMTP odrzucił wiadomość przed wysyłką.',
    })
  }
  if (kind === 'request') {
    return createError({
      statusCode: 400,
      statusMessage: 'Identyfikator lub kursor wiadomości jest nieprawidłowy.',
    })
  }
  if (kind === 'mailbox-state') {
    return createError({
      statusCode: 409,
      statusMessage: 'Folder lub wiadomość zmieniły się. Odśwież listę wiadomości.',
    })
  }
  if (kind === 'configuration') {
    return createError({
      statusCode: operation === 'read' ? 409 : 400,
      statusMessage: operation === 'read'
        ? 'Zapisana konfiguracja skrzynki jest nieprawidłowa. Połącz konto ponownie.'
        : operation === 'send'
          ? 'Nie udało się przygotować wiadomości do wysłania.'
          : 'Sprawdź ustawienia serwerów, porty i wymagane szyfrowanie.',
    })
  }
  if (kind === 'credentials' || kind === 'authentication') {
    return createError({
      statusCode: 409,
      statusMessage: 'Dane logowania do skrzynki są nieprawidłowe lub wygasły. Połącz konto ponownie.',
    })
  }
  if (kind === 'tls') {
    return createError({
      statusCode: 502,
      statusMessage: 'Nie udało się zestawić bezpiecznego połączenia TLS z serwerem pocztowym.',
    })
  }
  if (kind === 'timeout') {
    return createError({
      statusCode: 504,
      statusMessage: 'Serwer pocztowy nie odpowiedział w wymaganym czasie.',
    })
  }
  if (kind === 'transport') {
    return createError({
      statusCode: 502,
      statusMessage: 'Nie udało się połączyć z serwerem pocztowym.',
    })
  }
  return createError({
    statusCode: 502,
    statusMessage: operation === 'send'
      ? 'Nie udało się wysłać wiadomości przez skonfigurowane konto.'
      : operation === 'setup'
        ? 'Nie udało się zweryfikować połączenia z serwerem pocztowym.'
        : 'Nie udało się pobrać danych ze skrzynki pocztowej.',
  })
}

/** Only these failures should move a persisted IMAP connection into `error`. */
export function imapSmtpConnectionFailureReason(error: unknown): string | null {
  const taggedReason = error && typeof error === 'object'
    ? String((error as { [CONNECTION_FAILURE_REASON]?: unknown })[CONNECTION_FAILURE_REASON] ?? '')
    : ''
  if (/^IMAP_SMTP_[A-Z_]{3,64}$/u.test(taggedReason)) return taggedReason
  if (error instanceof ImapSmtpDeliveryError) {
    return connectionFailureReasonForKind(classifyGenericError(error.cause))
  }
  return connectionFailureReasonForKind(classifyImapSmtpError(error))
}

function connectionFailureReasonForKind(kind: ImapSmtpErrorKind): string | null {
  if (kind === 'credentials') return 'IMAP_SMTP_CREDENTIALS_INVALID'
  if (kind === 'authentication') return 'IMAP_SMTP_AUTHENTICATION_FAILED'
  if (kind === 'tls') return 'IMAP_SMTP_TLS_FAILED'
  if (kind === 'timeout') return 'IMAP_SMTP_TIMEOUT'
  if (kind === 'transport') return 'IMAP_SMTP_TRANSPORT_FAILED'
  return null
}

function classifyImapSmtpError(error: unknown): ImapSmtpErrorKind {
  if (error instanceof ImapSmtpDeliveryError) {
    if (error.deliveryAmbiguous) return 'delivery-ambiguous'
    const causeKind = classifyGenericError(error.cause)
    return ['authentication', 'tls', 'timeout', 'transport'].includes(causeKind)
      ? causeKind
      : 'delivery-rejected'
  }
  if (error instanceof ImapSmtpMailboxStateError) return 'mailbox-state'
  if (error instanceof TypeError) return 'request'
  if (error instanceof ImapSmtpConfigurationError) return 'configuration'
  if (error instanceof MailHostSecurityError) {
    if (error.code === 'DNS_TIMEOUT') return 'timeout'
    if (['DNS_FAILED', 'DNS_EMPTY'].includes(error.code)) return 'transport'
    return 'configuration'
  }

  const statusMessage = String((error as { statusMessage?: unknown } | null)?.statusMessage ?? '')
  if (CREDENTIAL_STATUS_MESSAGES.has(statusMessage)) return 'credentials'
  return classifyGenericError(error)
}

function classifyGenericError(error: unknown): ImapSmtpErrorKind {
  for (const value of errorChain(error)) {
    const record = value as Record<string, unknown>
    const code = String(record.code ?? record.responseCode ?? '').trim().toUpperCase()
    const command = String(record.command ?? '').trim().toUpperCase()
    const message = value instanceof Error ? value.message : ''

    if (
      record.authenticationFailed === true
      || AUTH_CODES.has(code)
      || command === 'AUTH'
      || /\b(?:authentication failed|invalid credentials|login failed)\b/iu.test(message)
    ) return 'authentication'
    if (
      TIMEOUT_CODES.has(code)
      || /\b(?:timed?\s*out|timeout)\b/iu.test(message)
    ) return 'timeout'
    if (
      TLS_CODES.has(code)
      || /\b(?:certificate|ssl|tls)\b/iu.test(message)
    ) return 'tls'
    if (TRANSPORT_CODES.has(code)) return 'transport'
  }
  return 'unknown'
}

function errorChain(error: unknown): unknown[] {
  const values: unknown[] = []
  const seen = new Set<unknown>()
  let current = error
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    values.push(current)
    seen.add(current)
    current = typeof current === 'object'
      ? (current as { cause?: unknown }).cause
      : undefined
  }
  return values
}
