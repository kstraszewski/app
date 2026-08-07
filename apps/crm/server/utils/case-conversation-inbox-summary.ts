import {
  buildMessagePreview,
  type Conversation,
  type Message,
  type Receipt,
} from '@openexpert/messaging'
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
  participants?: CrmConversationInboxPerson[]
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
  const participants = (input.participants ?? []).filter((participant, index, values) => (
    values.findIndex(candidate => candidate.id === participant.id) === index
  ))
  const groupName = `Wszyscy kredytobiorcy (${participants.length})`
  const lastMessage = matchingLatestMessage(conversation, input.lastMessage)
  const lastClientSender = lastMessage?.senderClientPersonId
    ? participants.find(participant => participant.id === lastMessage.senderClientPersonId)
      ?? (clientPerson?.id === lastMessage.senderClientPersonId ? clientPerson : null)
    : null
  const receipt = matchingReceipt(conversation, input.receipt, currentUserId)
  const readThroughSequence = Math.min(
    conversation.lastMessageSequence,
    Math.max(0, receipt?.readThroughSequence ?? 0),
  )

  return {
    conversationId: conversation.id,
    kind: conversation.kind,
    caseId: conversation.caseId,
    caseTitle: caseData?.title.trim() || 'Sprawa bez nazwy',
    caseStatusCode: caseData?.statusCode ?? null,
    clientId: conversation.clientId,
    clientPersonId: conversation.clientPersonId,
    clientName: conversation.kind === 'group'
      ? groupName
      : clientPerson?.displayName.trim() || 'Klient',
    clientEmail: conversation.kind === 'group'
      ? null
      : clientPerson?.email?.trim() || null,
    participants: participants.map(participant => ({
      clientId: participant.clientId,
      clientPersonId: participant.id,
      displayName: participant.displayName.trim() || 'Klient',
      email: participant.email?.trim() || null,
    })),
    lastMessageSequence: conversation.lastMessageSequence,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: lastMessage
      ? buildMessagePreview(lastMessage.body, lastMessage.attachments)
      : null,
    lastMessageSenderKind: lastMessage?.senderKind ?? null,
    lastMessageSenderName: lastMessage?.senderKind === 'client'
      ? lastClientSender?.displayName.trim() || 'Klient'
      : null,
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
