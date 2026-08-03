export type CrmConversationInboxSenderKind = 'staff' | 'client'

export interface CrmConversationInboxItem {
  conversationId: string
  caseId: string
  caseTitle: string
  caseStatusCode: string | null
  clientId: string
  clientPersonId: string
  clientName: string
  clientEmail: string | null
  lastMessageSequence: number
  lastMessageAt: string
  lastMessagePreview: string | null
  lastMessageSenderKind: CrmConversationInboxSenderKind | null
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
