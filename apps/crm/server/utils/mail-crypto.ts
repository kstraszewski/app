import { createHmac } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import { createError, type H3Event } from 'h3'
import {
  decryptMailSecretValueWithLegacyFallback,
  deriveMailEncryptionKey,
  encryptMailSecretValue,
  MAIL_ENCRYPTION_SECRET_MIN_BYTES,
  mailEncryptionSecretIsStrong,
} from './mail-crypto-core.ts'

interface MailCryptoRuntimeConfig {
  encryptionKey?: string
  legacyEncryptionKey?: string
}

const DEFAULT_AAD = 'openexpert-mail-secret'

function encryptionSecret(event: H3Event): string {
  const config = useRuntimeConfig(event).mailOAuth as MailCryptoRuntimeConfig
  if (!mailEncryptionSecretIsStrong(config.encryptionKey)) {
    throw createError({
      statusCode: 503,
      statusMessage: `Mail credential encryption requires a secret of at least ${MAIL_ENCRYPTION_SECRET_MIN_BYTES} bytes`,
    })
  }
  return config.encryptionKey
}

export function mailCredentialEncryptionAvailable(event: H3Event): boolean {
  const config = useRuntimeConfig(event).mailOAuth as MailCryptoRuntimeConfig
  return mailEncryptionSecretIsStrong(config.encryptionKey)
}

export function mailConnectionSecretContext(input: {
  organizationId: string
  ownerUserId: string
  connectionId: string
  purpose: 'credentials' | 'access-token' | 'refresh-token'
}): string {
  return [
    'openexpert-mail',
    input.organizationId,
    input.ownerUserId,
    input.connectionId,
    input.purpose,
  ].join(':')
}

export function deriveMailReferenceSecret(
  event: H3Event,
  input: {
    organizationId: string
    ownerUserId: string
    connectionId: string
  },
): string {
  return createHmac('sha256', deriveMailEncryptionKey(encryptionSecret(event)))
    .update([
      'openexpert-mail-reference-v1',
      input.organizationId,
      input.ownerUserId,
      input.connectionId,
    ].join(':'), 'utf8')
    .digest('base64url')
}

export function encryptMailSecret(
  event: H3Event,
  value: string | null,
  context = DEFAULT_AAD,
): string | null {
  if (!value) return null
  const secret = encryptionSecret(event)
  return encryptMailSecretValue(secret, value, context)
}

export function decryptMailSecret(
  event: H3Event,
  value: string | null | undefined,
  context = DEFAULT_AAD,
): string | null {
  if (!value) return null
  const secret = encryptionSecret(event)
  try {
    const config = useRuntimeConfig(event).mailOAuth as MailCryptoRuntimeConfig
    return decryptMailSecretValueWithLegacyFallback(
      secret,
      config.legacyEncryptionKey,
      value,
      context,
    )
  }
  catch (currentError) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Stored mail secret cannot be decrypted',
      cause: currentError,
    })
  }
}
