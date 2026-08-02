import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

export const DEMO_SESSION_TTL_SECONDS = 12 * 60 * 60

export function isSecureDemoAccessCode(value: string): boolean {
  return value.length >= 20
    && value.length <= 256
    && !/[\p{Cc}\p{Cf}]/u.test(value)
}

function derivedAccessCode(value: string, salt: string): Buffer {
  return scryptSync(value, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
}

export function createDemoAccessCodeHash(
  value: string,
  salt = randomBytes(16).toString('base64url'),
): string {
  if (!isSecureDemoAccessCode(value) || !salt) {
    throw new Error('Invalid demo access code')
  }
  return `scrypt$v1$${salt}$${derivedAccessCode(value, salt).toString('base64url')}`
}

export function isDemoAccessCodeHash(value: string): boolean {
  return /^scrypt\$v1\$[A-Za-z0-9_-]{16,128}\$[A-Za-z0-9_-]{43}$/u.test(value)
}

export function demoAccessCodeMatchesHash(provided: string, stored: string): boolean {
  if (!provided || !isDemoAccessCodeHash(stored)) return false
  const [algorithm, version, salt, expected, ...rest] = stored.split('$')
  if (rest.length || algorithm !== 'scrypt' || version !== 'v1' || !salt || !expected) return false

  try {
    const receivedBuffer = derivedAccessCode(provided, salt)
    const expectedBuffer = Buffer.from(expected, 'base64url')
    return receivedBuffer.length === expectedBuffer.length
      && timingSafeEqual(receivedBuffer, expectedBuffer)
  }
  catch {
    return false
  }
}

function demoSessionSignature(secret: string, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(`openexpert-demo:v1:${expiresAt}`, 'utf8')
    .digest('base64url')
}

export function createDemoSessionToken(secret: string, expiresAt: number): string {
  if (secret.length < 32 || !Number.isSafeInteger(expiresAt)) {
    throw new Error('Invalid demo session configuration')
  }
  return `${expiresAt}.${demoSessionSignature(secret, expiresAt)}`
}

export function verifyDemoSessionToken(
  secret: string,
  value: unknown,
  now = Math.floor(Date.now() / 1_000),
): boolean {
  if (secret.length < 32 || typeof value !== 'string') return false

  const [expiresAtRaw, signature, ...rest] = value.split('.')
  if (
    rest.length
    || !expiresAtRaw
    || !signature
    || !/^\d{10}$/u.test(expiresAtRaw)
  ) return false

  const expiresAt = Number(expiresAtRaw)
  if (
    !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
    || expiresAt > now + DEMO_SESSION_TTL_SECONDS + 60
  ) return false

  const expected = demoSessionSignature(secret, expiresAt)
  const receivedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer)
}
