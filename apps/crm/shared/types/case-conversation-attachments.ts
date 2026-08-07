import type { MessageAttachment } from '@openexpert/messaging'

export interface CrmClientConversationAttachment extends MessageAttachment {
  messageId: string
  position: number
  sentAt: string
  uploaderClientPersonId: string
  uploaderName: string
}

export interface CrmConversationAttachmentsResponse {
  data: {
    attachments: CrmClientConversationAttachment[]
    pageInfo: {
      hasMore: boolean
      nextCursor: string | null
    }
  }
}
