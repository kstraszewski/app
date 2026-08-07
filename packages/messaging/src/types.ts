export type ConversationParticipantKind = 'staff' | 'client'
export type ConversationKind = 'direct' | 'group'

export interface Conversation {
  id: string
  organizationId: string
  caseId: string
  kind: ConversationKind
  clientId: string | null
  clientPersonId: string | null
  lastMessageSequence: number
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageReplyReference {
  id: string
  sequence: number
  senderKind: ConversationParticipantKind
  senderClientPersonId: string | null
  body: string
  attachments: MessageAttachment[]
}

export interface Message {
  id: string
  organizationId: string
  conversationId: string
  sequence: number
  clientMessageId: string
  senderKind: ConversationParticipantKind
  senderUserId: string | null
  senderClientPersonId: string | null
  senderAuthUserId: string | null
  body: string
  attachments: MessageAttachment[]
  replyToMessageId: string | null
  replyToMessage: MessageReplyReference | null
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
}

export interface MessageAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
}

export interface Receipt {
  id: string
  organizationId: string
  conversationId: string
  participantKind: ConversationParticipantKind
  participantUserId: string | null
  participantClientPersonId: string | null
  deliveredThroughSequence: number
  readThroughSequence: number
  deliveredAt: string | null
  readAt: string | null
  updatedAt: string
}

export interface ConversationReceipts {
  self: Receipt | null
  peer: Receipt | null
}

export interface ConversationPageInfo {
  lastSequence: number
  hasMore: boolean
}

export interface ConversationSnapshot {
  conversation: Conversation
  messages: Message[]
  receipt: Receipt | null
  peerReceipt: Receipt | null
  pageInfo: ConversationPageInfo
}

export type MessageDurableEventKind = 'message.created'

export interface MessageDurableEvent {
  kind: MessageDurableEventKind
  conversationId: string
  messageId: string
  sequence: number
}

export interface ReceiptUpdatedEvent {
  kind: 'receipt.updated'
  conversationId: string
  sequence: number
}

/**
 * Durable events are invalidation hints, not message transport. Consumers must
 * refetch from the authenticated HTTP API after receiving one.
 */
export type DurableConversationEvent =
  | MessageDurableEvent
  | ReceiptUpdatedEvent

export interface TypingUpdatedEvent {
  kind: 'typing.updated'
  conversationId: string
  active: boolean
}

export type EphemeralConversationEvent = TypingUpdatedEvent

export type ConversationEvent =
  | DurableConversationEvent
  | EphemeralConversationEvent

/** Short aliases for application-facing contracts. */
export type Event = ConversationEvent
