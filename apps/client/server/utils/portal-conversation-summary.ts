import type { Conversation, Message, Receipt } from '@openexpert/messaging'

export interface PortalConversationGrantedScope {
  grant: {
    organizationId: string
    caseId: string
    clientId: string
  }
  link: {
    clientPersonId: string
  }
}

export interface PortalConversationSummary {
  caseId: string
  conversationId: string
  lastMessageAt: string | null
  lastMessageSequence: number
  readThroughSequence: number
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageSenderKind: Message['senderKind'] | null
  lastMessageCreatedAt: string | null
}

function scopeKey(input: {
  organizationId: string
  caseId: string
  clientId: string
  clientPersonId: string
}): string {
  return JSON.stringify([
    input.organizationId,
    input.caseId,
    input.clientId,
    input.clientPersonId,
  ])
}

export function isPortalConversationInGrantedScope(
  conversation: Pick<
    Conversation,
    'organizationId' | 'caseId' | 'clientId' | 'clientPersonId'
  >,
  scopes: readonly PortalConversationGrantedScope[],
): boolean {
  return filterPortalConversationsInGrantedScopes(
    [conversation],
    scopes,
  ).length === 1
}

export function filterPortalConversationsInGrantedScopes<
  T extends Pick<
    Conversation,
    'organizationId' | 'caseId' | 'clientId' | 'clientPersonId'
  >,
>(
  conversations: readonly T[],
  scopes: readonly PortalConversationGrantedScope[],
): T[] {
  const allowed = new Set(scopes.map(scope => scopeKey({
    organizationId: scope.grant.organizationId,
    caseId: scope.grant.caseId,
    clientId: scope.grant.clientId,
    clientPersonId: scope.link.clientPersonId,
  })))
  return conversations.filter(conversation => allowed.has(scopeKey(conversation)))
}

export function truncatePortalConversationPreview(body: string): string {
  const compact = body.replace(/\s+/gu, ' ').trim()
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}…`
}

export function buildPortalConversationSummary(
  conversation: Conversation,
  receipt: Receipt | null,
  lastMessage: Message | null,
): PortalConversationSummary {
  const readThroughSequence = Math.min(
    conversation.lastMessageSequence,
    Math.max(0, receipt?.readThroughSequence ?? 0),
  )

  return {
    caseId: conversation.caseId,
    conversationId: conversation.id,
    lastMessageAt: conversation.lastMessageAt,
    lastMessageSequence: conversation.lastMessageSequence,
    readThroughSequence,
    unreadCount: Math.max(
      0,
      conversation.lastMessageSequence - readThroughSequence,
    ),
    lastMessagePreview: lastMessage
      ? truncatePortalConversationPreview(lastMessage.body)
      : null,
    lastMessageSenderKind: lastMessage?.senderKind ?? null,
    lastMessageCreatedAt: lastMessage?.createdAt ?? null,
  }
}
