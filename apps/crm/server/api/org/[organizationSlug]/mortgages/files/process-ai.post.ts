import { useRuntimeConfig } from '#imports'
import { createError, readBody } from 'h3'
import { processMortgageBankFileAiJobs } from '~~/server/utils/mortgage-bank-files-ai'
import { requireMortgageBankFileAdmin } from '~~/server/utils/mortgage-bank-files'

function requestedLimit(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 5
  const value = Number((body as Record<string, unknown>).limit)
  return Number.isFinite(value) ? Math.min(10, Math.max(1, Math.trunc(value))) : 5
}

export default defineEventHandler(async (event) => {
  const { session, serviceRole } = await requireMortgageBankFileAdmin(event)
  const runtimeConfig = useRuntimeConfig(event)
  const googleApiKey = String(runtimeConfig.googleGenerativeAiApiKey || '').trim()
  if (!googleApiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'GOOGLE_GENERATIVE_AI_API_KEY is not configured',
    })
  }

  const body = await readBody(event).catch(() => null)
  return processMortgageBankFileAiJobs({
    serviceRole,
    googleApiKey,
    actorUserId: session.userId,
    organizationId: session.organizationId,
    limit: requestedLimit(body),
  })
})
