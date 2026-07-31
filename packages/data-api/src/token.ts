import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto'

export interface DataApiTokenSignerOptions {
  audience: string
  issuer: string
  keyId: string
  privateKey: string | JsonWebKey | KeyObject
  publicKey?: string | JsonWebKey | KeyObject
  ttlSeconds?: number
}

export interface DataApiPublicJwk extends JsonWebKey {
  alg: 'EdDSA'
  kid: string
  use: 'sig'
}

export interface DataApiTokenClaims {
  sub?: string
  role: 'anonymous' | 'authenticated' | 'openexpert_service'
  [claim: string]: unknown
}

export interface DataApiTokenSigner {
  jwks: {
    keys: DataApiPublicJwk[]
  }
  sign: (claims: DataApiTokenClaims) => string
  signAnonymous: (claims?: Record<string, unknown>) => string
  signBackend: (claims?: Record<string, unknown>) => string
  signUser: (userId: string, claims?: Record<string, unknown>) => string
}

export interface VerifyDataApiTokenOptions {
  audience: string
  issuer: string
  publicJwk: JsonWebKey
  expectedRole?: DataApiTokenClaims['role']
  clockToleranceSeconds?: number
  now?: number
}

export interface VerifiedDataApiToken extends DataApiTokenClaims {
  aud: string
  exp: number
  iat: number
  iss: string
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
  }
  catch {
    throw new TypeError(`Invalid Data API JWT ${label}`)
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }
  return value
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${label} is required`)
  return normalized
}

function privateKeyObject(input: DataApiTokenSignerOptions['privateKey']): KeyObject {
  if (input instanceof KeyObject) return input
  if (typeof input === 'string') return createPrivateKey(input)
  return createPrivateKey({ format: 'jwk', key: input })
}

function publicKeyObject(
  input: DataApiTokenSignerOptions['publicKey'],
  privateKey: KeyObject,
): KeyObject {
  if (!input) return createPublicKey(privateKey)
  if (input instanceof KeyObject) return input
  if (typeof input === 'string') return createPublicKey(input)
  return createPublicKey({ format: 'jwk', key: input })
}

/**
 * Issues very short-lived JWTs after Better Auth has already verified the
 * browser session. The same asymmetric public key is configured in Neon Data
 * API and local PostgREST; only Nitro receives the private key.
 */
export function createDataApiTokenSigner(
  options: DataApiTokenSignerOptions,
): DataApiTokenSigner {
  const audience = nonEmpty(options.audience, 'audience')
  const issuer = nonEmpty(options.issuer, 'issuer')
  const keyId = nonEmpty(options.keyId, 'keyId')
  const ttlSeconds = positiveInteger(options.ttlSeconds ?? 60, 'ttlSeconds')
  const privateKey = privateKeyObject(options.privateKey)
  const publicKey = publicKeyObject(options.publicKey, privateKey)

  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Data API private key must be an Ed25519 key')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Data API public key must be an Ed25519 key')
  }

  const exportedPublicKey = publicKey.export({ format: 'jwk' }) as JsonWebKey
  const jwk: DataApiPublicJwk = {
    ...exportedPublicKey,
    alg: 'EdDSA',
    kid: keyId,
    use: 'sig',
  }

  const sign = (claims: DataApiTokenClaims): string => {
    if (claims.role === 'authenticated' && !claims.sub) {
      throw new TypeError('Authenticated Data API tokens require sub')
    }
    if (claims.role !== 'authenticated' && claims.sub) {
      throw new TypeError(`${claims.role} Data API tokens cannot contain sub`)
    }

    const issuedAt = Math.floor(Date.now() / 1000)
    const header = encodeJson({ alg: 'EdDSA', kid: keyId, typ: 'JWT' })
    const payload = encodeJson({
      ...claims,
      aud: audience,
      exp: issuedAt + ttlSeconds,
      iat: issuedAt,
      iss: issuer,
    })
    const signingInput = `${header}.${payload}`
    const signature = signBytes(
      null,
      Buffer.from(signingInput, 'ascii'),
      privateKey,
    ).toString('base64url')

    return `${signingInput}.${signature}`
  }

  return {
    jwks: { keys: [jwk] },
    sign,
    signAnonymous: claims => sign({ ...claims, role: 'anonymous' }),
    signBackend: claims => sign({ ...claims, role: 'openexpert_service' }),
    signUser: (userId, claims) => sign({
      ...claims,
      role: 'authenticated',
      sub: nonEmpty(userId, 'userId'),
    }),
  }
}

export function parseDataApiPublicJwk(value: string): DataApiPublicJwk {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  }
  catch {
    throw new TypeError('DATA_API_JWT_PUBLIC_JWK must be valid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('DATA_API_JWT_PUBLIC_JWK must be a JWK object')
  }

  const jwk = parsed as JsonWebKey & {
    alg?: unknown
    kid?: unknown
    use?: unknown
  }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) {
    throw new TypeError('DATA_API_JWT_PUBLIC_JWK must be an Ed25519 public JWK')
  }
  if ('d' in jwk) {
    throw new TypeError('DATA_API_JWT_PUBLIC_JWK cannot contain private key material')
  }

  if (
    jwk.alg !== undefined && jwk.alg !== 'EdDSA'
    || typeof jwk.kid !== 'string'
    || !jwk.kid.trim()
    || jwk.use !== undefined && jwk.use !== 'sig'
  ) {
    throw new TypeError(
      'DATA_API_JWT_PUBLIC_JWK must contain a non-empty kid and use EdDSA signing',
    )
  }

  return {
    ...jwk,
    alg: 'EdDSA',
    kid: jwk.kid,
    use: 'sig',
  }
}

export function verifyDataApiToken(
  token: string,
  options: VerifyDataApiTokenOptions,
): VerifiedDataApiToken {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new TypeError('Invalid Data API JWT format')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]
  const header = decodeJson<Record<string, unknown>>(encodedHeader, 'header')
  const claims = decodeJson<Record<string, unknown>>(encodedPayload, 'payload')
  const jwk = parseDataApiPublicJwk(JSON.stringify(options.publicJwk))

  if (header.alg !== 'EdDSA' || header.typ !== 'JWT') {
    throw new TypeError('Invalid Data API JWT algorithm')
  }
  if (jwk.kid && header.kid !== jwk.kid) {
    throw new TypeError('Invalid Data API JWT key id')
  }

  const validSignature = verifyBytes(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
    createPublicKey({ format: 'jwk', key: jwk }),
    Buffer.from(encodedSignature, 'base64url'),
  )
  if (!validSignature) throw new TypeError('Invalid Data API JWT signature')

  const now = Math.floor((options.now ?? Date.now()) / 1000)
  const tolerance = Math.max(0, options.clockToleranceSeconds ?? 5)
  const issuedAt = Number(claims.iat)
  const expiresAt = Number(claims.exp)
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + tolerance) {
    throw new TypeError('Invalid Data API JWT issued-at time')
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now - tolerance) {
    throw new TypeError('Data API JWT has expired')
  }
  if (claims.aud !== options.audience || claims.iss !== options.issuer) {
    throw new TypeError('Invalid Data API JWT issuer or audience')
  }
  if (!['anonymous', 'authenticated', 'openexpert_service'].includes(String(claims.role))) {
    throw new TypeError('Invalid Data API JWT role')
  }
  if (options.expectedRole && claims.role !== options.expectedRole) {
    throw new TypeError('Unexpected Data API JWT role')
  }
  if (claims.role === 'authenticated' && typeof claims.sub !== 'string') {
    throw new TypeError('Authenticated Data API JWT is missing sub')
  }
  if (claims.role !== 'authenticated' && claims.sub !== undefined) {
    throw new TypeError('Non-user Data API JWT cannot contain sub')
  }

  return claims as unknown as VerifiedDataApiToken
}
