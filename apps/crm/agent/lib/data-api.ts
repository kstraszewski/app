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

interface AgentDataApiEnvironment {
  url: string
}

function firstEnvironmentValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function getAgentDataApiEnvironment(): AgentDataApiEnvironment {
  const url = firstEnvironmentValue([
    'DATA_API_URL',
    'NUXT_DATA_API_URL',
    'NUXT_PUBLIC_DATA_API_URL',
  ])

  if (!url) {
    throw new Error('The Data API URL is not configured for the CRM assistant.')
  }

  return { url }
}

function agentDataApiJwtIdentity(): { audience: string, issuer: string } {
  const audience = firstEnvironmentValue([
    'DATA_API_JWT_AUDIENCE',
    'NUXT_DATA_API_JWT_AUDIENCE',
  ])
  const issuer = firstEnvironmentValue([
    'DATA_API_JWT_ISSUER',
    'NUXT_DATA_API_JWT_ISSUER',
  ])

  if (!audience) {
    throw new Error('The Data API JWT audience is not configured for the CRM assistant.')
  }
  if (!issuer) {
    throw new Error('The Data API JWT issuer is not configured for the CRM assistant.')
  }

  return { audience, issuer }
}

export function getAgentDataApiVerificationOptions(): Pick<
  VerifyDataApiTokenOptions,
  'audience' | 'issuer' | 'publicJwk'
> {
  const { audience, issuer } = agentDataApiJwtIdentity()
  const publicJwk = firstEnvironmentValue([
    'DATA_API_JWT_PUBLIC_JWK',
    'NUXT_DATA_API_JWT_PUBLIC_JWK',
  ])

  if (!publicJwk) {
    throw new Error('The Data API JWT public JWK is not configured for the CRM assistant.')
  }

  return {
    audience,
    issuer,
    publicJwk: parseDataApiPublicJwk(publicJwk),
  }
}

let backendTokenSigner: DataApiTokenSigner | undefined

function decodeAgentDataApiPrivateKey(value: string): string {
  const normalized = value.trim()
  if (normalized.includes('-----BEGIN')) {
    return normalized.replace(/\\n/gu, '\n')
  }

  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim()
  if (!decoded.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
      'The Data API JWT private key must be PKCS8 PEM or base64-encoded PKCS8 PEM.',
    )
  }
  return decoded
}

function getAgentDataApiServiceTokenSigner(): DataApiTokenSigner {
  if (backendTokenSigner) return backendTokenSigner

  const { audience, issuer } = agentDataApiJwtIdentity()
  const keyId = firstEnvironmentValue([
    'DATA_API_JWT_KEY_ID',
    'NUXT_DATA_API_JWT_KEY_ID',
  ])
  const privateKey = firstEnvironmentValue([
    'DATA_API_JWT_PRIVATE_KEY',
    'NUXT_DATA_API_JWT_PRIVATE_KEY',
  ])

  if (!keyId) {
    throw new Error('The Data API JWT key ID is not configured for the CRM assistant.')
  }
  if (!privateKey) {
    throw new Error('The Data API JWT private key is not configured for the CRM assistant.')
  }

  backendTokenSigner = createDataApiTokenSigner({
    audience,
    issuer,
    keyId,
    privateKey: decodeAgentDataApiPrivateKey(privateKey),
    ttlSeconds: 60,
  })
  return backendTokenSigner
}

export function createAgentUserDataApiClient(
  accessToken: string,
): DataApiClient {
  const token = accessToken.trim()
  if (!token) throw new Error('A Data API user token is required.')

  const environment = getAgentDataApiEnvironment()
  return createAuthenticatedDataApiClient(environment.url, () => token)
}

export function createAgentServiceClient(): DataApiClient {
  const environment = getAgentDataApiEnvironment()
  const signer = getAgentDataApiServiceTokenSigner()
  return createAuthenticatedDataApiClient(
    environment.url,
    () => signer.signBackend(),
  )
}

export function createAgentActingUserDataApiClient(userId: string): DataApiClient {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error('A CRM user id is required.')

  const environment = getAgentDataApiEnvironment()
  const signer = getAgentDataApiServiceTokenSigner()
  return createAuthenticatedDataApiClient(
    environment.url,
    () => signer.signUser(normalizedUserId),
  )
}

export function signAgentActingUserDataApiToken(
  userId: string,
  claims: Readonly<Record<string, unknown>> = {},
): string {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error('A CRM user id is required.')
  return getAgentDataApiServiceTokenSigner().signUser(normalizedUserId, { ...claims })
}
