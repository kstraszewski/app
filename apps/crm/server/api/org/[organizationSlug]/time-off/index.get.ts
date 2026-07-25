import { serverSupabaseServiceRole } from '#supabase/server'
import { getQuery, setHeader } from 'h3'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  assertOrganizationMemberIds,
  isoDateTimeValue,
  optionalUuidValue,
} from '~~/server/utils/scheduling'
import {
  expertTimeOffPayload,
  expertTimeOffSelect,
  throwTimeOffDbError,
} from '~~/server/utils/time-off'

const maximumRangeMilliseconds = 366 * 24 * 60 * 60 * 1_000

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const query = getQuery(event)
  const expertUserId = optionalUuidValue(
    query.expertUserId ?? query.expert_user_id,
    'expertUserId',
  )
  if (expertUserId) {
    await assertOrganizationMemberIds(session, [expertUserId])
  }

  const defaultFrom = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
  const defaultBefore = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString()
  const startsFrom = query.startsFrom === undefined && query.starts_from === undefined
    ? defaultFrom
    : isoDateTimeValue(query.startsFrom ?? query.starts_from, 'startsFrom')
  const startsBefore = query.startsBefore === undefined && query.starts_before === undefined
    ? defaultBefore
    : isoDateTimeValue(query.startsBefore ?? query.starts_before, 'startsBefore')
  const startsFromTime = new Date(startsFrom).valueOf()
  const startsBeforeTime = new Date(startsBefore).valueOf()
  if (startsFromTime >= startsBeforeTime) {
    throw createError({
      statusCode: 400,
      statusMessage: 'startsBefore must be after startsFrom',
    })
  }
  if (startsBeforeTime - startsFromTime > maximumRangeMilliseconds) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Time-off range must not exceed 366 days',
    })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  let request = serviceRole
    .from('expert_time_off')
    .select(expertTimeOffSelect)
    .eq('organization_id', session.organizationId)
    .eq('status', 'active')
    .lt('starts_at', startsBefore)
    .gt('ends_at', startsFrom)
    .order('starts_at')
    .order('id')
  if (expertUserId) {
    request = request.eq('expert_user_id', expertUserId)
  }

  const { data, error } = await request
  throwTimeOffDbError(error)
  setHeader(event, 'Cache-Control', 'private, no-store')

  return {
    data: (data ?? []).map((row: Record<string, any>) => {
      const canManage = session.role === 'admin'
        || String(row.expert_user_id) === session.userId
      return {
        ...expertTimeOffPayload(row, { includeNotes: canManage }),
        canManage,
      }
    }),
  }
})
