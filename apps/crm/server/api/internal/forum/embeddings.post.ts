import { randomUUID, timingSafeEqual } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import {
  createError,
  getHeader,
  readBody,
  setHeader,
} from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import { processOrganizationForumEmbeddingJobs } from '~~/server/utils/organization-forum'
import { asRecord } from '~~/server/utils/crm'

interface InternalWorkerRuntimeConfig {
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
  const config = useRuntimeConfig(event)
  const workerConfig = config.messaging as InternalWorkerRuntimeConfig
  const secret = String(workerConfig?.outboxSecret ?? '').trim()
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Internal forum worker is not configured' })
  }
  if (!validBearerToken(String(getHeader(event, 'authorization') ?? ''), secret)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid internal forum worker credential' })
  }

  const googleApiKey = String(config.googleGenerativeAiApiKey || '').trim()
  if (!googleApiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'GOOGLE_GENERATIVE_AI_API_KEY is not configured',
    })
  }

  const body = asRecord(await readBody(event).catch(() => null))
  if (Object.keys(body).some(key => key !== 'limit')) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported forum worker field' })
  }
  const limit = body.limit === undefined ? 20 : Number(body.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40) {
    throw createError({ statusCode: 400, statusMessage: 'limit must be between 1 and 40' })
  }

  const result = await processOrganizationForumEmbeddingJobs({
    backendData: serverDataBackend(event),
    googleApiKey,
    workerId: `forum:${randomUUID()}`,
    limit,
  })
  return { data: result }
})
