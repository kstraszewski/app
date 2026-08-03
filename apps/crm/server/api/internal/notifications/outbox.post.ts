import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import {
  createError,
  getHeader,
  readBody,
  setHeader,
} from 'h3'
import { asRecord } from '~~/server/utils/crm'
import { drainNotificationDeliveryJobs } from '~~/server/utils/notifications'

interface NotificationRuntimeConfig {
  outboxSecret?: string
}

function validBearerToken(actual: string, expected: string): boolean {
  const prefix = 'Bearer '
  const hasPrefix = actual.startsWith(prefix)
  const actualDigest = createHash('sha256')
    .update(hasPrefix ? actual.slice(prefix.length) : '')
    .digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest) && hasPrefix
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const notifications = useRuntimeConfig(event).notifications as NotificationRuntimeConfig
  const secret = String(notifications?.outboxSecret ?? '').trim()
  if (!secret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Notification outbox is not configured',
    })
  }
  if (!validBearerToken(String(getHeader(event, 'authorization') ?? ''), secret)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid notification outbox credential',
    })
  }

  const body = asRecord(await readBody(event))
  if (Object.keys(body).some(key => key !== 'limit')) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported outbox field' })
  }
  const limit = body.limit === undefined ? 50 : Number(body.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw createError({ statusCode: 400, statusMessage: 'limit must be between 1 and 100' })
  }

  const result = await drainNotificationDeliveryJobs(
    event,
    `crm-notifications:${randomUUID()}`,
    limit,
  )
  return { data: result }
})
