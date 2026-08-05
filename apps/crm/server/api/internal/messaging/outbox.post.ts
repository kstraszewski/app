import { randomUUID, timingSafeEqual } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import {
  createError,
  getHeader,
  readBody,
  setHeader,
} from 'h3'
import { drainCaseMessageOutbox } from '~~/server/utils/case-conversations'
import { cleanupExpiredMessageAttachments } from '~~/server/utils/case-message-attachments'
import { asRecord } from '~~/server/utils/crm'

interface MessagingRuntimeConfig {
  outboxSecret?: string
}

function validBearerToken(actual: string, expected: string): boolean {
  const prefix = 'Bearer '
  if (!actual.startsWith(prefix)) return false
  const actualBuffer = Buffer.from(actual.slice(prefix.length), 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const messaging = useRuntimeConfig(event).messaging as MessagingRuntimeConfig
  const secret = String(messaging?.outboxSecret ?? '').trim()
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Messaging outbox is not configured' })
  }
  if (!validBearerToken(String(getHeader(event, 'authorization') ?? ''), secret)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid messaging outbox credential' })
  }
  const body = asRecord(await readBody(event))
  if (Object.keys(body).some(key => key !== 'limit')) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported outbox field' })
  }
  const limit = body.limit === undefined ? 50 : Number(body.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw createError({ statusCode: 400, statusMessage: 'limit must be between 1 and 100' })
  }

  const workerNonce = randomUUID()
  const [result, attachmentCleanup] = await Promise.all([
    drainCaseMessageOutbox(
      event,
      `crm:${workerNonce}`,
      limit,
    ),
    cleanupExpiredMessageAttachments(
      event,
      `crm-attachments:${workerNonce}`,
      limit,
    ).catch((error) => {
      console.warn('[crm-messaging] attachment cleanup failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return { claimed: 0, deleted: 0, failed: 1 }
    }),
  ])
  return { data: { ...result, attachmentCleanup } }
})
