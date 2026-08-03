import { schedules } from '@trigger.dev/sdk'

interface NotificationOutboxDrainResponse {
  data?: {
    claimed?: number
    completed?: number
    delivered?: number
    failed?: number
  }
}

export const notificationOutbox = schedules.task({
  id: 'openexpert-notification-outbox',
  cron: '* * * * *',
  ttl: '2m',
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 15_000,
    randomize: true,
  },
  run: async () => {
    const url = process.env.OPENEXPERT_NOTIFICATION_OUTBOX_URL?.trim()
    const secret = process.env.NUXT_NOTIFICATIONS_OUTBOX_SECRET?.trim()
      || process.env.NUXT_MESSAGING_OUTBOX_SECRET?.trim()
    if (!url || !secret) {
      return { skipped: true, reason: 'notification_outbox_not_configured' as const }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 50 }),
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500)
      throw new Error(`Notification outbox drain failed (${response.status}): ${details}`)
    }

    const payload = await response.json() as NotificationOutboxDrainResponse
    return {
      skipped: false,
      claimed: Number(payload.data?.claimed ?? 0),
      completed: Number(payload.data?.completed ?? payload.data?.delivered ?? 0),
      failed: Number(payload.data?.failed ?? 0),
    }
  },
})
