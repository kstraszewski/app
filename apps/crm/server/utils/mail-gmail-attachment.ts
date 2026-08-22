import { createError } from 'h3'
import type {
  GmailMessagePart,
  GmailMessageResource,
} from './gmail-message.ts'

export const GMAIL_ATTACHMENT_DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024

const MAX_GMAIL_ATTACHMENT_INDEX = 999
const GMAIL_ATTACHMENT_JSON_OVERHEAD_BYTES = 64 * 1024
const GMAIL_MESSAGE_JSON_OVERHEAD_BYTES = 4 * 1024 * 1024

interface GmailAttachmentDownloadInput {
  messageId: string
  attachmentId?: string | null
  attachmentIndex: number
  maxBytes: number
}

interface GmailAttachmentBodyResource {
  attachmentId?: string
  data?: string
  size?: number
}

/**
 * Downloads one received Gmail attachment without ever returning a partial
 * value. Large parts use Gmail's attachment endpoint; small inline MIME parts
 * without an attachmentId fall back to body.data from the full message.
 */
export async function fetchGmailAttachmentBytesCore(
  accessToken: string,
  input: GmailAttachmentDownloadInput,
): Promise<Uint8Array> {
  const maxBytes = gmailAttachmentMaxBytes(input.maxBytes)
  const messageId = gmailProviderIdentifier(input.messageId, 'message')
  const attachmentIndex = gmailAttachmentIndex(input.attachmentIndex)
  const attachmentId = input.attachmentId === null || input.attachmentId === undefined
    ? null
    : gmailProviderIdentifier(input.attachmentId, 'attachment')

  if (attachmentId) {
    return fetchGmailAttachmentEndpoint(accessToken, messageId, attachmentId, maxBytes)
  }

  const response = await gmailAttachmentResponse(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full&fields=payload`,
    accessToken,
    'Gmail attachment message',
  )
  const message = await boundedGmailJson<GmailMessageResource>(
    response,
    encodedAttachmentBudget(maxBytes) + GMAIL_MESSAGE_JSON_OVERHEAD_BYTES,
    'Gmail message is too large to inspect safely',
    502,
  )
  const part = gmailAttachmentParts(message.payload)[attachmentIndex]
  if (!part) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Gmail attachment was not found',
    })
  }

  const discoveredAttachmentId = String(part.body?.attachmentId ?? '').trim()
  if (discoveredAttachmentId) {
    return fetchGmailAttachmentEndpoint(
      accessToken,
      messageId,
      gmailProviderIdentifier(discoveredAttachmentId, 'attachment'),
      maxBytes,
    )
  }
  if (typeof part.body?.data !== 'string') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Gmail attachment content is unavailable',
    })
  }
  return decodeGmailAttachmentBody(part.body, maxBytes)
}

async function fetchGmailAttachmentEndpoint(
  accessToken: string,
  messageId: string,
  attachmentId: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const response = await gmailAttachmentResponse(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    accessToken,
    'Gmail attachment download',
  )
  const body = await boundedGmailJson<GmailAttachmentBodyResource>(
    response,
    encodedAttachmentBudget(maxBytes) + GMAIL_ATTACHMENT_JSON_OVERHEAD_BYTES,
    'Gmail attachment exceeds the download limit',
    413,
  )
  return decodeGmailAttachmentBody(body, maxBytes)
}

async function gmailAttachmentResponse(
  url: string,
  accessToken: string,
  operation: string,
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    })
  }
  catch {
    throw createError({
      statusCode: 502,
      statusMessage: `${operation} could not reach Gmail`,
    })
  }
  if (response.ok) return response

  await response.body?.cancel().catch(() => {})
  const statusCode = response.status === 401 || response.status === 403 || response.status === 404
    ? response.status
    : response.status === 429 ? 503 : 502
  throw createError({
    statusCode,
    statusMessage: `${operation} failed with HTTP ${response.status}`,
  })
}

async function boundedGmailJson<T>(
  response: Response,
  maxResponseBytes: number,
  overflowMessage: string,
  overflowStatusCode: number,
): Promise<T> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel().catch(() => {})
    throw createError({ statusCode: overflowStatusCode, statusMessage: overflowMessage })
  }

  const bytes = await readBoundedResponse(response, maxResponseBytes, () => createError({
    statusCode: overflowStatusCode,
    statusMessage: overflowMessage,
  }))
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as T
  }
  catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Gmail attachment returned an invalid response',
    })
  }
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  overflowError: () => Error,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw overflowError()
      }
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function decodeGmailAttachmentBody(
  body: GmailAttachmentBodyResource,
  maxBytes: number,
): Uint8Array {
  const declaredSize = Number(body.size)
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Gmail attachment exceeds the download limit',
    })
  }
  if (typeof body.data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/u.test(body.data)) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Gmail attachment returned invalid content',
    })
  }
  if (decodedBase64Size(body.data) > maxBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Gmail attachment exceeds the download limit',
    })
  }

  const bytes = Buffer.from(body.data, 'base64url')
  if (bytes.byteLength > maxBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Gmail attachment exceeds the download limit',
    })
  }
  return new Uint8Array(bytes)
}

function gmailAttachmentParts(payload: GmailMessagePart | undefined): GmailMessagePart[] {
  const attachments: GmailMessagePart[] = []
  const visit = (part: GmailMessagePart | undefined, depth: number) => {
    if (!part || depth > 32 || attachments.length > MAX_GMAIL_ATTACHMENT_INDEX) return
    if (String(part.filename ?? '').trim()) attachments.push(part)
    for (const child of part.parts ?? []) visit(child, depth + 1)
  }
  visit(payload, 0)
  return attachments
}

function decodedBase64Size(value: string): number {
  const unpaddedLength = value.replace(/=+$/u, '').length
  const paddingLength = value.length - unpaddedLength
  const remainder = unpaddedLength % 4
  const expectedPadding = remainder === 0 ? 0 : 4 - remainder
  if (
    remainder === 1
    || (paddingLength > 0 && (value.length % 4 !== 0 || paddingLength !== expectedPadding))
  ) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Gmail attachment returned invalid content',
    })
  }
  return Math.floor(unpaddedLength * 3 / 4)
}

function encodedAttachmentBudget(maxBytes: number): number {
  return Math.ceil((maxBytes + 1) / 3) * 4 + 2
}

function gmailProviderIdentifier(value: unknown, kind: 'message' | 'attachment'): string {
  const identifier = String(value ?? '').trim()
  const maxLength = kind === 'message' ? 4_096 : 16_384
  if (!identifier || identifier.length > maxLength || /[\u0000-\u001F\u007F]/u.test(identifier)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Gmail ${kind} identifier is invalid`,
    })
  }
  return identifier
}

function gmailAttachmentIndex(value: unknown): number {
  const index = Number(value)
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_GMAIL_ATTACHMENT_INDEX) {
    throw createError({ statusCode: 400, statusMessage: 'Gmail attachment index is invalid' })
  }
  return index
}

function gmailAttachmentMaxBytes(value: unknown): number {
  const maxBytes = Number(value)
  if (
    !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || maxBytes > GMAIL_ATTACHMENT_DOWNLOAD_MAX_BYTES
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Gmail attachment byte limit is invalid' })
  }
  return maxBytes
}
