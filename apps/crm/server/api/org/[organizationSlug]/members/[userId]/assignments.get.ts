import { createError, setHeader } from 'h3'
import {
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

type TeamRow = {
  id: string
  organization_id: string
  name: string
  slug: string
  kind: 'team' | 'department' | 'division' | 'other'
  description: string | null
  created_at: string
  updated_at: string
}

type TeamMembershipRow = {
  organization_id: string
  team_id: string
  user_id: string
  role: 'member' | 'admin'
  created_at: string
  updated_at: string
}

type FacilityRow = {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  timezone: string
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  city: string | null
  country_code: string
  phone: string | null
  email: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type FacilityMembershipRow = {
  organization_id: string
  facility_id: string
  user_id: string
  role: 'member' | 'admin'
  is_bookable: boolean
  booking_priority: number
  last_assigned_at: string | null
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(session, 'iam.members.read')
  const userId = uuidValue(getRequiredParam(event, 'userId'), 'userId')
  setHeader(event, 'Cache-Control', 'private, no-store')

  const targetMembershipResult = await session.dataApi
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', session.organizationId)
    .eq('user_id', userId)
    .maybeSingle()
  throwDbError(targetMembershipResult.error)
  if (!targetMembershipResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Organization member not found' })
  }

  const [teamsResult, teamMembershipsResult, facilitiesResult, facilityMembershipsResult] = await Promise.all([
    session.dataApi
      .from('teams')
      .select('id, organization_id, name, slug, kind, description, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .order('name'),
    session.dataApi
      .from('team_memberships')
      .select('organization_id, team_id, user_id, role, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .eq('user_id', userId),
    session.dataApi
      .from('facilities')
      .select('id, organization_id, name, slug, description, timezone, address_line1, address_line2, postal_code, city, country_code, phone, email, is_active, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .order('is_active', { ascending: false })
      .order('name'),
    session.dataApi
      .from('facility_memberships')
      .select('organization_id, facility_id, user_id, role, is_bookable, booking_priority, last_assigned_at, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .eq('user_id', userId),
  ])

  throwDbError(teamsResult.error)
  throwDbError(teamMembershipsResult.error)
  throwDbError(facilitiesResult.error)
  throwDbError(facilityMembershipsResult.error)

  const teams = (teamsResult.data ?? []) as TeamRow[]
  const teamMemberships = (teamMembershipsResult.data ?? []) as TeamMembershipRow[]
  const teamById = new Map(teams.map(team => [team.id, team]))
  const facilities = (facilitiesResult.data ?? []) as FacilityRow[]
  const facilityMemberships = (facilityMembershipsResult.data ?? []) as FacilityMembershipRow[]
  const facilityById = new Map(facilities.map(facility => [facility.id, facility]))

  return {
    data: {
      teams: teamMemberships.flatMap((membership) => {
        const team = teamById.get(membership.team_id)
        return team ? [{ team, membership }] : []
      }).sort((left, right) => left.team.name.localeCompare(right.team.name, 'pl')),
      facilities: facilityMemberships.flatMap((membership) => {
        const facility = facilityById.get(membership.facility_id)
        return facility ? [{ facility, membership }] : []
      }).sort((left, right) => left.facility.name.localeCompare(right.facility.name, 'pl')),
    },
    catalog: {
      teams,
      facilities,
    },
  }
})
