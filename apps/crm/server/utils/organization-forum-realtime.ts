import * as Ably from 'ably'
import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'
import { loadOrganizationForumRealtimeSnapshot } from './organization-forum'

const ABLY_TOKEN_TTL_MS = 15 * 60 * 1_000
export const ORGANIZATION_FORUM_POLL_INTERVAL_MS = 4_000

interface ForumRealtimeRuntimeConfig {
  ablyApiKey?: string
}

export interface OrganizationForumPublishResult {
  configured: boolean
  published: boolean
  error: string | null
}

let cachedRest: { key: string, client: Ably.Rest } | undefined

function configuredApiKey(event: H3Event): string {
  const config = useRuntimeConfig(event).forumRealtime as ForumRealtimeRuntimeConfig
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

export function organizationForumRealtimeChannelName(organizationId: string): string {
  return `openexpert:organization:${organizationId}:forum:v1`
}

export function organizationForumRealtime(
  event: H3Event,
  organizationId: string,
) {
  return {
    mode: configuredApiKey(event) ? 'ably' as const : 'polling' as const,
    channel: organizationForumRealtimeChannelName(organizationId),
    pollIntervalMs: ORGANIZATION_FORUM_POLL_INTERVAL_MS,
  }
}

export async function createOrganizationForumTokenRequest(
  event: H3Event,
  organizationId: string,
  userId: string,
) {
  const rest = ablyRest(event)
  if (!rest) return null

  const channel = organizationForumRealtimeChannelName(organizationId)
  const clientId = `forum:${userId}`
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

export async function publishOrganizationForumChange(
  event: H3Event,
  dataApi: any,
  organizationId: string,
): Promise<OrganizationForumPublishResult> {
  let configured = false
  try {
    configured = Boolean(configuredApiKey(event))
    const rest = ablyRest(event)
    if (!rest) return { configured: false, published: false, error: null }

    const snapshot = await loadOrganizationForumRealtimeSnapshot(dataApi, organizationId)
    const signal = snapshot.lastEvent ?? {
      schemaVersion: 1,
      eventId: `forum-state:${organizationId}:${snapshot.revision}`,
      kind: 'forum.changed',
      organizationId,
      revision: snapshot.revision,
      occurredAt: snapshot.updatedAt ?? new Date().toISOString(),
    }

    await rest.channels
      .get(organizationForumRealtimeChannelName(organizationId))
      .publish('forum.changed', signal)

    return { configured: true, published: true, error: null }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[crm-forum] Ably publish failed', {
      organizationId,
      message,
    })
    return { configured, published: false, error: message.slice(0, 1_000) }
  }
}
