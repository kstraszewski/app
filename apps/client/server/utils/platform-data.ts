import {
  createAuthenticatedDataApiClient,
  createDataApiTokenSigner,
  type DataApiClient,
  type DataApiTokenSigner,
} from '@openexpert/data-api'
import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'

interface PlatformDataConfig {
  url: string
  jwt: {
    audience: string
    issuer: string
    keyId: string
    privateKey: string
  }
}

let cachedSigner:
  | { fingerprint: string, signer: DataApiTokenSigner }
  | undefined

function dataConfig(event: H3Event): PlatformDataConfig {
  return useRuntimeConfig(event).dataApi as PlatformDataConfig
}

function privateKey(value: string): string {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error('Data API JWT private key is not configured')
  if (normalized.includes('-----BEGIN')) return normalized.replace(/\\n/gu, '\n')

  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim()
  if (!decoded.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
      'Data API JWT private key must be PKCS8 PEM or base64-encoded PKCS8 PEM',
    )
  }
  return decoded
}

export function serverDataTokenSigner(event: H3Event): DataApiTokenSigner {
  const config = dataConfig(event)
  const fingerprint = JSON.stringify(config.jwt)
  if (cachedSigner?.fingerprint === fingerprint) return cachedSigner.signer

  const signer = createDataApiTokenSigner({
    audience: config.jwt.audience,
    issuer: config.jwt.issuer,
    keyId: config.jwt.keyId,
    privateKey: privateKey(config.jwt.privateKey),
  })
  cachedSigner = { fingerprint, signer }
  return signer
}

export function serverBackendDataClient(event: H3Event): DataApiClient<any> {
  const config = dataConfig(event)
  const token = serverDataTokenSigner(event).signBackend()
  return createAuthenticatedDataApiClient<any>(config.url, () => token)
}
