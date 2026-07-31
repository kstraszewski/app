import { serverDataBackend } from '~~/server/utils/data-api'
import { readBody, setHeader, setResponseStatus } from 'h3'
import { asRecord, requireCrmSession } from '~~/server/utils/crm'
import {
  assertOrganizationMemberIds,
  booleanValue,
  dateValue,
  limitedText,
  timezoneValue,
  uuidValue,
} from '~~/server/utils/scheduling'
import {
  expertTimeOffPayload,
  expertTimeOffSelect,
  throwTimeOffDbError,
} from '~~/server/utils/time-off'
import {
  addDaysToDateKey,
  startOfDateInTimezone,
} from '#shared/utils/zoned-date'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const expertUserId = uuidValue(
    body.expertUserId ?? body.expert_user_id ?? session.userId,
    'expertUserId',
  )
  if (expertUserId !== session.userId && session.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only an organization administrator can add time off for another expert',
    })
  }
  await assertOrganizationMemberIds(session, [expertUserId])

  const startsOn = dateValue(body.startsOn ?? body.starts_on, 'startsOn')
  const endsOn = dateValue(body.endsOn ?? body.ends_on, 'endsOn')
  if (startsOn > endsOn) {
    throw createError({
      statusCode: 400,
      statusMessage: 'endsOn must be on or after startsOn',
    })
  }

  const timezone = timezoneValue(body.timezone)
  const allDay = body.allDay === undefined && body.all_day === undefined
    ? true
    : booleanValue(body.allDay ?? body.all_day, 'allDay')
  if (!allDay) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Vacation must be an all-day calendar entry',
    })
  }
  let startsAt: string
  let endsAt: string
  try {
    startsAt = startOfDateInTimezone(startsOn, timezone)
    endsAt = startOfDateInTimezone(addDaysToDateKey(endsOn, 1), timezone)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Vacation dates are not valid in the selected timezone',
    })
  }
  const notes = limitedText(body.notes, 'notes', 2_000, { nullable: true }) ?? null

  const backendData = serverDataBackend(event) as any
  const { data, error } = await backendData
    .from('expert_time_off')
    .insert({
      organization_id: session.organizationId,
      expert_user_id: expertUserId,
      kind: 'vacation',
      starts_at: startsAt,
      ends_at: endsAt,
      timezone,
      all_day: allDay,
      status: 'active',
      notes,
      created_by_user_id: session.userId,
    })
    .select(expertTimeOffSelect)
    .single()
  throwTimeOffDbError(error)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setResponseStatus(event, 201)

  return {
    timeOff: {
      ...expertTimeOffPayload(data),
      canManage: true,
    },
  }
})
