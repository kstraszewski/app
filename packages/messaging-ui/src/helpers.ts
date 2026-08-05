import type { MessageAttachment } from '@openexpert/messaging'
import type { MessageAttachmentCompletionFailureMode } from './types.ts'

export type MessageAttachmentVisualKind =
  | 'image'
  | 'pdf'
  | 'word'
  | 'spreadsheet'
  | 'file'

const WORD_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export function isImageMessageAttachment(
  attachment: Pick<MessageAttachment, 'mimeType'>,
): boolean {
  return attachment.mimeType.toLowerCase().startsWith('image/')
}

export function messageAttachmentVisualKind(
  attachment: Pick<MessageAttachment, 'mimeType'>,
): MessageAttachmentVisualKind {
  const mimeType = attachment.mimeType.toLowerCase()
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (WORD_MIME_TYPES.has(mimeType)) return 'word'
  if (SPREADSHEET_MIME_TYPES.has(mimeType)) return 'spreadsheet'
  return 'file'
}

export function messageAttachmentKindLabel(
  attachment: Pick<MessageAttachment, 'mimeType'>,
): string {
  const kind = messageAttachmentVisualKind(attachment)
  if (kind === 'image') return 'Obraz'
  if (kind === 'pdf') return 'PDF'
  if (kind === 'word') return 'Dokument'
  if (kind === 'spreadsheet') return 'Arkusz'
  return 'Plik'
}

export function formatMessageAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`

  const units = ['KB', 'MB', 'GB'] as const
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 10 ? 0 : 1
  return `${value.toLocaleString('pl-PL', {
    maximumFractionDigits: digits,
  })} ${units[unitIndex]}`
}

export function messageAttachmentFileFingerprint(
  file: Pick<File, 'lastModified' | 'name' | 'size'>,
): string {
  return `${file.name.normalize('NFC')}\u0000${file.size}\u0000${file.lastModified}`
}

function errorRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object'
    ? value as Record<string, any>
    : {}
}

/**
 * A terminal completion error means the original reservation cannot become
 * usable. The caller should reserve a fresh path and upload the retained File
 * again. Network, rate-limit and server errors can safely retry completion.
 */
export function classifyMessageAttachmentCompletionFailure(
  error: unknown,
): MessageAttachmentCompletionFailureMode {
  const candidate = errorRecord(error)
  const data = errorRecord(candidate.data)
  const nestedData = errorRecord(data.data)
  const response = errorRecord(candidate.response)
  const status = Number(
    candidate.statusCode
    ?? candidate.status
    ?? response.status
    ?? data.statusCode
    ?? 0,
  )
  const code = String(nestedData.code ?? data.code ?? candidate.code ?? '')

  if (code === 'message_attachment_upload_pending') return 'retry-complete'
  if ([404, 410, 415].includes(status)) return 'restart-upload'
  if (status === 409) return 'restart-upload'
  return 'retry-complete'
}
