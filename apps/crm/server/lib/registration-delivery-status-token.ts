import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_CONTEXT = 'openexpert-registration-delivery-status-v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_TOKEN_LENGTH = 1_024

interface RegistrationDeliveryStatusPayload {
  invitationId: string
  expiresAt: string
}

function signingInput(encodedPayload: string): string {
  return `${TOKEN_CONTEXT}.${encodedPayload}`
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(signingInput(encodedPayload))
    .digest()
}

function validPayload(value: unknown): value is RegistrationDeliveryStatusPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<RegistrationDeliveryStatusPayload>
  return typeof payload.invitationId === 'string'
    && UUID_PATTERN.test(payload.invitationId)
    && typeof payload.expiresAt === 'string'
    && Number.isFinite(Date.parse(payload.expiresAt))
}

export function createRegistrationDeliveryStatusToken(
  payload: RegistrationDeliveryStatusPayload,
  secret: string,
): string {
  if (!validPayload(payload)) throw new TypeError('Registration status payload is invalid')
  if (!secret) throw new TypeError('Registration status secret is missing')
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encodedPayload}.${signature(encodedPayload, secret).toString('base64url')}`
}

export function verifyRegistrationDeliveryStatusToken(
  token: unknown,
  secret: string,
  now = Date.now(),
): RegistrationDeliveryStatusPayload | null {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH || !secret) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  let suppliedSignature: Buffer
  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url')
  }
  catch {
    return null
  }
  const expectedSignature = signature(parts[0], secret)
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) return null

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  }
  catch {
    return null
  }
  if (!validPayload(payload) || Date.parse(payload.expiresAt) <= now) return null
  return payload
}
