import { schedules } from '@trigger.dev/sdk'

interface OutboxDrainResponse {
  data?: {
    claimed?: number
    delivered?: number
    failed?: number
  }
}

/**
 * Replays durable message events that could not be published during the
 * request that committed the message. Neon remains the source of truth; this
 * task only nudges connected clients to refetch.
 */
export const caseMessageOutbox = schedules.task({
  id: 'openexpert-case-message-outbox',
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
    const url = process.env.OPENEXPERT_MESSAGING_OUTBOX_URL?.trim()
    const secret = process.env.NUXT_MESSAGING_OUTBOX_SECRET?.trim()
    if (!url || !secret) {
      return { skipped: true, reason: 'messaging_outbox_not_configured' as const }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 50 }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500)
      throw new Error(`Message outbox drain failed (${response.status}): ${details}`)
    }

    const payload = await response.json() as OutboxDrainResponse
    return {
      skipped: false,
      claimed: Number(payload.data?.claimed ?? 0),
      delivered: Number(payload.data?.delivered ?? 0),
      failed: Number(payload.data?.failed ?? 0),
    }
  },
})
