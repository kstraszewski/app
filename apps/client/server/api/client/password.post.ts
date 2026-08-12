import { getOpenExpertPasswordIssue } from '@openexpert/auth'
import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, readBody, setHeader } from 'h3'
import { serverAuth } from '~~/server/utils/platform-auth'
import {
  asRecord,
  requireLinkedClientPortalSession,
} from '~~/server/utils/portal-auth'

function errorStatus(error: unknown): number {
  const candidate = error as { status?: unknown, statusCode?: unknown } | null
  const value = Number(candidate?.statusCode ?? candidate?.status)
  return Number.isInteger(value) ? value : 0
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const session = await requireLinkedClientPortalSession(event)
  const body = asRecord(await readBody(event))
  const password = typeof body.password === 'string' ? body.password : ''
  const passwordIssue = getOpenExpertPasswordIssue(password)
  if (passwordIssue) {
    throw createError({
      statusCode: 400,
      statusMessage: passwordIssue,
      data: { code: 'PASSWORD_POLICY_VIOLATION' },
    })
  }

  const existing = await runtime.pool.query(
    `select 1
       from ${runtime.config.databaseSchema}.accounts
      where user_id = $1
        and provider_id = 'credential'
        and password is not null
      limit 1`,
    [session.identity.userId],
  )
  if (existing.rowCount) {
    throw createError({ statusCode: 409, statusMessage: 'Password is already set' })
  }

  try {
    await runtime.auth.api.setPassword({
      body: { newPassword: password },
      headers: event.headers,
    })
  }
  catch (error) {
    const status = errorStatus(error)
    if (status === 401 || status === 403) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Fresh authentication required',
      })
    }
    if (status === 400) {
      throw createError({ statusCode: 409, statusMessage: 'Password is already set' })
    }
    throw error
  }

  return { status: true }
})
