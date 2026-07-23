import { serverSupabaseServiceRole } from '#supabase/server'
import { requireCrmSession } from '~~/server/utils/crm'

const assistantPathPattern = /^eve\/v1\/(?:health|info|session(?:\/[^/]+(?:\/(?:stream|cancel))?)?)$/
const sessionPathPattern = /^eve\/v1\/session\/([^/]+)/

function responsePayload(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}

function copyResponseHeaders(event: any, response: Response) {
  for (const name of ['cache-control', 'content-type', 'x-eve-session-id']) {
    const value = response.headers.get(name)
    if (value) setHeader(event, name, value)
  }
}

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') ?? ''
  if (!assistantPathPattern.test(path)) {
    throw createError({ statusCode: 404, statusMessage: 'Assistant route not found' })
  }

  const organizationSlug = getHeader(event, 'x-openexpert-organization')?.trim() ?? ''
  const session = await requireCrmSession(event, organizationSlug)
  const matchedSessionId = path.match(sessionPathPattern)?.[1]
  let sessionId: string | null = null
  if (matchedSessionId) {
    try {
      sessionId = decodeURIComponent(matchedSessionId)
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: 'Invalid assistant session identifier' })
    }
  }

  if (sessionId) {
    const { data: ownedSession, error: ownershipError } = await session.supabase
      .from('crm_eve_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .maybeSingle()
    if (ownershipError || !ownedSession) {
      throw createError({ statusCode: 403, statusMessage: 'Assistant session is unavailable' })
    }
  }

  const method = getMethod(event)
  const requestUrl = getRequestURL(event)
  const targetUrl = new URL(`/${path}${requestUrl.search}`, requestUrl.origin)
  const headers = new Headers({
    accept: getHeader(event, 'accept') ?? '*/*',
    authorization: getHeader(event, 'authorization') ?? '',
    'content-type': getHeader(event, 'content-type') ?? 'application/json',
    'x-openexpert-organization': session.organizationSlug,
  })
  const lastEventId = getHeader(event, 'last-event-id')
  if (lastEventId) headers.set('last-event-id', lastEventId)

  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readRawBody(event)
  const response = await fetch(targetUrl, { method, headers, body })
  setResponseStatus(event, response.status, response.statusText)
  copyResponseHeaders(event, response)

  if (path === 'eve/v1/session' && method === 'POST') {
    const text = await response.text()
    const payload = responsePayload(text) as { sessionId?: unknown }
    if (response.ok && typeof payload === 'object' && payload && typeof payload.sessionId === 'string') {
      const serviceRole = serverSupabaseServiceRole(event) as any
      const { error } = await serviceRole.from('crm_eve_sessions').upsert({
        session_id: payload.sessionId,
        organization_id: session.organizationId,
        user_id: session.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'session_id' })
      if (error) {
        throw createError({ statusCode: 500, statusMessage: 'Could not register assistant session' })
      }
    }
    return payload
  }

  if (response.body && response.headers.get('content-type')?.includes('application/x-ndjson')) {
    return sendStream(event, response.body)
  }

  return responsePayload(await response.text())
})
