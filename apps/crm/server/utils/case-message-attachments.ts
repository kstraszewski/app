import {
  buildMessageAttachmentStoragePath,
  mapMessageAttachmentRow,
  messageAttachmentBlobPath,
  messageAttachmentExtension,
  MESSAGE_ATTACHMENT_NAME_MAX_LENGTH,
  MESSAGE_ATTACHMENT_NAMESPACE,
  normalizeMessageAttachmentName,
  resolveMessageAttachmentContentType,
  type MessageAttachment,
  type ReserveMessageAttachmentInput,
} from '@openexpert/messaging'
import type {
  CrmClientConversationAttachment,
  CrmConversationAttachmentsResponse,
} from '#shared/types/case-conversation-attachments'
import {
  createError,
  sendRedirect,
  sendStream,
  setHeader,
  type H3Event,
} from 'h3'
import {
  decodeClientAttachmentCursor,
  encodeClientAttachmentCursor,
  type ClientAttachmentCursor,
} from './case-conversation-attachment-cursor'
import { caseUuidPattern } from './case-identifiers'
import type { CaseConversationAccess } from './case-conversations'
import { asRecord, throwDbError } from './crm'
import { serverDataBackend } from './data-api'
import { serverStorageClient } from './platform-storage'

const reservationSelect = [
  'id',
  'organization_id',
  'conversation_id',
  'client_message_id',
  'message_id',
  'uploader_kind',
  'uploader_user_id',
  'storage_path',
  'file_name',
  'content_type',
  'size_bytes',
  'etag',
  'uploaded_at',
  'expires_at',
  'discarded_at',
].join(',')

const clientAttachmentListSelect = [
  'id',
  'message_id',
  'position',
  'file_name',
  'content_type',
  'size_bytes',
  'attached_at',
  'uploader_client_person_id',
].join(',')

const CLIENT_ATTACHMENT_PAGE_DEFAULT = 50
const CLIENT_ATTACHMENT_PAGE_MAX = 100

export interface ClientAttachmentPageRequest {
  cursor: ClientAttachmentCursor | null
  limit: number
}

interface StaffAttachmentReservation {
  attachment: MessageAttachment
  storagePath: string
  expiresAt: string
}

function clientAttachmentCursor(value: unknown): ClientAttachmentCursor | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'cursor is invalid' })
  }

  try {
    return decodeClientAttachmentCursor(value)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'cursor is invalid' })
  }
}

function clientAttachmentLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return CLIENT_ATTACHMENT_PAGE_DEFAULT
  }
  const input = Array.isArray(value) ? value[0] : value
  if (typeof input !== 'string' || !/^\d+$/u.test(input)) {
    throw createError({ statusCode: 400, statusMessage: 'limit must be an integer' })
  }
  const parsed = Number(input)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > CLIENT_ATTACHMENT_PAGE_MAX) {
    throw createError({
      statusCode: 400,
      statusMessage: `limit must be between 1 and ${CLIENT_ATTACHMENT_PAGE_MAX}`,
    })
  }
  return parsed
}

export function parseClientAttachmentPageQuery(
  query: Record<string, unknown>,
): ClientAttachmentPageRequest {
  return {
    cursor: clientAttachmentCursor(query.cursor),
    limit: clientAttachmentLimit(query.limit),
  }
}

interface MappedClientConversationAttachment {
  attachment: CrmClientConversationAttachment
  cursorSentAt: string
}

function mapClientConversationAttachmentRow(
  value: unknown,
  access: CaseConversationAccess,
): MappedClientConversationAttachment {
  const row = asRecord(value)
  const attachment = mapMessageAttachmentRow(row)
  const messageId = String(row.message_id ?? '')
  const position = Number(row.position)
  const sentAt = String(row.attached_at ?? '')
  const uploaderClientPersonId = String(row.uploader_client_person_id ?? '')
  const uploader = access.participants.find(participant => (
    participant.clientPersonId === uploaderClientPersonId
  ))
  if (
    !caseUuidPattern.test(messageId)
    || !Number.isSafeInteger(position)
    || position < 1
    || position > 10
    || !Number.isFinite(Date.parse(sentAt))
  ) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Conversation attachment returned an invalid result',
    })
  }
  return {
    attachment: {
      ...attachment,
      messageId: messageId.toLowerCase(),
      position,
      sentAt: new Date(sentAt).toISOString(),
      uploaderClientPersonId,
      uploaderName: uploader?.displayName || 'Były uczestnik',
    },
    cursorSentAt: sentAt,
  }
}

export async function listClientConversationAttachments(
  access: CaseConversationAccess,
  page: ClientAttachmentPageRequest,
): Promise<CrmConversationAttachmentsResponse['data']> {
  let request = access.session.dataApi
    .from('crm_case_message_attachments')
    .select(clientAttachmentListSelect)
    .eq('organization_id', access.session.organizationId)
    .eq('conversation_id', access.conversation.id)
    .eq('uploader_kind', 'client')
    .not('message_id', 'is', null)
    .not('attached_at', 'is', null)
    .is('discarded_at', null)
    .order('attached_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(page.limit + 1)

  if (page.cursor) {
    request = request.or(
      `attached_at.lt.${page.cursor.sentAt},and(attached_at.eq.${page.cursor.sentAt},id.lt.${page.cursor.id})`,
    )
  }

  const result = await request
  throwDbError(result.error)
  const mappedRows: MappedClientConversationAttachment[] = (result.data ?? [])
    .map((row: unknown) => mapClientConversationAttachmentRow(row, access))
  const hasMore = mappedRows.length > page.limit
  const visibleRows = mappedRows.slice(0, page.limit)
  const last = visibleRows.at(-1)

  return {
    attachments: visibleRows.map(row => row.attachment),
    pageInfo: {
      hasMore,
      nextCursor: hasMore && last
        ? encodeClientAttachmentCursor({
            sentAt: last.cursorSentAt,
            id: last.attachment.id,
          })
        : null,
    },
  }
}

function throwAttachmentDbError(
  error: { code?: string, message?: string } | null | undefined,
): void {
  if (!error) return
  const message = String(error.message ?? '')
  if (
    message.includes('case_message_attachment_reservation_rate_limited')
    || message.includes('too_many_active_case_message_attachment_reservations')
  ) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many attachment uploads. Try again shortly.',
    })
  }
  if (message.includes('case_message_attachment_draft_file_limit_exceeded')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A message can contain at most 10 attachments.',
      data: { code: 'case_message_attachment_draft_file_limit_exceeded' },
    })
  }
  if (message.includes('case_message_attachment_draft_size_limit_exceeded')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The combined attachment size cannot exceed 50 MiB.',
      data: { code: 'case_message_attachment_draft_size_limit_exceeded' },
    })
  }
  if (message.includes('case_message_already_sent')) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This message has already been sent.',
    })
  }
  if (message.includes('case_message_attachment_reservation_expired')) {
    throw createError({
      statusCode: 410,
      statusMessage: 'The attachment upload has expired. Add the file again.',
      data: { code: 'message_attachment_reservation_expired' },
    })
  }
  if (
    message.includes('case_message_attachment_upload_mismatch')
    || message.includes('case_message_attachment_already_sent')
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The attachment is no longer available for this draft.',
    })
  }
  throwDbError(error)
}

export function requiredMessageAttachmentId(value: unknown): string {
  if (typeof value !== 'string' || !caseUuidPattern.test(value)) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }
  return value.toLowerCase()
}

function canonicalContentType(value: unknown): string {
  return String(value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

function reservationFromRpc(
  value: unknown,
  access: CaseConversationAccess,
  input: ReserveMessageAttachmentInput,
): StaffAttachmentReservation {
  const row = asRecord(value)
  const attachment = mapMessageAttachmentRow({
    id: row.id,
    name: row.name ?? row.fileName ?? row.file_name,
    mimeType: row.mimeType ?? row.contentType ?? row.content_type,
    sizeBytes: row.sizeBytes ?? row.size_bytes,
  })
  const conversationId = String(
    row.conversationId ?? row.conversation_id ?? '',
  ).toLowerCase()
  const clientMessageId = String(
    row.clientMessageId ?? row.client_message_id ?? '',
  ).toLowerCase()
  const storagePath = String(row.storagePath ?? row.storage_path ?? '')
  const expectedPath = buildMessageAttachmentStoragePath({
    organizationId: access.session.organizationId,
    caseId: access.caseId,
    conversationId: access.conversation.id,
    clientMessageId: input.clientMessageId,
    attachmentId: attachment.id,
    mimeType: input.mimeType,
  })
  const expiresAt = String(row.expiresAt ?? row.expires_at ?? '')

  if (
    conversationId !== access.conversation.id
    || clientMessageId !== input.clientMessageId.toLowerCase()
    || attachment.name !== input.name
    || attachment.mimeType !== input.mimeType
    || attachment.sizeBytes !== input.sizeBytes
    || storagePath !== expectedPath
    || !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Attachment reservation returned an invalid result',
    })
  }

  return { attachment, storagePath, expiresAt }
}

async function discardReservationRpc(
  event: H3Event,
  access: CaseConversationAccess,
  attachmentId: string,
): Promise<string | null> {
  const backend = serverDataBackend(event) as any
  const commonInput = {
    p_organization_id: access.session.organizationId,
    p_case_id: access.caseId,
    p_actor_user_id: access.session.userId,
    p_attachment_id: attachmentId,
  }
  const result = access.conversation.kind === 'group'
    ? await backend.rpc('discard_staff_case_group_message_attachment', {
        ...commonInput,
        p_conversation_id: access.conversation.id,
      })
    : await backend.rpc('discard_staff_case_message_attachment', {
        ...commonInput,
        p_client_person_id: access.clientPerson!.clientPersonId,
      })
  throwAttachmentDbError(result.error)
  const payload = asRecord(result.data)
  const storagePath = payload.storagePath ?? payload.storage_path
  return typeof storagePath === 'string' && storagePath ? storagePath : null
}

export async function reserveStaffMessageAttachment(
  event: H3Event,
  access: CaseConversationAccess,
  input: ReserveMessageAttachmentInput,
) {
  if (
    !access.participants.length
    || (access.conversation.kind === 'group' && access.participants.length < 2)
    || access.participants.some(participant => !participant.portalEnabled)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: access.conversation.kind === 'group'
        ? 'Enable the client portal for every borrower before adding attachments'
        : 'Enable the client portal before adding attachments',
    })
  }

  const backend = serverDataBackend(event) as any
  const commonInput = {
    p_organization_id: access.session.organizationId,
    p_case_id: access.caseId,
    p_actor_user_id: access.session.userId,
    p_client_message_id: input.clientMessageId,
    p_file_name: input.name,
    p_content_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
  }
  const result = access.conversation.kind === 'group'
    ? await backend.rpc('reserve_staff_case_group_message_attachment', {
        ...commonInput,
        p_conversation_id: access.conversation.id,
      })
    : await backend.rpc('reserve_staff_case_message_attachment', {
        ...commonInput,
        p_client_person_id: access.clientPerson!.clientPersonId,
      })
  throwAttachmentDbError(result.error)
  const reservation = reservationFromRpc(result.data, access, input)

  try {
    const upload = await serverStorageClient(event).createSignedUploadUrl({
      namespace: MESSAGE_ATTACHMENT_NAMESPACE,
      path: reservation.storagePath,
      contentType: reservation.attachment.mimeType,
      size: reservation.attachment.sizeBytes,
      expiresInSeconds: 5 * 60,
    })
    return {
      attachment: reservation.attachment,
      upload: {
        url: upload.url,
        method: upload.method,
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      },
    }
  }
  catch (error) {
    await discardReservationRpc(event, access, reservation.attachment.id)
      .catch(() => undefined)
    throw error
  }
}

async function loadStaffReservation(
  event: H3Event,
  access: CaseConversationAccess,
  attachmentId: string,
) {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_case_message_attachments')
    .select(reservationSelect)
    .eq('id', attachmentId)
    .eq('organization_id', access.session.organizationId)
    .eq('conversation_id', access.conversation.id)
    .eq('uploader_kind', 'staff')
    .eq('uploader_user_id', access.session.userId)
    .is('message_id', null)
    .is('discarded_at', null)
    .maybeSingle()
  throwDbError(result.error)
  if (!result.data) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }
  return result.data as Record<string, unknown>
}

async function removeUnusableUpload(
  event: H3Event,
  access: CaseConversationAccess,
  attachmentId: string,
  storagePath: string,
) {
  await discardReservationRpc(event, access, attachmentId).catch(() => undefined)
  await serverStorageClient(event).delete({
    namespace: MESSAGE_ATTACHMENT_NAMESPACE,
    path: storagePath,
  }).catch((error) => {
    console.warn('[crm-messaging] failed to remove rejected attachment blob', {
      attachmentId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export async function completeStaffMessageAttachment(
  event: H3Event,
  access: CaseConversationAccess,
  attachmentIdInput: unknown,
): Promise<MessageAttachment> {
  const attachmentId = requiredMessageAttachmentId(attachmentIdInput)
  const reservation = await loadStaffReservation(event, access, attachmentId)
  const storagePath = String(reservation.storage_path ?? '')
  const expectedType = canonicalContentType(reservation.content_type)
  const expectedSize = Number(reservation.size_bytes)
  const expectedPath = buildMessageAttachmentStoragePath({
    organizationId: access.session.organizationId,
    caseId: access.caseId,
    conversationId: access.conversation.id,
    clientMessageId: String(reservation.client_message_id),
    attachmentId,
    mimeType: expectedType,
  })
  if (storagePath !== expectedPath) {
    throw createError({ statusCode: 409, statusMessage: 'Attachment path is invalid' })
  }

  const storage = serverStorageClient(event)
  const object = await storage.head({
    namespace: MESSAGE_ATTACHMENT_NAMESPACE,
    path: storagePath,
  })
  if (!object) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The uploaded file is not available yet',
      data: { code: 'message_attachment_upload_pending' },
    })
  }
  const uploadedType = canonicalContentType(object.contentType)
  if (object.size !== expectedSize || uploadedType !== expectedType) {
    await removeUnusableUpload(event, access, attachmentId, storagePath)
    throw createError({
      statusCode: 415,
      statusMessage: 'Uploaded file metadata does not match the reservation',
      data: { code: 'message_attachment_upload_mismatch' },
    })
  }

  const backend = serverDataBackend(event) as any
  const completeResult = await backend.rpc('complete_case_message_attachment_upload', {
    p_attachment_id: attachmentId,
    p_storage_path: storagePath,
    p_content_type: uploadedType,
    p_size_bytes: object.size,
    p_etag: object.etag ?? null,
  })
  throwAttachmentDbError(completeResult.error)

  return mapMessageAttachmentRow(reservation)
}

export async function discardStaffMessageAttachment(
  event: H3Event,
  access: CaseConversationAccess,
  attachmentIdInput: unknown,
): Promise<void> {
  const attachmentId = requiredMessageAttachmentId(attachmentIdInput)
  const storagePath = await discardReservationRpc(event, access, attachmentId)
  if (!storagePath) return
  await serverStorageClient(event).delete({
    namespace: MESSAGE_ATTACHMENT_NAMESPACE,
    path: storagePath,
  }).catch((error) => {
    console.warn('[crm-messaging] failed to remove discarded attachment blob', {
      attachmentId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export async function loadStaffMessageAttachment(
  event: H3Event,
  access: CaseConversationAccess,
  attachmentIdInput: unknown,
) {
  const attachmentId = requiredMessageAttachmentId(attachmentIdInput)
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_case_message_attachments')
    .select(reservationSelect)
    .eq('id', attachmentId)
    .eq('organization_id', access.session.organizationId)
    .eq('conversation_id', access.conversation.id)
    .not('message_id', 'is', null)
    .is('discarded_at', null)
    .maybeSingle()
  throwDbError(result.error)
  if (!result.data) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }
  return result.data as Record<string, unknown>
}

function attachmentContentDisposition(
  fileName: string,
  mimeType: string,
  disposition: 'attachment' | 'inline',
): string {
  let safeName = normalizeMessageAttachmentName(fileName) ?? 'attachment'
  const extension = messageAttachmentExtension(mimeType)
  const hasExtension = /\.[^.]+$/u.test(safeName)
  if (
    extension
    && (
      !hasExtension
      || resolveMessageAttachmentContentType(safeName, mimeType) !== mimeType
    )
  ) {
    const suffix = `.${extension}`
    const base = safeName.replace(/\.[^.]*$/u, '').trim() || 'attachment'
    safeName = `${[...base].slice(
      0,
      MESSAGE_ATTACHMENT_NAME_MAX_LENGTH - [...suffix].length,
    ).join('')}${suffix}`
  }
  const asciiName = safeName
    .replace(/[^\x20-\x7e]/gu, '_')
    .replace(/["\\]/gu, '_')
  const encodedName = encodeURIComponent(safeName).replace(
    /['()*]/gu,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
}

export async function serveStaffMessageAttachment(
  event: H3Event,
  access: CaseConversationAccess,
  attachmentIdInput: unknown,
  forceDownload: boolean,
) {
  const attachmentId = requiredMessageAttachmentId(attachmentIdInput)
  const row = await loadStaffMessageAttachment(event, access, attachmentId)
  const attachment = mapMessageAttachmentRow(row)
  const storagePath = String(row.storage_path ?? '')
  const expectedPath = buildMessageAttachmentStoragePath({
    organizationId: access.session.organizationId,
    caseId: access.caseId,
    conversationId: access.conversation.id,
    clientMessageId: String(row.client_message_id),
    attachmentId,
    mimeType: attachment.mimeType,
  })
  if (storagePath !== expectedPath || !row.uploaded_at) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Attachment file is not available',
    })
  }

  const storage = serverStorageClient(event)
  const canPreview = attachment.mimeType.startsWith('image/')
    || attachment.mimeType === 'application/pdf'
  setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  if (!forceDownload && canPreview) {
    const signed = await storage.createSignedUrl({
      namespace: MESSAGE_ATTACHMENT_NAMESPACE,
      path: storagePath,
      expiresInSeconds: 2 * 60,
    })
    return sendRedirect(event, signed.url, 302)
  }

  const file = await storage.download({
    namespace: MESSAGE_ATTACHMENT_NAMESPACE,
    path: storagePath,
  })
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment file not found' })
  }
  setHeader(event, 'Content-Type', attachment.mimeType)
  setHeader(event, 'Content-Length', file.object.size)
  setHeader(
    event,
    'Content-Disposition',
    attachmentContentDisposition(
      attachment.name,
      attachment.mimeType,
      forceDownload ? 'attachment' : 'inline',
    ),
  )
  return sendStream(event, file.stream)
}

export async function cleanupExpiredMessageAttachments(
  event: H3Event,
  workerId: string,
  limit: number,
) {
  const backend = serverDataBackend(event) as any
  const enqueueResult = await backend.rpc(
    'enqueue_expired_case_message_attachment_deletions',
    { p_limit: limit },
  )
  throwDbError(enqueueResult.error)

  const result = await backend.rpc(
    'claim_case_message_attachment_blob_deletions',
    { p_worker_id: workerId, p_limit: limit },
  )
  throwDbError(result.error)

  const rows = (result.data ?? []) as Record<string, unknown>[]
  const storage = serverStorageClient(event)
  let cursor = 0
  let deleted = 0
  let failed = 0

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++]!
      const attachmentId = String(row.id ?? '')
      const storagePath = String(row.storage_path ?? row.storagePath ?? '')
      try {
        // Reuse the namespace path validator before forwarding a database value
        // to the provider boundary.
        messageAttachmentBlobPath(storagePath)
        await storage.delete({
          namespace: MESSAGE_ATTACHMENT_NAMESPACE,
          path: storagePath,
        })
        const remainingObject = await storage.head({
          namespace: MESSAGE_ATTACHMENT_NAMESPACE,
          path: storagePath,
        })
        if (remainingObject) {
          throw new Error('Attachment Blob still exists after deletion')
        }
        const completion = await backend.rpc(
          'complete_case_message_attachment_blob_deletion',
          {
            p_id: attachmentId,
            p_worker_id: workerId,
            p_succeeded: true,
            p_error: null,
          },
        )
        throwDbError(completion.error)
        deleted += 1
      }
      catch (error) {
        failed += 1
        const message = (error instanceof Error ? error.message : String(error))
          .slice(0, 4000)
        const completion = await backend.rpc(
          'complete_case_message_attachment_blob_deletion',
          {
            p_id: attachmentId,
            p_worker_id: workerId,
            p_succeeded: false,
            p_error: message,
          },
        ).catch((completionError: unknown) => ({ error: completionError }))
        if (completion.error) {
          console.warn('[crm-messaging] failed to release attachment cleanup claim', {
            attachmentId,
            message: completion.error instanceof Error
              ? completion.error.message
              : String(completion.error),
          })
        }
        console.warn('[crm-messaging] failed to remove expired attachment blob', {
          attachmentId,
          message,
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, rows.length) }, () => worker()),
  )
  return {
    enqueued: Number(enqueueResult.data ?? 0),
    claimed: rows.length,
    deleted,
    failed,
  }
}
