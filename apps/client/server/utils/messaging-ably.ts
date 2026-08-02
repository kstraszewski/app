import * as Ably from 'ably'
import {
  MessageCreatedEventSchema,
  ReceiptUpdatedEventSchema,
  conversationChannelNames,
  type DurableConversationEvent,
} from '@openexpert/messaging'
import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'

const ABLY_TOKEN_TTL_MS = 15 * 60 * 1000
export const MESSAGING_POLL_INTERVAL_MS = 5_000

interface MessagingRuntimeConfig {
  ablyApiKey?: string
}

export interface MessagingPublishResult {
  configured: boolean
  published: boolean
  error: string | null
}

let cachedRest: { key: string, client: Ably.Rest } | undefined

function configuredApiKey(event: H3Event): string {
  const config = useRuntimeConfig(event).messaging as MessagingRuntimeConfig
  return String(config?.ablyApiKey ?? '').trim()
}

export function isMessagingRealtimeConfigured(event: H3Event): boolean {
  return Boolean(configuredApiKey(event))
}

function ablyRest(event: H3Event): Ably.Rest | null {
  const key = configuredApiKey(event)
  if (!key) return null
  if (cachedRest?.key === key) return cachedRest.client

  const client = new Ably.Rest({ key })
  cachedRest = { key, client }
  return client
}

export function conversationRealtime(
  event: H3Event,
  conversationId: string,
) {
  const channels = conversationChannelNames(conversationId)
  return {
    mode: configuredApiKey(event) ? 'ably' as const : 'polling' as const,
    channel: channels.durable,
    ephemeralChannel: channels.ephemeral,
    pollIntervalMs: MESSAGING_POLL_INTERVAL_MS,
  }
}

export async function createConversationTokenRequest(
  event: H3Event,
  conversationId: string,
  clientId: string,
) {
  const rest = ablyRest(event)
  if (!rest) return null

  const channels = conversationChannelNames(conversationId)
  const capability = JSON.stringify({
    [channels.durable]: ['push-subscribe', 'subscribe'],
    [channels.ephemeral]: ['publish', 'subscribe'],
  })
  const tokenRequest = await rest.auth.createTokenRequest({
    capability,
    clientId,
    ttl: ABLY_TOKEN_TTL_MS,
  })

  return {
    tokenRequest,
    channel: channels.durable,
    ephemeralChannel: channels.ephemeral,
    clientId,
  }
}

export async function publishConversationEvent(
  event: H3Event,
  durableEvent: DurableConversationEvent,
): Promise<MessagingPublishResult> {
  const rest = ablyRest(event)
  if (!rest) return { configured: false, published: false, error: null }

  const parsedEvent = durableEvent.kind === 'receipt.updated'
    ? ReceiptUpdatedEventSchema.parse(durableEvent)
    : MessageCreatedEventSchema.parse(durableEvent)

  try {
    const channel = conversationChannelNames(parsedEvent.conversationId).durable
    await rest.channels.get(channel).publish(parsedEvent.kind, parsedEvent)
    return { configured: true, published: true, error: null }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[client-messaging] Ably publish failed', {
      kind: parsedEvent.kind,
      conversationId: parsedEvent.conversationId,
      message,
    })
    return { configured: true, published: false, error: message.slice(0, 1_000) }
  }
}

export async function publishDirectMessagePush(
  event: H3Event,
  recipientClientId: string | null,
  path: string,
): Promise<MessagingPublishResult> {
  const rest = ablyRest(event)
  if (!rest) return { configured: false, published: false, error: null }
  if (!recipientClientId) return { configured: true, published: true, error: null }

  try {
    await rest.push.admin.publish(
      { clientId: recipientClientId },
      {
        notification: {
          title: 'OpenExpert',
          body: 'Masz nową wiadomość w OpenExpert',
          ttl: 3_600,
        },
        data: { path },
      },
    )
    return { configured: true, published: true, error: null }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[client-messaging] Ably push failed', {
      recipientClientId,
      message,
    })
    return { configured: true, published: false, error: message.slice(0, 1_000) }
  }
}
