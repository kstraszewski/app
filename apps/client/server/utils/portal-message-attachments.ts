import {
  buildMessageAttachmentStoragePath,
  mapMessageAttachmentRow,
  messageAttachmentExtension,
  MESSAGE_ATTACHMENT_NAME_MAX_LENGTH,
  MESSAGE_ATTACHMENT_NAMESPACE,
  normalizeMessageAttachmentName,
  resolveMessageAttachmentContentType,
  type MessageAttachment,
  type ReserveMessageAttachmentInput,
} from '@openexpert/messaging'
import {
  createError,
  sendRedirect,
  sendStream,
  setHeader,
  type H3Event,
} from 'h3'
import { serverDataBackend } from './data-api'
import {
  asRecord,
  requiredUuid,
  throwPortalDbError,
} from './portal-auth'
import type { PortalConversationContext } from './portal-conversation'
import { serverStorageClient } from './platform-storage'

const reservationSelect = [
  'id',
  'organization_id',
  'conversation_id',
  'client_message_id',
  'message_id',
  'uploader_kind',
  'uploader_client_person_id',
  'uploader_auth_user_id',
  'storage_path',
  'file_name',
  'content_type',
  'size_bytes',
  'etag',
  'uploaded_at',
  'expires_at',
  'discarded_at',
].join(',')

interface PortalAttachmentReservation {
  attachment: MessageAttachment
  storagePath: string
  expiresAt: string
}

function throwAttachmentDbError(
  error: { code?: string, message?: string } | null | undefined,
  context: string,
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
  throwPortalDbError(error, context)
}

function attachmentId(value: unknown): string {
  return requiredUuid(value, 'attachmentId')
}

function canonicalContentType(value: unknown): string {
  return String(value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

function reservationFromRpc(
  value: unknown,
  context: PortalConversationContext,
  input: ReserveMessageAttachmentInput,
): PortalAttachmentReservation {
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
    organizationId: context.access.grant.organizationId,
    caseId: context.access.grant.caseId,
    conversationId: context.conversation.id,
    clientMessageId: input.clientMessageId,
    attachmentId: attachment.id,
    mimeType: input.mimeType,
  })
  const expiresAt = String(row.expiresAt ?? row.expires_at ?? '')

  if (
    conversationId !== context.conversation.id
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
  context: PortalConversationContext,
  id: string,
): Promise<string | null> {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('discard_client_case_message_attachment', {
    p_organization_id: context.access.grant.organizationId,
    p_case_id: context.access.grant.caseId,
    p_client_person_id: context.access.link.clientPersonId,
    p_auth_user_id: context.access.session.identity.userId,
    p_attachment_id: id,
  })
  throwAttachmentDbError(result.error, 'could not discard message attachment')
  const payload = asRecord(result.data)
  const storagePath = payload.storagePath ?? payload.storage_path
  return typeof storagePath === 'string' && storagePath ? storagePath : null
}

export async function reservePortalMessageAttachment(
  event: H3Event,
  context: PortalConversationContext,
  input: ReserveMessageAttachmentInput,
) {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('reserve_client_case_message_attachment', {
    p_organization_id: context.access.grant.organizationId,
    p_case_id: context.access.grant.caseId,
    p_client_person_id: context.access.link.clientPersonId,
    p_auth_user_id: context.access.session.identity.userId,
    p_client_message_id: input.clientMessageId,
    p_file_name: input.name,
    p_content_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
  })
  throwAttachmentDbError(result.error, 'could not reserve message attachment')
  const reservation = reservationFromRpc(result.data, context, input)

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
    await discardReservationRpc(event, context, reservation.attachment.id)
      .catch(() => undefined)
    throw error
  }
}

async function loadPortalReservation(
  event: H3Event,
  context: PortalConversationContext,
  id: string,
) {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_case_message_attachments')
    .select(reservationSelect)
    .eq('id', id)
    .eq('organization_id', context.access.grant.organizationId)
    .eq('conversation_id', context.conversation.id)
    .eq('uploader_kind', 'client')
    .eq('uploader_client_person_id', context.access.link.clientPersonId)
    .eq('uploader_auth_user_id', context.access.session.identity.userId)
    .is('message_id', null)
    .is('discarded_at', null)
    .maybeSingle()
  throwPortalDbError(result.error, 'could not load message attachment')
  if (!result.data) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }
  return result.data as Record<string, unknown>
}

async function removeUnusableUpload(
  event: H3Event,
  context: PortalConversationContext,
  id: string,
  storagePath: string,
) {
  await discardReservationRpc(event, context, id).catch(() => undefined)
  await serverStorageClient(event).delete({
    namespace: MESSAGE_ATTACHMENT_NAMESPACE,
    path: storagePath,
  }).catch((error) => {
    console.warn('[client-messaging] failed to remove rejected attachment blob', {
      attachmentId: id,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export async function completePortalMessageAttachment(
  event: H3Event,
  context: PortalConversationContext,
  attachmentIdInput: unknown,
): Promise<MessageAttachment> {
  const id = attachmentId(attachmentIdInput)
  const reservation = await loadPortalReservation(event, context, id)
  const storagePath = String(reservation.storage_path ?? '')
  const expectedType = canonicalContentType(reservation.content_type)
  const expectedSize = Number(reservation.size_bytes)
  const expectedPath = buildMessageAttachmentStoragePath({
    organizationId: context.access.grant.organizationId,
    caseId: context.access.grant.caseId,
    conversationId: context.conversation.id,
    clientMessageId: String(reservation.client_message_id),
    attachmentId: id,
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
    await removeUnusableUpload(event, context, id, storagePath)
    throw createError({
      statusCode: 415,
      statusMessage: 'Uploaded file metadata does not match the reservation',
      data: { code: 'message_attachment_upload_mismatch' },
    })
  }

  const backend = serverDataBackend(event) as any
  const completeResult = await backend.rpc('complete_case_message_attachment_upload', {
    p_attachment_id: id,
    p_storage_path: storagePath,
    p_content_type: uploadedType,
    p_size_bytes: object.size,
    p_etag: object.etag ?? null,
  })
  throwAttachmentDbError(completeResult.error, 'could not confirm message attachment')

  return mapMessageAttachmentRow(reservation)
}

export async function discardPortalMessageAttachment(
  event: H3Event,
  context: PortalConversationContext,
  attachmentIdInput: unknown,
): Promise<void> {
  const id = attachmentId(attachmentIdInput)
  const storagePath = await discardReservationRpc(event, context, id)
  if (!storagePath) return
  await serverStorageClient(event).delete({
    namespace: MESSAGE_ATTACHMENT_NAMESPACE,
    path: storagePath,
  }).catch((error) => {
    console.warn('[client-messaging] failed to remove discarded attachment blob', {
      attachmentId: id,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export async function loadPortalMessageAttachment(
  event: H3Event,
  context: PortalConversationContext,
  attachmentIdInput: unknown,
) {
  const id = attachmentId(attachmentIdInput)
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_case_message_attachments')
    .select(reservationSelect)
    .eq('id', id)
    .eq('organization_id', context.access.grant.organizationId)
    .eq('conversation_id', context.conversation.id)
    .not('message_id', 'is', null)
    .is('discarded_at', null)
    .maybeSingle()
  throwPortalDbError(result.error, 'could not load message attachment')
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

export async function servePortalMessageAttachment(
  event: H3Event,
  context: PortalConversationContext,
  attachmentIdInput: unknown,
  forceDownload: boolean,
) {
  const id = attachmentId(attachmentIdInput)
  const row = await loadPortalMessageAttachment(event, context, id)
  const attachment = mapMessageAttachmentRow(row)
  const storagePath = String(row.storage_path ?? '')
  const expectedPath = buildMessageAttachmentStoragePath({
    organizationId: context.access.grant.organizationId,
    caseId: context.access.grant.caseId,
    conversationId: context.conversation.id,
    clientMessageId: String(row.client_message_id),
    attachmentId: id,
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
