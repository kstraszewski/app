import { createError, readBody, setHeader } from 'h3'
import { asRecord, requireAuthIdentity, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const identity = await requireAuthIdentity(event)
  const body = asRecord(await readBody(event))
  const organizationName = typeof body.organizationName === 'string'
    ? body.organizationName.trim()
    : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null
  if (!organizationName || organizationName.length > 160) {
    throw createError({ statusCode: 400, statusMessage: 'Organization name is required' })
  }

  const { data, error } = await identity.dataApi.rpc('create_organization_with_admin', {
    organization_name: organizationName,
    full_name: fullName || null,
  })
  throwDbError(error)
  return data as { id: string, name: string, slug: string, role: string }
})
