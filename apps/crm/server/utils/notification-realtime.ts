import * as Ably from 'ably'
import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'

const ABLY_TOKEN_TTL_MS = 15 * 60 * 1_000
export const NOTIFICATION_POLL_INTERVAL_MS = 5_000
export const NOTIFICATION_SAFETY_POLL_INTERVAL_MS = 45_000

interface NotificationRuntimeConfig {
  ablyApiKey?: string
}

export interface NotificationRealtimeSignal {
  schemaVersion: 1
  kind: 'notifications.changed'
  eventId: string
  revision: number
}

export interface NotificationPublishResult {
  configured: boolean
  published: boolean
  provider: 'ably' | 'polling'
  providerMessageId: string | null
  error: string | null
}

let cachedRest: { key: string, client: Ably.Rest } | undefined

function configuredApiKey(event: H3Event): string {
  const config = useRuntimeConfig(event).notifications as NotificationRuntimeConfig
  return String(config?.ablyApiKey ?? '').trim()
}

function ablyRest(event: H3Event): Ably.Rest | null {
  const key = configuredApiKey(event)
  if (!key) return null
  if (cachedRest?.key === key) return cachedRest.client

  const client = new Ably.Rest({ key })
  cachedRest = { key, client }
  return client
}

function requiredChannelSegment(input: string, field: string): string {
  const value = input.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error(`${field} must be a UUID`)
  }
  return value
}

export function notificationRealtimeChannelName(
  organizationId: string,
  userId: string,
): string {
  const organization = requiredChannelSegment(organizationId, 'organizationId')
  const user = requiredChannelSegment(userId, 'userId')
  return `openexpert:organization:${organization}:notifications:user:${user}:v1`
}

export function notificationRealtime(
  event: H3Event,
  organizationId: string,
  userId: string,
) {
  const configured = Boolean(configuredApiKey(event))
  return {
    mode: configured ? 'ably' as const : 'polling' as const,
    channel: configured
      ? notificationRealtimeChannelName(organizationId, userId)
      : null,
    pollIntervalMs: NOTIFICATION_POLL_INTERVAL_MS,
    safetyPollIntervalMs: NOTIFICATION_SAFETY_POLL_INTERVAL_MS,
  }
}

export async function createNotificationTokenRequest(
  event: H3Event,
  organizationId: string,
  userId: string,
) {
  const rest = ablyRest(event)
  if (!rest) return null

  const channel = notificationRealtimeChannelName(organizationId, userId)
  const clientId = `staff:${requiredChannelSegment(userId, 'userId')}`
  const tokenRequest = await rest.auth.createTokenRequest({
    capability: JSON.stringify({
      [channel]: ['subscribe'],
    }),
    clientId,
    ttl: ABLY_TOKEN_TTL_MS,
  })

  return {
    tokenRequest,
    channel,
    clientId,
  }
}

function safeRevision(input: unknown): number {
  const value = typeof input === 'number' ? input : Number(input)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Notification delivery job has an invalid revision')
  }
  return value
}

export function notificationRealtimeSignal(
  eventId: string,
  revision: unknown,
): NotificationRealtimeSignal {
  const normalizedEventId = requiredChannelSegment(eventId, 'eventId')
  return {
    schemaVersion: 1,
    kind: 'notifications.changed',
    eventId: normalizedEventId,
    revision: safeRevision(revision),
  }
}

export async function publishNotificationChange(
  event: H3Event,
  input: {
    organizationId: string
    userId: string
    eventId: string
    revision: unknown
  },
): Promise<NotificationPublishResult> {
  const rest = ablyRest(event)
  if (!rest) {
    return {
      configured: false,
      published: false,
      provider: 'polling',
      providerMessageId: null,
      error: null,
    }
  }

  const signal = notificationRealtimeSignal(input.eventId, input.revision)
  try {
    const channel = notificationRealtimeChannelName(input.organizationId, input.userId)
    await rest.channels.get(channel).publish({
      id: signal.eventId,
      name: signal.kind,
      data: signal,
    })
    return {
      configured: true,
      published: true,
      provider: 'ably',
      providerMessageId: signal.eventId,
      error: null,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[crm-notifications] Ably publish failed', {
      eventId: signal.eventId,
      revision: signal.revision,
      message,
    })
    return {
      configured: true,
      published: false,
      provider: 'ably',
      providerMessageId: null,
      error: message.slice(0, 1_000),
    }
  }
}
