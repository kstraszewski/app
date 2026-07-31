import { createError, type H3Event } from 'h3'
import { serverAuthClaims, type PlatformAuthClaims } from './platform-auth'
import {
  serverBackendDataClient,
  serverUserDataClient,
  type OpenExpertDataClient,
} from './platform-data'

interface DataApiEventContext {
  _openexpertDataClient?: OpenExpertDataClient
  _openexpertBackendDataClient?: OpenExpertDataClient
  _openexpertAuthClaims?: PlatformAuthClaims | null
}

function context(event: H3Event): DataApiEventContext {
  return event.context as DataApiEventContext
}

export async function serverDataUser(event: H3Event): Promise<PlatformAuthClaims | null> {
  const requestContext = context(event)
  if (requestContext._openexpertAuthClaims !== undefined) {
    return requestContext._openexpertAuthClaims
  }
  const claims = await serverAuthClaims(event)
  requestContext._openexpertAuthClaims = claims
  return claims
}

export async function serverDataClient(event: H3Event): Promise<OpenExpertDataClient> {
  const requestContext = context(event)
  if (requestContext._openexpertDataClient) return requestContext._openexpertDataClient

  const claims = await serverDataUser(event)
  if (!claims?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  const client = serverUserDataClient(event, claims.sub)
  requestContext._openexpertDataClient = client
  return client
}

export function serverDataBackend(event: H3Event): OpenExpertDataClient {
  const requestContext = context(event)
  if (requestContext._openexpertBackendDataClient) {
    return requestContext._openexpertBackendDataClient
  }
  const client = serverBackendDataClient(event)
  requestContext._openexpertBackendDataClient = client
  return client
}
