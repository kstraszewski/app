import { createError } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  loadOrganizationProfiles,
  type OrganizationProfile,
} from '~~/server/utils/task-delegation'

type RecentRow = {
  assignee_user_id: string | null
  delegated_at: string | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const caseResult = await session.dataApi
    .from('crm_cases')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()
  throwDbError(caseResult.error)
  if (!caseResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const [membersResult, recentResult, openTasksResult] = await Promise.all([
    session.dataApi
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .neq('user_id', session.userId),
    session.dataApi
      .from('crm_tasks')
      .select('assignee_user_id, delegated_at')
      .eq('organization_id', session.organizationId)
      .eq('delegator_user_id', session.userId)
      .neq('delegation_status', 'not_delegated')
      .not('assignee_user_id', 'is', null)
      .order('delegated_at', { ascending: false })
      .limit(500),
    session.dataApi
      .from('crm_tasks')
      .select('assignee_user_id')
      .eq('organization_id', session.organizationId)
      .neq('delegation_status', 'not_delegated')
      .not('status_code', 'in', '(done,cancelled)')
      .not('assignee_user_id', 'is', null)
      .limit(2_000),
  ])
  throwDbError(membersResult.error)
  throwDbError(recentResult.error)
  throwDbError(openTasksResult.error)

  const memberIds: string[] = (membersResult.data ?? [])
    .map((membership: { user_id: unknown }) => String(membership.user_id))
  const [profileById, teamMembershipsResult] = await Promise.all([
    loadOrganizationProfiles(session, memberIds),
    memberIds.length
      ? session.dataApi
          .from('team_memberships')
          .select(`
            user_id,
            team:teams!team_memberships_team_fkey!inner(name, kind)
          `)
          .eq('organization_id', session.organizationId)
          .in('user_id', memberIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(teamMembershipsResult.error)
  const teamByUserId = new Map<string, { name: string; kind: string }>()
  for (const membership of (teamMembershipsResult.data ?? []) as Array<{
    user_id: string
    team: { name: string; kind: string } | Array<{ name: string; kind: string }>
  }>) {
    const team = Array.isArray(membership.team)
      ? membership.team[0]
      : membership.team
    if (!team) continue
    const userId = String(membership.user_id)
    const existing = teamByUserId.get(userId)
    if (!existing || (existing.kind !== 'team' && team.kind === 'team')) {
      teamByUserId.set(userId, team)
    }
  }
  const openTaskCountByUserId = new Map<string, number>()
  for (const task of (openTasksResult.data ?? []) as Array<{
    assignee_user_id: string | null
  }>) {
    if (!task.assignee_user_id) continue
    const userId = String(task.assignee_user_id)
    openTaskCountByUserId.set(
      userId,
      (openTaskCountByUserId.get(userId) ?? 0) + 1,
    )
  }
  const members = memberIds
    .map((userId: string) => profileById.get(userId))
    .filter((profile): profile is OrganizationProfile => Boolean(profile))
    .map(profile => ({
      ...profile,
      team_name: teamByUserId.get(profile.user_id)?.name ?? null,
      open_task_count: openTaskCountByUserId.get(profile.user_id) ?? 0,
    }))
    .sort((left: OrganizationProfile, right: OrganizationProfile) => (
      (left.full_name || left.email)
        .localeCompare(right.full_name || right.email, 'pl')
    ))

  const recentByUserId = new Map<string, {
    last_delegated_at: string
    delegation_count: number
  }>()
  for (const row of (recentResult.data ?? []) as RecentRow[]) {
    if (!row.assignee_user_id || !row.delegated_at) continue
    const userId = String(row.assignee_user_id)
    const existing = recentByUserId.get(userId)
    recentByUserId.set(userId, {
      last_delegated_at: existing?.last_delegated_at ?? row.delegated_at,
      delegation_count: (existing?.delegation_count ?? 0) + 1,
    })
  }

  const recent = [...recentByUserId.entries()].flatMap(([userId, summary]) => {
    const profile = profileById.get(userId)
    return profile
      ? [{
          ...profile,
          ...summary,
          team_name: teamByUserId.get(userId)?.name ?? null,
          open_task_count: openTaskCountByUserId.get(userId) ?? 0,
        }]
      : []
  })

  return {
    data: {
      members,
      recent,
    },
  }
})
