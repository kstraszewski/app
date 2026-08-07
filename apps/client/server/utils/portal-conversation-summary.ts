import {
  buildMessagePreview,
  type Conversation,
  type ConversationKind,
  type Message,
  type Receipt,
} from '@openexpert/messaging'

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
  kind: ConversationKind
  lastMessageAt: string | null
  lastMessageSequence: number
  readThroughSequence: number
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageSenderKind: Message['senderKind'] | null
  lastMessageSenderClientPersonId: string | null
  lastMessageIsOwn: boolean
  lastMessageCreatedAt: string | null
  participants: PortalConversationSummaryParticipant[]
}

export interface PortalConversationSummaryParticipant {
  clientId: string
  clientPersonId: string
  displayName: string
  role: string
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
    'organizationId' | 'caseId' | 'kind' | 'clientId' | 'clientPersonId'
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
    'organizationId' | 'caseId' | 'kind' | 'clientId' | 'clientPersonId'
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
  return conversations.filter(conversation => (
    conversation.kind === 'direct'
    && Boolean(conversation.clientId)
    && Boolean(conversation.clientPersonId)
    && allowed.has(scopeKey({
      organizationId: conversation.organizationId,
      caseId: conversation.caseId,
      clientId: conversation.clientId!,
      clientPersonId: conversation.clientPersonId!,
    }))
  ))
}

export function truncatePortalConversationPreview(body: string): string {
  const compact = body.replace(/\s+/gu, ' ').trim()
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}…`
}

export function buildPortalConversationSummary(
  conversation: Conversation,
  receipt: Receipt | null,
  lastMessage: Message | null,
  currentClientPersonId = conversation.clientPersonId,
  participants: PortalConversationSummaryParticipant[] = [],
): PortalConversationSummary {
  const readThroughSequence = Math.min(
    conversation.lastMessageSequence,
    Math.max(0, receipt?.readThroughSequence ?? 0),
  )

  return {
    caseId: conversation.caseId,
    conversationId: conversation.id,
    kind: conversation.kind,
    lastMessageAt: conversation.lastMessageAt,
    lastMessageSequence: conversation.lastMessageSequence,
    readThroughSequence,
    unreadCount: Math.max(
      0,
      conversation.lastMessageSequence - readThroughSequence,
    ),
    lastMessagePreview: lastMessage
      ? buildMessagePreview(lastMessage.body, lastMessage.attachments)
      : null,
    lastMessageSenderKind: lastMessage?.senderKind ?? null,
    lastMessageSenderClientPersonId: lastMessage?.senderClientPersonId ?? null,
    lastMessageIsOwn: Boolean(
      lastMessage?.senderKind === 'client'
      && currentClientPersonId
      && lastMessage.senderClientPersonId === currentClientPersonId,
    ),
    lastMessageCreatedAt: lastMessage?.createdAt ?? null,
    participants,
  }
}
