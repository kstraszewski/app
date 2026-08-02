import { ConversationTokenRequestSchema } from './schemas.ts'

const DURABLE_CHANNEL_PREFIX = 'private:case-chat:'
const EPHEMERAL_CHANNEL_SUFFIX = ':ephemeral'

export interface ConversationChannelNames {
  durable: string
  ephemeral: string
}

function normalizedConversationId(conversationId: string): string {
  return ConversationTokenRequestSchema
    .parse({ conversationId })
    .conversationId
    .toLowerCase()
}

export function conversationDurableChannelName(conversationId: string): string {
  return `${DURABLE_CHANNEL_PREFIX}${normalizedConversationId(conversationId)}`
}

export function conversationEphemeralChannelName(conversationId: string): string {
  return `${conversationDurableChannelName(conversationId)}${EPHEMERAL_CHANNEL_SUFFIX}`
}

export function conversationChannelNames(
  conversationId: string,
): ConversationChannelNames {
  return {
    durable: conversationDurableChannelName(conversationId),
    ephemeral: conversationEphemeralChannelName(conversationId),
  }
}
