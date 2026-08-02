import { z } from 'zod'
import type {
  Conversation,
  ConversationParticipantKind,
  Message,
  Receipt,
} from './types.ts'

const uuidSchema = z.string().uuid()
const participantKindSchema = z.enum(['staff', 'client'])

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

export const DataApiConversationRowSchema = z.object({
  case_id: uuidSchema,
  client_id: uuidSchema,
  client_person_id: uuidSchema,
  created_at: timestampSchema,
  id: uuidSchema,
  last_message_at: nullableTimestampSchema,
  last_message_sequence: numericSequenceSchema(0),
  organization_id: uuidSchema,
  updated_at: timestampSchema,
}).passthrough()

export type DataApiConversationRow = z.input<
  typeof DataApiConversationRowSchema
>

export const DataApiMessageRowSchema = z.object({
  body: z.string(),
  client_message_id: uuidSchema,
  conversation_id: uuidSchema,
  created_at: timestampSchema,
  deleted_at: nullableTimestampSchema.optional().default(null),
  edited_at: nullableTimestampSchema.optional().default(null),
  id: uuidSchema,
  organization_id: uuidSchema,
  sender_auth_user_id: uuidSchema.nullable().optional().default(null),
  sender_client_person_id: uuidSchema.nullable(),
  sender_kind: participantKindSchema,
  sender_user_id: uuidSchema.nullable(),
  sequence: numericSequenceSchema(1),
}).passthrough().superRefine((row, context) => {
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
    createdAt: parsed.created_at,
    editedAt: parsed.edited_at,
    deletedAt: parsed.deleted_at,
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

export function mapReceiptRows(rows: readonly unknown[]): Receipt[] {
  return rows.map(mapReceiptRow)
}
