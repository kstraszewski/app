import { z } from 'zod'
import type { MessageAttachment } from './types.ts'

export const MESSAGE_ATTACHMENT_MAX_FILES = 10
export const MESSAGE_ATTACHMENT_MAX_FILE_BYTES = 25 * 1024 * 1024
export const MESSAGE_ATTACHMENT_MAX_TOTAL_BYTES = 50 * 1024 * 1024
export const MESSAGE_ATTACHMENT_NAME_MAX_LENGTH = 255
export const MESSAGE_ATTACHMENT_NAMESPACE = 'crm-message-attachments'

export const MESSAGE_ATTACHMENT_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
] as const)

export type MessageAttachmentContentType =
  typeof MESSAGE_ATTACHMENT_CONTENT_TYPES[number]

export const MESSAGE_ATTACHMENT_ACCEPT = MESSAGE_ATTACHMENT_CONTENT_TYPES.join(',')

const contentTypeSet = new Set<string>(MESSAGE_ATTACHMENT_CONTENT_TYPES)
const uuidSchema = z.string().uuid()

const extensionByContentType = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
} as const satisfies Record<MessageAttachmentContentType, string>)

const contentTypeByExtension = new Map<string, MessageAttachmentContentType>([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['txt', 'text/plain'],
  ['csv', 'text/csv'],
])

function normalizedDeclaredContentType(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase()
}

function fileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase()
  const dot = normalized.lastIndexOf('.')
  return dot > -1 && dot < normalized.length - 1
    ? normalized.slice(dot + 1)
    : ''
}

export function isMessageAttachmentContentType(
  value: string,
): value is MessageAttachmentContentType {
  return contentTypeSet.has(value)
}

/**
 * Resolves the canonical MIME type used by upload constraints and persistence.
 * Browsers occasionally omit a type (or use application/octet-stream), so a
 * conservative extension fallback is allowed only for the explicit allowlist.
 */
export function resolveMessageAttachmentContentType(
  fileName: string,
  declaredType: string,
): string | null {
  const declared = normalizedDeclaredContentType(declaredType)
  const extension = fileExtension(fileName)
  const extensionType = contentTypeByExtension.get(extension)
  if (isMessageAttachmentContentType(declared)) {
    // The display name becomes Content-Disposition on download. Reject an
    // executable or otherwise misleading suffix even when a caller declares
    // an allowed MIME type. Extensionless clipboard files remain supported.
    if (extension && extensionType !== declared) return null
    return declared
  }
  if (declared && declared !== 'application/octet-stream') return null
  return extensionType ?? null
}

/** Normalizes a browser-provided display name; it is never used as a blob path. */
export function normalizeMessageAttachmentName(value: string): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/[\\/]+/gu, '-')
    .trim()
  if (!normalized || normalized === '.' || normalized === '..') return null
  return [...normalized].slice(0, MESSAGE_ATTACHMENT_NAME_MAX_LENGTH).join('')
}

export type MessageAttachmentCandidateValidation =
  | { ok: true, mimeType: string }
  | { ok: false, reason: string }

export function validateMessageAttachmentCandidate(input: {
  name: string
  type: string
  size: number
}): MessageAttachmentCandidateValidation {
  if (!normalizeMessageAttachmentName(input.name)) {
    return { ok: false, reason: 'File name is invalid' }
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    return { ok: false, reason: 'File must not be empty' }
  }
  if (input.size > MESSAGE_ATTACHMENT_MAX_FILE_BYTES) {
    return { ok: false, reason: 'File exceeds the 25 MiB limit' }
  }
  const mimeType = resolveMessageAttachmentContentType(input.name, input.type)
  if (!mimeType) {
    const declared = normalizedDeclaredContentType(input.type)
    const extension = fileExtension(input.name)
    if (
      isMessageAttachmentContentType(declared)
      && extension
      && contentTypeByExtension.get(extension) !== declared
    ) {
      return { ok: false, reason: 'File extension does not match its type' }
    }
    return { ok: false, reason: 'File type is not supported' }
  }
  return { ok: true, mimeType }
}

export function messageAttachmentExtension(
  mimeType: string,
): string | null {
  const normalized = normalizedDeclaredContentType(mimeType)
  return isMessageAttachmentContentType(normalized)
    ? extensionByContentType[normalized]
    : null
}

export function buildMessageAttachmentStoragePath(input: {
  organizationId: string
  caseId: string
  conversationId: string
  clientMessageId: string
  attachmentId: string
  mimeType: string
}): string {
  const organizationId = uuidSchema.parse(input.organizationId).toLowerCase()
  const caseId = uuidSchema.parse(input.caseId).toLowerCase()
  const conversationId = uuidSchema.parse(input.conversationId).toLowerCase()
  const clientMessageId = uuidSchema.parse(input.clientMessageId).toLowerCase()
  const attachmentId = uuidSchema.parse(input.attachmentId).toLowerCase()
  const extension = messageAttachmentExtension(input.mimeType)
  if (!extension) throw new TypeError('Unsupported message attachment content type')
  return [
    organizationId,
    caseId,
    conversationId,
    clientMessageId,
    `${attachmentId}.${extension}`,
  ].join('/')
}

export function messageAttachmentBlobPath(storagePath: string): string {
  if (
    !storagePath
    || storagePath.startsWith('/')
    || storagePath.includes('\\')
    || storagePath.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new TypeError('Invalid message attachment storage path')
  }
  return `${MESSAGE_ATTACHMENT_NAMESPACE}/${storagePath}`
}

function compactPreview(value: string, maximumLength: number): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  return compact.length <= maximumLength
    ? compact
    : `${compact.slice(0, Math.max(0, maximumLength - 1))}…`
}

export function buildMessagePreview(
  body: string,
  attachments: readonly MessageAttachment[],
  maximumLength = 160,
): string {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 2) {
    throw new TypeError('maximumLength must be an integer greater than one')
  }
  const compactBody = compactPreview(body, maximumLength)
  if (compactBody) return compactBody
  if (attachments.length === 1) {
    const attachment = attachments[0]!
    const label = attachment.mimeType.startsWith('image/') ? 'Zdjęcie' : 'Załącznik'
    return compactPreview(`${label}: ${attachment.name}`, maximumLength)
  }
  return attachments.length > 1 ? `${attachments.length} załączników` : ''
}
