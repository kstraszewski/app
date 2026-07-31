import { serverDataBackend } from '~~/server/utils/data-api'
import { requireCrmSession, getRequiredParam, throwDbError } from '~~/server/utils/crm'
import { requireCalendarOwnerManager, type CalendarConnectionOwnerKind } from '~~/server/utils/calendar-connections'
import { uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const connectionId = uuidValue(getRequiredParam(event, 'connectionId'), 'connectionId')
  const backendData = serverDataBackend(event) as any
  const { data: connection, error } = await backendData
    .from('calendar_connections')
    .select('id, owner_kind, owner_user_id, facility_id')
    .eq('organization_id', session.organizationId)
    .eq('id', connectionId)
    .maybeSingle()
  throwDbError(error)
  if (!connection) throw createError({ statusCode: 404, statusMessage: 'Calendar connection not found' })

  const ownerKind = connection.owner_kind as CalendarConnectionOwnerKind
  const ownerId = ownerKind === 'facility' ? connection.facility_id : connection.owner_user_id
  if (!ownerId) throw createError({ statusCode: 500, statusMessage: 'Calendar connection owner is invalid' })
  await requireCalendarOwnerManager(session, ownerKind, String(ownerId))

  const result = await backendData
    .from('calendar_connections')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('id', connectionId)
  throwDbError(result.error)
  return { ok: true }
})
