import type { Conversation, Message, Receipt } from '@openexpert/messaging'
import type { CrmConversationInboxItem } from '../../shared/types/case-conversation-inbox.ts'

export interface CrmConversationInboxCase {
  id: string
  title: string
  statusCode: string | null
}

export interface CrmConversationInboxPerson {
  id: string
  clientId: string
  displayName: string
  email: string | null
}

export function truncateConversationPreview(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}…`
}

function matchingLatestMessage(
  conversation: Conversation,
  message: Message | null,
): Message | null {
  if (
    !message
    || message.organizationId !== conversation.organizationId
    || message.conversationId !== conversation.id
    || message.sequence !== conversation.lastMessageSequence
  ) return null
  return message
}

function matchingReceipt(
  conversation: Conversation,
  receipt: Receipt | null,
  currentUserId: string,
): Receipt | null {
  if (
    !receipt
    || receipt.organizationId !== conversation.organizationId
    || receipt.conversationId !== conversation.id
    || receipt.participantKind !== 'staff'
    || receipt.participantUserId !== currentUserId
  ) return null
  return receipt
}

export function buildCrmConversationInboxItem(input: {
  conversation: Conversation
  caseData: CrmConversationInboxCase | null
  clientPerson: CrmConversationInboxPerson | null
  lastMessage: Message | null
  receipt: Receipt | null
  currentUserId: string
}): CrmConversationInboxItem | null {
  const { conversation, currentUserId } = input
  if (!conversation.lastMessageAt || conversation.lastMessageSequence < 1) return null

  const caseData = input.caseData?.id === conversation.caseId
    ? input.caseData
    : null
  const clientPerson = input.clientPerson?.id === conversation.clientPersonId
    && input.clientPerson.clientId === conversation.clientId
    ? input.clientPerson
    : null
  const lastMessage = matchingLatestMessage(conversation, input.lastMessage)
  const receipt = matchingReceipt(conversation, input.receipt, currentUserId)
  const readThroughSequence = Math.min(
    conversation.lastMessageSequence,
    Math.max(0, receipt?.readThroughSequence ?? 0),
  )

  return {
    conversationId: conversation.id,
    caseId: conversation.caseId,
    caseTitle: caseData?.title.trim() || 'Sprawa bez nazwy',
    caseStatusCode: caseData?.statusCode ?? null,
    clientId: conversation.clientId,
    clientPersonId: conversation.clientPersonId,
    clientName: clientPerson?.displayName.trim() || 'Klient',
    clientEmail: clientPerson?.email?.trim() || null,
    lastMessageSequence: conversation.lastMessageSequence,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: lastMessage
      ? truncateConversationPreview(lastMessage.body)
      : null,
    lastMessageSenderKind: lastMessage?.senderKind ?? null,
    lastMessageSentByCurrentUser: Boolean(
      lastMessage?.senderKind === 'staff'
      && lastMessage.senderUserId === currentUserId,
    ),
    readThroughSequence,
    unreadCount: Math.max(0, conversation.lastMessageSequence - readThroughSequence),
  }
}

export function sortCrmConversationInboxItems(
  items: readonly CrmConversationInboxItem[],
): CrmConversationInboxItem[] {
  return [...items].sort((left, right) => (
    Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt)
    || left.conversationId.localeCompare(right.conversationId)
  ))
}
