import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'

interface NotificationOutboxRuntimeConfig {
  outboxUrl?: string
  outboxSecret?: string
}

/**
 * Wake the CRM notification outbox after a portal-side commit. Delivery stays
 * durable in PostgreSQL; a failed wake only delays the invalidation until the
 * scheduled worker or client safety poll catches up.
 */
export async function nudgeNotificationOutbox(event: H3Event): Promise<void> {
  const notifications = useRuntimeConfig(event).notifications as NotificationOutboxRuntimeConfig
  const url = String(notifications?.outboxUrl ?? '').trim()
  const secret = String(notifications?.outboxSecret ?? '').trim()
  if (!url || !secret) return

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 10 }),
      redirect: 'error',
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) {
      console.warn('[client-notifications] notification outbox nudge failed', {
        status: response.status,
      })
    }
  }
  catch (error) {
    console.warn('[client-notifications] notification outbox nudge failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
