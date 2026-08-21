import {
  createAuthenticatedDataApiClient,
  type DataApiClient,
} from '@openexpert/data-api'
import {
  createDataApiTokenSigner,
  parseDataApiPublicJwk,
  type DataApiTokenSigner,
  type VerifyDataApiTokenOptions,
} from '@openexpert/data-api/token'
import type { BankMailSessionBindClaims } from './session-bind.ts'

function firstEnvironmentValue(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function requireEnvironmentValue(names: readonly string[], label: string): string {
  const value = firstEnvironmentValue(names)
  if (!value) throw new Error(`${label} is not configured for the bank mail agent.`)
  return value
}

function dataApiUrl(): string {
  return requireEnvironmentValue(
    ['DATA_API_URL', 'NUXT_DATA_API_URL', 'NUXT_PUBLIC_DATA_API_URL'],
    'The Data API URL',
  )
}

function jwtIdentity(): { audience: string, issuer: string } {
  return {
    audience: requireEnvironmentValue(
      ['DATA_API_JWT_AUDIENCE', 'NUXT_DATA_API_JWT_AUDIENCE'],
      'The Data API JWT audience',
    ),
    issuer: requireEnvironmentValue(
      ['DATA_API_JWT_ISSUER', 'NUXT_DATA_API_JWT_ISSUER'],
      'The Data API JWT issuer',
    ),
  }
}

export function getBankMailDataApiVerificationOptions(): Pick<
  VerifyDataApiTokenOptions,
  'audience' | 'issuer' | 'publicJwk'
> {
  const { audience, issuer } = jwtIdentity()
  const configuredPublicJwk = firstEnvironmentValue([
    'DATA_API_JWT_PUBLIC_JWK',
    'NUXT_DATA_API_JWT_PUBLIC_JWK',
  ])
  const publicJwk = configuredPublicJwk
    ? parseDataApiPublicJwk(configuredPublicJwk)
    : getTokenSigner().jwks.keys[0]
  if (!publicJwk) throw new Error('The Data API JWT public JWK could not be derived.')

  return {
    audience,
    issuer,
    publicJwk,
  }
}

function decodePrivateKey(value: string): string {
  const normalized = value.trim()
  if (normalized.includes('-----BEGIN')) return normalized.replace(/\\n/gu, '\n')

  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim()
  if (!decoded.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('The Data API JWT private key must be PKCS8 PEM or base64-encoded PKCS8 PEM.')
  }
  return decoded
}

let tokenSigner: DataApiTokenSigner | undefined

function getTokenSigner(): DataApiTokenSigner {
  if (tokenSigner) return tokenSigner

  const { audience, issuer } = jwtIdentity()
  tokenSigner = createDataApiTokenSigner({
    audience,
    issuer,
    keyId: requireEnvironmentValue(
      ['DATA_API_JWT_KEY_ID', 'NUXT_DATA_API_JWT_KEY_ID'],
      'The Data API JWT key id',
    ),
    privateKey: decodePrivateKey(requireEnvironmentValue(
      ['DATA_API_JWT_PRIVATE_KEY', 'NUXT_DATA_API_JWT_PRIVATE_KEY'],
      'The Data API JWT private key',
    )),
    ttlSeconds: 60,
  })
  return tokenSigner
}

/** A service client is restricted again by narrow, service-only database RPCs. */
export function createBankMailServiceDataApiClient(): DataApiClient {
  const signer = getTokenSigner()
  return createAuthenticatedDataApiClient(dataApiUrl(), () => signer.signBackend())
}

/**
 * One-operation service client used by the session-started durability hook.
 * The signed scope is intentionally kept separate from both the EVE caller
 * token and the generic service client.
 */
export function createBankMailSessionBindDataApiClient(
  claims: BankMailSessionBindClaims,
): DataApiClient {
  const signer = getTokenSigner()
  return createAuthenticatedDataApiClient(
    dataApiUrl(),
    () => signer.signBackend({ ...claims }),
  )
}

/**
 * Read-only CRM capabilities run as the mailbox owner, preserving the same RLS
 * boundary as an interactive expert. The caller still post-filters to owned
 * cases in the shared capability package.
 */
export function createBankMailActingUserDataApiClient(userId: string): DataApiClient {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error('A mailbox owner user id is required.')

  const signer = getTokenSigner()
  return createAuthenticatedDataApiClient(
    dataApiUrl(),
    () => signer.signUser(normalizedUserId),
  )
}
