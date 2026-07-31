import { createError, getQuery } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  requireTeamView,
  throwDbError,
} from '~~/server/utils/crm'
import {
  buildSalesPayload,
  resolveTeamSalesOwnerUserIds,
} from '~~/server/utils/sales'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = getRequiredParam(event, 'teamId')
  const query = getQuery(event)

  const teamResult = await session.dataApi
    .from('teams')
    .select('id, name')
    .eq('organization_id', session.organizationId)
    .eq('id', teamId)
    .maybeSingle()

  throwDbError(teamResult.error)
  if (!teamResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  }

  await requireTeamView(session, teamId)
  const ownerUserIds = await resolveTeamSalesOwnerUserIds(session, teamId)

  return buildSalesPayload(session, ownerUserIds, {
    range: query.range,
    currency: query.currency,
    scope: {
      type: 'team',
      id: teamId,
      label: String(teamResult.data.name),
      memberCount: ownerUserIds.length,
    },
  })
})
