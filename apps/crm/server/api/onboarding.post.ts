import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, readBody, setHeader } from 'h3'
import { asRecord, requireAuthIdentity, throwDbError } from '~~/server/utils/crm'
import { serverDataBackend } from '~~/server/utils/data-api'
import { serverAuth } from '~~/server/utils/platform-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const identity = await requireAuthIdentity(event)
  const body = asRecord(await readBody(event))
  const organizationName = typeof body.organizationName === 'string'
    ? body.organizationName.trim()
    : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null
  const organizationKind = body.organizationKind ?? 'intermediary'
  if (!organizationName || organizationName.length > 160) {
    throw createError({ statusCode: 400, statusMessage: 'Organization name is required' })
  }
  if (fullName && fullName.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'Full name is too long' })
  }
  if (organizationKind !== 'intermediary') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Application organizations must use the registration flow',
    })
  }

  const backend = serverDataBackend(event) as any
  const { data, error } = await backend.rpc(
    'create_intermediary_organization_for_existing_identity_v1',
    {
      p_actor_user_id: identity.userId,
      p_organization_name: organizationName,
      p_full_name: fullName || null,
    },
  )
  throwDbError(error)
  return data as {
    id: string
    name: string
    slug: string
    kind: 'intermediary'
    billingAccessState: string
    role: string
    isDefault: boolean
  }
})
