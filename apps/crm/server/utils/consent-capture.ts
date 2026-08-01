import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'

export const CONSENT_CAPTURE_TOKEN_BYTES = 32
export const CONSENT_CAPTURE_OTP_LENGTH = 6
export const CONSENT_CAPTURE_DEFAULT_TTL_SECONDS = 10 * 60
export const CONSENT_CAPTURE_DEFAULT_MAX_OTP_ATTEMPTS = 5
export const CONSENT_CAPTURE_VERIFICATION_COOKIE = 'openexpert-consent-verification'

export const consentCaptureActiveStatuses = [
  'pending',
  'queued',
  'sent',
  'delivered',
  'opened',
  'verified',
] as const

export const consentCaptureFinalStatuses = [
  'accepted',
  'declined',
  'withdrawn',
  'expired',
  'cancelled',
  'failed',
] as const

export type ConsentCaptureIntent = 'collect' | 'withdraw'
export type ConsentCaptureDecision = 'granted' | 'declined' | 'withdrawn'
export type ConsentCaptureActiveStatus = typeof consentCaptureActiveStatuses[number]
export type ConsentCaptureFinalStatus = typeof consentCaptureFinalStatuses[number]
export type ConsentCaptureStatus = ConsentCaptureActiveStatus | ConsentCaptureFinalStatus
export type ConsentSmsProvider = 'local' | 'http'

export interface ConsentSmsRuntimeInput {
  provider?: unknown
  demoAutoFill?: unknown
  gatewayUrl?: unknown
  gatewayToken?: unknown
  sender?: unknown
  otpSecret?: unknown
  publicBaseUrl?: unknown
  ttlSeconds?: unknown
  maxOtpAttempts?: unknown
}

export interface ConsentSmsConfig {
  provider: ConsentSmsProvider
  demoAutoFill: boolean
  gatewayUrl: string
  gatewayToken: string
  sender: string
  otpSecret: string
  publicBaseUrl: string
  ttlSeconds: number
  maxOtpAttempts: number
}

export interface ConsentSmsMessage {
  requestId: string
  destination: string
  body: string
}

export interface ConsentSmsSendResult {
  provider: ConsentSmsProvider
  providerMessageId: string
}

export class ConsentCaptureConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConsentCaptureConfigurationError'
  }
}

const publicTokenPattern = /^[A-Za-z0-9_-]{43}$/
const otpPattern = /^\d{6}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hmacPattern = /^[0-9a-f]{64}$/

function configText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function configBoolean(input: unknown, fallback: boolean, field: string): boolean {
  if (input === undefined || input === null || input === '') return fallback
  if (input === true || input === 'true') return true
  if (input === false || input === 'false') return false
  throw new ConsentCaptureConfigurationError(`${field} must be true or false`)
}

function configInteger(
  input: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const value = typeof input === 'number'
    ? input
    : typeof input === 'string' && input.trim()
      ? Number(input)
      : fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConsentCaptureConfigurationError(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    )
  }
  return value
}

function requireHmacSecret(secret: string): void {
  if (!secret) {
    throw new ConsentCaptureConfigurationError('Consent OTP secret is not configured')
  }
}

function consentHmac(secret: string, domain: string, ...values: string[]): string {
  requireHmacSecret(secret)
  const hmac = createHmac('sha256', secret)
  hmac.update(`openexpert:${domain}:v1`, 'utf8')
  for (const value of values) {
    hmac.update('\0', 'utf8')
    hmac.update(value, 'utf8')
  }
  return hmac.digest('hex')
}

export function resolveConsentSmsConfig(
  input: ConsentSmsRuntimeInput,
  options: { production?: boolean } = {},
): ConsentSmsConfig {
  const production = options.production === true
  const providerValue = configText(input.provider) || (production ? 'http' : 'local')
  const demoAutoFill = configBoolean(
    input.demoAutoFill,
    false,
    'Consent SMS demo auto-fill',
  )
  if (providerValue !== 'local' && providerValue !== 'http') {
    throw new ConsentCaptureConfigurationError(
      'Consent SMS provider must be local or http',
    )
  }
  if (demoAutoFill && providerValue !== 'local') {
    throw new ConsentCaptureConfigurationError(
      'Consent SMS demo auto-fill requires the local provider',
    )
  }
  if (production && providerValue === 'local' && !demoAutoFill) {
    throw new ConsentCaptureConfigurationError(
      'The local consent SMS provider requires explicit demo auto-fill in production',
    )
  }

  const otpSecret = configText(input.otpSecret)
  if (otpSecret.length < 32) {
    throw new ConsentCaptureConfigurationError(
      'Consent OTP secret must contain at least 32 characters',
    )
  }

  const publicBaseUrl = configText(input.publicBaseUrl)
  let parsedPublicBaseUrl: URL
  try {
    parsedPublicBaseUrl = new URL(publicBaseUrl)
  } catch {
    throw new ConsentCaptureConfigurationError('Consent public base URL is invalid')
  }
  if (!['http:', 'https:'].includes(parsedPublicBaseUrl.protocol)) {
    throw new ConsentCaptureConfigurationError('Consent public base URL must use HTTP or HTTPS')
  }
  if (production && parsedPublicBaseUrl.protocol !== 'https:') {
    throw new ConsentCaptureConfigurationError('Consent public base URL must use HTTPS in production')
  }

  const gatewayUrl = configText(input.gatewayUrl)
  const gatewayToken = configText(input.gatewayToken)
  const sender = configText(input.sender)
  if (providerValue === 'http') {
    let parsedGatewayUrl: URL
    try {
      parsedGatewayUrl = new URL(gatewayUrl)
    } catch {
      throw new ConsentCaptureConfigurationError('Consent SMS gateway URL is invalid')
    }
    if (!['http:', 'https:'].includes(parsedGatewayUrl.protocol)) {
      throw new ConsentCaptureConfigurationError('Consent SMS gateway must use HTTP or HTTPS')
    }
    if (production && parsedGatewayUrl.protocol !== 'https:') {
      throw new ConsentCaptureConfigurationError('Consent SMS gateway must use HTTPS in production')
    }
    if (!gatewayToken) {
      throw new ConsentCaptureConfigurationError('Consent SMS gateway token is not configured')
    }
    if (!sender) {
      throw new ConsentCaptureConfigurationError('Consent SMS sender is not configured')
    }
  }

  return {
    provider: providerValue,
    demoAutoFill,
    gatewayUrl,
    gatewayToken,
    sender,
    otpSecret,
    publicBaseUrl: parsedPublicBaseUrl.origin,
    ttlSeconds: configInteger(
      input.ttlSeconds,
      CONSENT_CAPTURE_DEFAULT_TTL_SECONDS,
      60,
      60 * 60,
      'Consent SMS TTL',
    ),
    maxOtpAttempts: configInteger(
      input.maxOtpAttempts,
      CONSENT_CAPTURE_DEFAULT_MAX_OTP_ATTEMPTS,
      1,
      10,
      'Consent OTP attempt limit',
    ),
  }
}

export function generateConsentCaptureToken(): string {
  return randomBytes(CONSENT_CAPTURE_TOKEN_BYTES).toString('base64url')
}

export function isConsentCaptureToken(input: unknown): input is string {
  return typeof input === 'string' && publicTokenPattern.test(input)
}

export function generateConsentCaptureOtp(): string {
  return randomInt(0, 10 ** CONSENT_CAPTURE_OTP_LENGTH)
    .toString()
    .padStart(CONSENT_CAPTURE_OTP_LENGTH, '0')
}

export function isConsentCaptureOtp(input: unknown): input is string {
  return typeof input === 'string' && otpPattern.test(input)
}

export function isConsentCaptureUuid(input: unknown): input is string {
  return typeof input === 'string' && uuidPattern.test(input)
}

export function hashConsentCaptureToken(secret: string, token: string): string {
  if (!isConsentCaptureToken(token)) {
    throw new TypeError('Invalid consent capture token')
  }
  return consentHmac(secret, 'consent-capture-token', token)
}

export function hashConsentCaptureOtp(
  secret: string,
  requestId: string,
  otp: string,
): string {
  if (!isConsentCaptureUuid(requestId)) {
    throw new TypeError('Invalid consent capture request ID')
  }
  if (!isConsentCaptureOtp(otp)) {
    throw new TypeError('Invalid consent capture OTP')
  }
  return consentHmac(secret, 'consent-capture-otp', requestId, otp)
}

export function createConsentVerificationProof(
  secret: string,
  requestId: string,
  tokenHash: string,
): string {
  if (!isConsentCaptureUuid(requestId) || !hmacPattern.test(tokenHash)) {
    throw new TypeError('Invalid consent verification proof input')
  }
  return consentHmac(secret, 'consent-capture-verification', requestId, tokenHash)
}

export function consentVerificationCookieName(tokenHash: string): string {
  if (!hmacPattern.test(tokenHash)) {
    throw new TypeError('Invalid consent token hash')
  }
  return `${CONSENT_CAPTURE_VERIFICATION_COOKIE}-${tokenHash.slice(0, 16)}`
}

export function securelyEqualConsentHash(left: unknown, right: unknown): boolean {
  if (
    typeof left !== 'string'
    || typeof right !== 'string'
    || !hmacPattern.test(left)
    || !hmacPattern.test(right)
  ) {
    return false
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

export function verifyConsentCaptureOtp(
  secret: string,
  requestId: string,
  otp: string,
  expectedHash: unknown,
): boolean {
  if (!isConsentCaptureOtp(otp)) return false
  return securelyEqualConsentHash(
    hashConsentCaptureOtp(secret, requestId, otp),
    expectedHash,
  )
}

export function verifyConsentVerificationProof(
  secret: string,
  requestId: string,
  tokenHash: string,
  proof: unknown,
): boolean {
  return securelyEqualConsentHash(
    createConsentVerificationProof(secret, requestId, tokenHash),
    proof,
  )
}

export function normalizeConsentPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.length > 50 || /[A-Za-z]/.test(raw)) return null

  const compact = raw.replace(/[\s().-]+/g, '')
  let candidate: string
  if (compact.startsWith('+')) {
    candidate = compact
  } else if (compact.startsWith('00')) {
    candidate = `+${compact.slice(2)}`
  } else if (/^\d{9}$/.test(compact)) {
    candidate = `+48${compact}`
  } else if (/^48\d{9}$/.test(compact)) {
    candidate = `+${compact}`
  } else {
    return null
  }

  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null
}

export function maskConsentPhone(input: string): string {
  const normalized = normalizeConsentPhone(input)
  if (!normalized) return '••• ••• •••'
  return `••• ••• ${normalized.slice(-3)}`
}

export function consentCapturePublicUrl(baseUrl: string, token: string): string {
  if (!isConsentCaptureToken(token)) {
    throw new TypeError('Invalid consent capture token')
  }
  const url = new URL(`/consent/${encodeURIComponent(token)}`, baseUrl)
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function consentCaptureDemoUrl(publicUrl: string, otp: string): string {
  if (!isConsentCaptureOtp(otp)) {
    throw new TypeError('Invalid consent capture OTP')
  }
  const url = new URL(publicUrl)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Invalid consent capture public URL')
  }
  url.hash = new URLSearchParams({ 'demo-code': otp }).toString()
  return url.toString()
}

export function buildConsentSmsBody(input: {
  intent: ConsentCaptureIntent
  otp: string
  publicUrl: string
  ttlSeconds: number
}): string {
  if (!isConsentCaptureOtp(input.otp)) {
    throw new TypeError('Invalid consent capture OTP')
  }
  const minutes = Math.max(1, Math.ceil(input.ttlSeconds / 60))
  const action = input.intent === 'withdraw'
    ? 'Wycofanie zgody'
    : 'Decyzja dotycząca zgody'
  return `OpenExpert: ${action}. Kod: ${input.otp}. Otwórz ${input.publicUrl} Kod i link wygasają za ${minutes} min.`
}

function providerMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  for (const key of ['messageId', 'message_id', 'id']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200)
  }
  for (const key of ['data', 'message', 'result']) {
    const nested = providerMessageId(record[key])
    if (nested) return nested
  }
  return null
}

export async function sendConsentSms(
  config: ConsentSmsConfig,
  message: ConsentSmsMessage,
): Promise<ConsentSmsSendResult> {
  if (config.provider === 'local') {
    return {
      provider: 'local',
      providerMessageId: `local-${message.requestId}`,
    }
  }

  let response: Response
  try {
    response = await fetch(config.gatewayUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.gatewayToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: message.destination,
        from: config.sender,
        message: message.body,
        clientReference: message.requestId,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('Consent SMS gateway is unavailable')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`Consent SMS gateway rejected the message (${response.status})`)
  }
  const messageId = providerMessageId(payload)
  if (!messageId) {
    throw new Error('Consent SMS gateway response did not include a message ID')
  }

  return {
    provider: 'http',
    providerMessageId: messageId,
  }
}

export function consentDecisionAllowed(
  intent: ConsentCaptureIntent,
  decision: unknown,
): decision is ConsentCaptureDecision {
  return intent === 'collect'
    ? decision === 'granted' || decision === 'declined'
    : decision === 'withdrawn'
}

export function isConsentCaptureActiveStatus(
  input: unknown,
): input is ConsentCaptureActiveStatus {
  return typeof input === 'string'
    && (consentCaptureActiveStatuses as readonly string[]).includes(input)
}

export function isConsentCaptureFinalStatus(
  input: unknown,
): input is ConsentCaptureFinalStatus {
  return typeof input === 'string'
    && (consentCaptureFinalStatuses as readonly string[]).includes(input)
}
