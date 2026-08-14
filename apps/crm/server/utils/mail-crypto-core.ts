import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

export const MAIL_ENCRYPTION_SECRET_MIN_BYTES = 32

export function mailEncryptionSecretIsStrong(value: unknown): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= MAIL_ENCRYPTION_SECRET_MIN_BYTES
}

export function deriveMailEncryptionKey(secret: string): Buffer {
  if (!mailEncryptionSecretIsStrong(secret)) {
    throw new TypeError(
      `Mail encryption secret must contain at least ${MAIL_ENCRYPTION_SECRET_MIN_BYTES} UTF-8 bytes`,
    )
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function encryptMailSecretValue(
  secret: string,
  value: string,
  context: string,
): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveMailEncryptionKey(secret), iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    'v2',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

export function decryptMailSecretValue(
  secret: string,
  value: string,
  context: string,
  options: { allowHistoricallyWeakSecret?: boolean } = {},
): string {
  const [version, ivValue, tagValue, encryptedValue, extra] = value.split('.')
  if (
    (version !== 'v1' && version !== 'v2')
    || !ivValue
    || !tagValue
    || !encryptedValue
    || extra
  ) {
    throw new TypeError('Stored mail secret has an invalid format')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    options.allowHistoricallyWeakSecret
      ? historicalMailEncryptionKey(secret)
      : deriveMailEncryptionKey(secret),
    Buffer.from(ivValue, 'base64url'),
  )
  if (version === 'v2') decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function decryptMailSecretValueWithLegacyFallback(
  currentSecret: string,
  legacySecret: string | undefined,
  value: string,
  context: string,
): string {
  try {
    return decryptMailSecretValue(currentSecret, value, context)
  }
  catch (currentError) {
    if (legacySecret && legacySecret !== currentSecret) {
      try {
        return decryptMailSecretValue(legacySecret, value, context, {
          allowHistoricallyWeakSecret: true,
        })
      }
      catch {
        // Preserve the current-key failure so callers expose one generic error.
      }
    }
    throw currentError
  }
}

function historicalMailEncryptionKey(secret: string): Buffer {
  if (!secret) throw new TypeError('Historical mail encryption secret is empty')
  return createHash('sha256').update(secret, 'utf8').digest()
}
