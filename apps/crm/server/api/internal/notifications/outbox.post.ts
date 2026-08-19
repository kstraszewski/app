import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import {
  createError,
  getHeader,
  readBody,
  setHeader,
} from 'h3'
import { asRecord } from '~~/server/utils/crm'
import { drainClientLegalDocumentDeliveries } from '~~/server/utils/client-legal-document-deliveries'
import { drainCrmDocumentStorageCleanups } from '~~/server/utils/crm-document-storage-cleanup'
import { drainNotificationDeliveryJobs } from '~~/server/utils/notifications'
import { cleanupOpenExpertMockBankPayloads } from '~~/server/utils/openexpert-mock-bank-cleanup'

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

  const runId = randomUUID()
  const [
    notificationResult,
    legalDocumentResult,
    documentStorageResult,
    mockBankPayloadResult,
  ] = await Promise.all([
    drainNotificationDeliveryJobs(
      event,
      `crm-notifications:${runId}`,
      limit,
    ),
    drainClientLegalDocumentDeliveries(
      event,
      `crm-client-legal-documents:${runId}`,
      Math.min(limit, 10),
    ),
    drainCrmDocumentStorageCleanups(
      event,
      `crm-document-storage:${runId}`,
      Math.min(limit, 25),
    ),
    cleanupOpenExpertMockBankPayloads(event, { limit: Math.min(limit, 20) }),
  ])
  return {
    data: {
      claimed: notificationResult.claimed
        + legalDocumentResult.claimed
        + documentStorageResult.claimed
        + mockBankPayloadResult.claimed,
      completed: notificationResult.completed
        + legalDocumentResult.completed
        + documentStorageResult.completed
        + documentStorageResult.retained
        + mockBankPayloadResult.completed,
      delivered: notificationResult.delivered + legalDocumentResult.delivered,
      failed: notificationResult.failed
        + legalDocumentResult.failed
        + documentStorageResult.failed
        + mockBankPayloadResult.failed,
      blocked: legalDocumentResult.blocked,
      notifications: notificationResult,
      legalDocuments: legalDocumentResult,
      documentStorage: documentStorageResult,
      mockBankPayloads: mockBankPayloadResult,
    },
  }
})
