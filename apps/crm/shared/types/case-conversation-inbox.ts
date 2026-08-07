export type CrmConversationInboxSenderKind = 'staff' | 'client'

export interface CrmConversationInboxItem {
  conversationId: string
  kind: 'direct' | 'group'
  caseId: string
  caseTitle: string
  caseStatusCode: string | null
  clientId: string | null
  clientPersonId: string | null
  clientName: string
  clientEmail: string | null
  participants: Array<{
    clientId: string
    clientPersonId: string
    displayName: string
    email: string | null
  }>
  lastMessageSequence: number
  lastMessageAt: string
  lastMessagePreview: string | null
  lastMessageSenderKind: CrmConversationInboxSenderKind | null
  lastMessageSenderName: string | null
  lastMessageSentByCurrentUser: boolean
  readThroughSequence: number
  unreadCount: number
}

export interface CrmConversationInboxPayload {
  conversations: CrmConversationInboxItem[]
  unreadCount: number
  unreadConversationCount: number
  hasMore: boolean
  generatedAt: string
}

export interface CrmConversationInboxResponse {
  data: CrmConversationInboxPayload
}
