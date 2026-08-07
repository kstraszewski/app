import { z } from 'zod'
import type {
  Conversation,
  ConversationKind,
  ConversationParticipantKind,
  Message,
  MessageAttachment,
  MessageReplyReference,
  Receipt,
} from './types.ts'

const uuidSchema = z.string().uuid()
const participantKindSchema = z.enum(['staff', 'client'])
const conversationKindSchema = z.enum(['direct', 'group'])

function numericSequenceSchema(minimum: number) {
  return z.union([
    z.number().int(),
    z.string().regex(/^(?:0|[1-9]\d*)$/u),
  ])
    .transform(value => typeof value === 'number' ? value : Number(value))
    .pipe(z.number().int().min(minimum).max(Number.MAX_SAFE_INTEGER))
}

const timestampSchema = z.string()
  .min(1)
  .refine(value => Number.isFinite(Date.parse(value)), {
    message: 'Expected an ISO-compatible timestamp',
  })
  .transform(value => new Date(value).toISOString())

const nullableTimestampSchema = timestampSchema.nullable()

const attachmentPositionSchema = numericSequenceSchema(1)

export const DataApiMessageAttachmentRowSchema = z.object({
  id: uuidSchema,
  position: attachmentPositionSchema.optional(),
  file_name: z.string().min(1).optional(),
  content_type: z.string().min(1).optional(),
  size_bytes: numericSequenceSchema(1).optional(),
  name: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  sizeBytes: numericSequenceSchema(1).optional(),
}).passthrough().superRefine((row, context) => {
  if (!(row.file_name ?? row.name)) {
    context.addIssue({ code: 'custom', message: 'Attachment name is required' })
  }
  if (!(row.content_type ?? row.mimeType)) {
    context.addIssue({ code: 'custom', message: 'Attachment MIME type is required' })
  }
  if ((row.size_bytes ?? row.sizeBytes) === undefined) {
    context.addIssue({ code: 'custom', message: 'Attachment size is required' })
  }
})

export type DataApiMessageAttachmentRow = z.input<
  typeof DataApiMessageAttachmentRowSchema
>

export const DataApiConversationRowSchema = z.object({
  case_id: uuidSchema,
  client_id: uuidSchema.nullable(),
  client_person_id: uuidSchema.nullable(),
  created_at: timestampSchema,
  id: uuidSchema,
  kind: conversationKindSchema,
  last_message_at: nullableTimestampSchema,
  last_message_sequence: numericSequenceSchema(0),
  organization_id: uuidSchema,
  updated_at: timestampSchema,
}).passthrough().superRefine((row, context) => {
  const isDirectShape = Boolean(row.client_id && row.client_person_id)
  const isGroupShape = row.client_id === null && row.client_person_id === null
  if (
    (row.kind === 'direct' && !isDirectShape)
    || (row.kind === 'group' && !isGroupShape)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Conversation identifiers do not match kind',
      path: ['kind'],
    })
  }
})

export type DataApiConversationRow = z.input<
  typeof DataApiConversationRowSchema
>

export const DataApiMessageReplyRowSchema = z.object({
  attachments: z.array(z.unknown()).optional(),
  body: z.string(),
  id: uuidSchema,
  sender_kind: participantKindSchema,
  sender_client_person_id: uuidSchema.nullable().optional().default(null),
  sequence: numericSequenceSchema(1),
  crm_case_message_attachments: z.array(z.unknown()).optional(),
}).passthrough().superRefine((row, context) => {
  if (
    (row.sender_kind === 'client' && !row.sender_client_person_id)
    || (row.sender_kind === 'staff' && row.sender_client_person_id)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Reply sender identifier does not match sender_kind',
      path: ['sender_client_person_id'],
    })
  }
})

export type DataApiMessageReplyRow = z.input<
  typeof DataApiMessageReplyRowSchema
>

export const DataApiMessageRowSchema = z.object({
  attachments: z.array(z.unknown()).optional(),
  body: z.string(),
  client_message_id: uuidSchema,
  conversation_id: uuidSchema,
  created_at: timestampSchema,
  deleted_at: nullableTimestampSchema.optional().default(null),
  edited_at: nullableTimestampSchema.optional().default(null),
  id: uuidSchema,
  organization_id: uuidSchema,
  reply_to_message: DataApiMessageReplyRowSchema.nullable().optional().default(null),
  reply_to_message_id: uuidSchema.nullable().optional().default(null),
  sender_auth_user_id: uuidSchema.nullable().optional().default(null),
  sender_client_person_id: uuidSchema.nullable(),
  sender_kind: participantKindSchema,
  sender_user_id: uuidSchema.nullable(),
  sequence: numericSequenceSchema(1),
  crm_case_message_attachments: z.array(z.unknown()).optional(),
}).passthrough().superRefine((row, context) => {
  if (
    row.reply_to_message
    && row.reply_to_message_id !== row.reply_to_message.id
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Reply reference does not match reply_to_message_id',
      path: ['reply_to_message'],
    })
  }

  if (row.sender_kind === 'staff') {
    if (row.sender_client_person_id || row.sender_auth_user_id) {
      context.addIssue({
        code: 'custom',
        message: 'Staff messages cannot contain client sender identifiers',
        path: ['sender_kind'],
      })
    }
    return
  }

  if (!row.sender_client_person_id) {
    context.addIssue({
      code: 'custom',
      message: 'Client messages require a person sender identifier',
      path: ['sender_kind'],
    })
  }
  if (row.sender_user_id) {
    context.addIssue({
      code: 'custom',
      message: 'Client messages cannot contain sender_user_id',
      path: ['sender_user_id'],
    })
  }
})

export type DataApiMessageRow = z.input<typeof DataApiMessageRowSchema>

export const DataApiReceiptRowSchema = z.object({
  conversation_id: uuidSchema,
  delivered_at: nullableTimestampSchema.optional().default(null),
  delivered_through_sequence: numericSequenceSchema(0),
  id: uuidSchema,
  organization_id: uuidSchema,
  participant_client_person_id: uuidSchema.nullable(),
  participant_kind: participantKindSchema,
  participant_user_id: uuidSchema.nullable(),
  read_at: nullableTimestampSchema.optional().default(null),
  read_through_sequence: numericSequenceSchema(0),
  updated_at: timestampSchema,
}).passthrough().superRefine((row, context) => {
  if (row.read_through_sequence > row.delivered_through_sequence) {
    context.addIssue({
      code: 'custom',
      message: 'Read sequence cannot exceed delivered sequence',
      path: ['read_through_sequence'],
    })
  }

  const expectedIdentifier = row.participant_kind === 'staff'
    ? row.participant_user_id
    : row.participant_client_person_id
  const unexpectedIdentifier = row.participant_kind === 'staff'
    ? row.participant_client_person_id
    : row.participant_user_id

  if (!expectedIdentifier || unexpectedIdentifier) {
    context.addIssue({
      code: 'custom',
      message: 'Receipt participant identifiers do not match participant_kind',
      path: ['participant_kind'],
    })
  }
})

export type DataApiReceiptRow = z.input<typeof DataApiReceiptRowSchema>

export function mapConversationRow(row: unknown): Conversation {
  const parsed = DataApiConversationRowSchema.parse(row)
  return {
    id: parsed.id,
    organizationId: parsed.organization_id,
    caseId: parsed.case_id,
    kind: parsed.kind as ConversationKind,
    clientId: parsed.client_id,
    clientPersonId: parsed.client_person_id,
    lastMessageSequence: parsed.last_message_sequence,
    lastMessageAt: parsed.last_message_at,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  }
}

export function mapMessageRow(row: unknown): Message {
  const parsed = DataApiMessageRowSchema.parse(row)
  const attachments = mapMessageAttachments(
    parsed.attachments ?? parsed.crm_case_message_attachments ?? [],
  )
  return {
    id: parsed.id,
    organizationId: parsed.organization_id,
    conversationId: parsed.conversation_id,
    sequence: parsed.sequence,
    clientMessageId: parsed.client_message_id,
    senderKind: parsed.sender_kind as ConversationParticipantKind,
    senderUserId: parsed.sender_user_id,
    senderClientPersonId: parsed.sender_client_person_id,
    senderAuthUserId: parsed.sender_auth_user_id,
    body: parsed.body,
    attachments,
    replyToMessageId: parsed.reply_to_message_id,
    replyToMessage: parsed.reply_to_message
      ? mapMessageReplyRow(parsed.reply_to_message)
      : null,
    createdAt: parsed.created_at,
    editedAt: parsed.edited_at,
    deletedAt: parsed.deleted_at,
  }
}

function mapMessageAttachments(rows: readonly unknown[]): MessageAttachment[] {
  return rows
    .map((attachment, index) => {
      const mapped = mapMessageAttachmentRow(attachment)
      const position = DataApiMessageAttachmentRowSchema.parse(attachment).position
        ?? index + 1
      return { mapped, position, index }
    })
    .sort((left, right) => left.position - right.position || left.index - right.index)
    .map(item => item.mapped)
}

export function mapMessageReplyRow(row: unknown): MessageReplyReference {
  const parsed = DataApiMessageReplyRowSchema.parse(row)
  return {
    id: parsed.id,
    sequence: parsed.sequence,
    senderKind: parsed.sender_kind as ConversationParticipantKind,
    senderClientPersonId: parsed.sender_client_person_id,
    body: parsed.body,
    attachments: mapMessageAttachments(
      parsed.attachments ?? parsed.crm_case_message_attachments ?? [],
    ),
  }
}

export function mapMessageAttachmentRow(row: unknown): MessageAttachment {
  const parsed = DataApiMessageAttachmentRowSchema.parse(row)
  return {
    id: parsed.id,
    name: parsed.file_name ?? parsed.name!,
    mimeType: parsed.content_type ?? parsed.mimeType!,
    sizeBytes: parsed.size_bytes ?? parsed.sizeBytes!,
  }
}

export function mapReceiptRow(row: unknown): Receipt {
  const parsed = DataApiReceiptRowSchema.parse(row)
  return {
    id: parsed.id,
    organizationId: parsed.organization_id,
    conversationId: parsed.conversation_id,
    participantKind: parsed.participant_kind as ConversationParticipantKind,
    participantUserId: parsed.participant_user_id,
    participantClientPersonId: parsed.participant_client_person_id,
    deliveredThroughSequence: parsed.delivered_through_sequence,
    readThroughSequence: parsed.read_through_sequence,
    deliveredAt: parsed.delivered_at,
    readAt: parsed.read_at,
    updatedAt: parsed.updated_at,
  }
}

export function mapConversationRows(rows: readonly unknown[]): Conversation[] {
  return rows.map(mapConversationRow)
}

export function mapMessageRows(rows: readonly unknown[]): Message[] {
  return rows.map(mapMessageRow)
}

export function mapMessageAttachmentRows(
  rows: readonly unknown[],
): MessageAttachment[] {
  return rows.map(mapMessageAttachmentRow)
}

export function mapReceiptRows(rows: readonly unknown[]): Receipt[] {
  return rows.map(mapReceiptRow)
}
