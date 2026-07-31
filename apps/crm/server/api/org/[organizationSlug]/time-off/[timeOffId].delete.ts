import { serverDataBackend } from '~~/server/utils/data-api'
import { setHeader } from 'h3'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'
import { throwTimeOffDbError } from '~~/server/utils/time-off'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const timeOffId = uuidValue(getRequiredParam(event, 'timeOffId'), 'timeOffId')
  const backendData = serverDataBackend(event) as any
  const { data: timeOff, error: loadError } = await backendData
    .from('expert_time_off')
    .select('id, expert_user_id')
    .eq('organization_id', session.organizationId)
    .eq('id', timeOffId)
    .eq('status', 'active')
    .maybeSingle()
  throwTimeOffDbError(loadError)
  if (!timeOff) {
    throw createError({ statusCode: 404, statusMessage: 'Time off not found' })
  }
  if (String(timeOff.expert_user_id) !== session.userId && session.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an organization administrator can cancel another expert’s time off',
    })
  }

  const { data: cancelled, error } = await backendData
    .from('expert_time_off')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('organization_id', session.organizationId)
    .eq('id', timeOffId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle()
  throwTimeOffDbError(error)
  if (!cancelled) {
    throw createError({ statusCode: 404, statusMessage: 'Time off not found' })
  }
  setHeader(event, 'Cache-Control', 'private, no-store')

  return { ok: true }
})
