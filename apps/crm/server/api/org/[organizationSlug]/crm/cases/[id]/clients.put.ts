import { readBody } from 'h3'
import { caseUuidPattern } from '~~/server/utils/cases'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  stringArrayValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const clientIds = [...new Set(stringArrayValue(body.client_ids))]
  if (!clientIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'A case requires at least one client' })
  }
  if (clientIds.some(clientId => !caseUuidPattern.test(clientId))) {
    throw createError({ statusCode: 400, statusMessage: 'client_ids must contain UUIDs' })
  }

  const { data, error } = await session.supabase.rpc('set_crm_case_clients', {
    p_organization_id: session.organizationId,
    p_case_id: id,
    p_client_ids: clientIds,
  })
  throwDbError(error, error?.code === '22023' ? 400 : error?.code === 'P0002' ? 404 : 500)
  return { data }
})
