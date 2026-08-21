export const MAX_GMAIL_BANK_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_GMAIL_ATTACHMENT_RESPONSE_BYTES = 7 * 1024 * 1024
export const MAX_GMAIL_PROVIDER_RESPONSE_BYTES = 20 * 1024 * 1024

const MAX_GMAIL_ATTACHMENT_BASE64URL_CHARACTERS = Math.ceil(
  MAX_GMAIL_BANK_ATTACHMENT_BYTES / 3,
) * 4 + 4

export interface GmailAttachmentDownload {
  bytes: Uint8Array
  size: number
}

export class GmailAttachmentResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmailAttachmentResponseError'
  }
}

function invalid(message: string): never {
  throw new GmailAttachmentResponseError(message)
}

export async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    invalid('Gmail response byte limit is invalid')
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      invalid('Gmail response exceeds its byte limit')
    }
  }
  if (!response.body) invalid('Gmail response body is missing')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      if (!(chunk instanceof Uint8Array) || totalBytes + chunk.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined)
        invalid('Gmail response exceeds its byte limit')
      }
      totalBytes += chunk.byteLength
      chunks.push(chunk.slice())
    }
  }
  finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  }
  catch {
    invalid('Gmail response is not valid JSON')
  }
}

export function decodeGmailAttachmentResponse(
  value: unknown,
  expectedSize?: number,
): GmailAttachmentDownload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Gmail attachment response is not an object')
  }
  const response = value as { data?: unknown, size?: unknown }
  const size = Number(response.size)
  const data = typeof response.data === 'string' ? response.data : ''
  const unpaddedLength = data.replace(/=+$/u, '').length
  if (
    !Number.isSafeInteger(size)
    || size < 1
    || size > MAX_GMAIL_BANK_ATTACHMENT_BYTES
    || (expectedSize !== undefined && size !== expectedSize)
    || data.length < 2
    || data.length > MAX_GMAIL_ATTACHMENT_BASE64URL_CHARACTERS
    || !/^[A-Za-z0-9_-]+={0,2}$/u.test(data)
    || unpaddedLength % 4 === 1
  ) {
    invalid('Gmail attachment metadata is inconsistent')
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(
      Buffer.from(data.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64'),
    )
  }
  catch {
    invalid('Gmail attachment base64url encoding is invalid')
  }
  if (bytes.byteLength !== size) {
    invalid('Gmail attachment decoded size is inconsistent')
  }
  const canonical = Buffer.from(bytes).toString('base64url')
  if (canonical !== data.replace(/=+$/u, '')) {
    invalid('Gmail attachment base64url encoding is not canonical')
  }
  return { bytes, size }
}
