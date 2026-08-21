import { serverDataBackend, serverDataClient, serverDataUser } from '~~/server/utils/data-api'
import { useRuntimeConfig } from '#imports'
import { createError, getRouterParam, type H3Event } from 'h3'
import { expandManagedTeamIds, type TeamScopeEdge } from './team-scope'
import {
  BILLING_ACCESS_STATES,
  isBillingAccessGranted,
  type BillingAccessState,
  type OrganizationKind,
} from '~~/shared/organization-billing'

type CrmDataClient = any

export interface AuthIdentity {
  dataApi: CrmDataClient
  userId: string
  email: string
  emailVerified: boolean
  emailConfirmedAt: string | null
  phone: string
  fullName: string
}

export interface AuthenticatedSession extends AuthIdentity {
  defaultOrganizationId: string
}

export interface CrmSession extends AuthenticatedSession {
  organizationId: string
  organizationName: string
  organizationSlug: string
  organizationKind: OrganizationKind
  billingAccessState: BillingAccessState
  role: string
}

export interface RequireCrmSessionOptions {
  allowUnsubscribed?: boolean
}

export interface TeamAdminScope {
  organizationAdmin: boolean
  directAdminTeamIds: string[]
  managedTeamIds: string[]
}

export async function requireAuthIdentity(event: H3Event): Promise<AuthIdentity> {
  const dataApiConfig = useRuntimeConfig(event).dataApi as { url?: string }
  if (!dataApiConfig.url) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Data API is not configured',
    })
  }

  const claims = await serverDataUser(event)
  const userId = typeof claims?.sub === 'string' ? claims.sub : null
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const dataApi = await serverDataClient(event) as CrmDataClient
  const { data: profile, error: profileError } = await dataApi
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle()

  throwDbError(profileError)

  const claimRecord = asRecord(claims)
  const metadata = asRecord(claimRecord.user_metadata)

  return {
    dataApi,
    userId,
    email: textValue(claimRecord.email) ?? '',
    emailVerified: claimRecord.email_verified === true,
    emailConfirmedAt: textValue(claimRecord.email_confirmed_at) ?? null,
    phone: textValue(claimRecord.phone) ?? '',
    fullName: textValue(profile?.display_name)
      ?? textValue(metadata.full_name)
      ?? '',
  }
}

export async function requireAuthenticatedSession(event: H3Event): Promise<AuthenticatedSession> {
  const identity = await requireAuthIdentity(event)
  const { data: profile, error } = await identity.dataApi
    .from('users')
    .select('id, organization_id, email, full_name')
    .eq('id', identity.userId)
    .single()

  if (error || !profile?.organization_id) {
    throw createError({
      statusCode: 403,
      statusMessage: 'CRM profile is missing for the authenticated user',
    })
  }

  return {
    ...identity,
    email: String(profile.email ?? identity.email),
    fullName: String(profile.full_name ?? identity.fullName),
    defaultOrganizationId: String(profile.organization_id),
  }
}

export async function requireCrmSession(
  event: H3Event,
  requestedOrganizationSlug?: string,
  options: RequireCrmSessionOptions = {},
): Promise<CrmSession> {
  const authenticated = await requireAuthenticatedSession(event)
  const organizationSlug = requestedOrganizationSlug ?? getRequiredParam(event, 'organizationSlug')

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
    throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
  }

  const { data: organization, error: organizationError } = await authenticated.dataApi
    .from('organizations')
    .select('id, name, slug, kind, billing_access_state')
    .eq('slug', organizationSlug)
    .maybeSingle()

  if (organizationError || !organization) {
    throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
  }

  const { data: membership, error: membershipError } = await authenticated.dataApi
    .from('organization_memberships')
    .select('role')
    .eq('organization_id', organization.id)
    .eq('user_id', authenticated.userId)
    .maybeSingle()

  if (membershipError || !membership) {
    throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
  }

  const organizationKind = String(organization.kind || 'intermediary') as OrganizationKind
  let billingAccessState = String(
    organization.billing_access_state || 'not_required',
  ) as BillingAccessState
  if (organizationKind === 'application') {
    const backend = serverDataBackend(event) as CrmDataClient
    const accessResult = await (backend as any).rpc('get_organization_billing_access_v1', {
      p_organization_id: organization.id,
    })
    throwDbError(accessResult.error)
    const projectedState = String(accessResult.data?.billingAccessState || '')
    if (!(BILLING_ACCESS_STATES as readonly string[]).includes(projectedState)) {
      throw createError({ statusCode: 500, statusMessage: 'Billing access projection is invalid' })
    }
    billingAccessState = projectedState as BillingAccessState
  }
  if (
    organizationKind === 'application'
    && !options.allowUnsubscribed
    && !isBillingAccessGranted(billingAccessState)
  ) {
    throw createError({
      statusCode: 402,
      statusMessage: 'Application subscription required',
      data: {
        code: 'SUBSCRIPTION_REQUIRED',
        organizationSlug: String(organization.slug),
        billingAccessState,
      },
    })
  }

  return {
    ...authenticated,
    organizationId: String(organization.id),
    organizationName: String(organization.name),
    organizationSlug: String(organization.slug),
    organizationKind,
    billingAccessState,
    role: String(membership.role ?? 'expert'),
  }
}

export function requireOrganizationAdmin(session: CrmSession): void {
  if (session.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Organization admin required' })
  }
}

export async function hasAdministrativePermission(
  session: CrmSession,
  permissionKey: string,
): Promise<boolean> {
  const now = new Date().toISOString()
  const [rolePermissionsResult, directGrantResult] = await Promise.all([
    session.dataApi
      .from('administrative_role_permissions')
      .select('role_key')
      .eq('permission_key', permissionKey),
    session.dataApi
      .from('organization_user_direct_grants')
      .select('id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .eq('permission_key', permissionKey)
      .eq('status', 'active')
      .lte('valid_from', now)
      .gt('expires_at', now)
      .limit(1)
      .maybeSingle(),
  ])

  throwDbError(rolePermissionsResult.error)
  throwDbError(directGrantResult.error)

  if (directGrantResult.data) return true

  const permittedRoleKeys = Array.from(new Set<string>(
    ((rolePermissionsResult.data ?? []) as Array<{ role_key: unknown }>)
      .map(row => String(row.role_key)),
  ))
  if (
    session.role === 'admin'
    && permittedRoleKeys.includes('organization_admin')
  ) {
    return true
  }

  const directRoleKeys = permittedRoleKeys.filter(roleKey => roleKey !== 'organization_admin')
  if (!directRoleKeys.length) return false

  const roleAssignmentResult = await session.dataApi
    .from('organization_user_admin_roles')
    .select('role_key')
    .eq('organization_id', session.organizationId)
    .eq('user_id', session.userId)
    .in('role_key', directRoleKeys)
    .limit(1)
    .maybeSingle()

  throwDbError(roleAssignmentResult.error)
  return Boolean(roleAssignmentResult.data)
}

export async function requireAdministrativePermission(
  session: CrmSession,
  permissionKey: string,
): Promise<void> {
  if (!await hasAdministrativePermission(session, permissionKey)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Administrative permission required: ${permissionKey}`,
    })
  }
}

export async function requireOrganizationMember(
  session: CrmSession,
  userId: string,
): Promise<void> {
  const { data, error } = await session.dataApi
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', session.organizationId)
    .eq('user_id', userId)
    .maybeSingle()

  throwDbError(error)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Organization member not found' })
  }
}

export async function resolveTeamAdminScope(session: CrmSession): Promise<TeamAdminScope> {
  const [directMembershipsResult, canManageStructure] = await Promise.all([
    session.dataApi
      .from('team_memberships')
      .select('team_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .eq('role', 'admin'),
    hasAdministrativePermission(session, 'structure.manage'),
  ])
  throwDbError(directMembershipsResult.error)

  const directAdminTeamIds: string[] = Array.from(new Set<string>(
    ((directMembershipsResult.data ?? []) as Array<{ team_id: unknown }>)
      .map(membership => String(membership.team_id)),
  )).sort()

  if (canManageStructure) {
    const teamsResult = await session.dataApi
      .from('teams')
      .select('id')
      .eq('organization_id', session.organizationId)
    throwDbError(teamsResult.error)

    return {
      organizationAdmin: true,
      directAdminTeamIds,
      managedTeamIds: (teamsResult.data ?? [])
        .map((team: { id: unknown }) => String(team.id))
        .sort(),
    }
  }

  if (!directAdminTeamIds.length) {
    return {
      organizationAdmin: false,
      directAdminTeamIds: [],
      managedTeamIds: [],
    }
  }

  const edgesResult = await session.dataApi
    .from('team_edges')
    .select('parent_team_id, child_team_id')
    .eq('organization_id', session.organizationId)
  throwDbError(edgesResult.error)

  const edges = (edgesResult.data ?? []).map((edge: Record<string, unknown>): TeamScopeEdge => ({
    parent_team_id: String(edge.parent_team_id),
    child_team_id: String(edge.child_team_id),
  }))

  return {
    organizationAdmin: false,
    directAdminTeamIds,
    managedTeamIds: expandManagedTeamIds(directAdminTeamIds, edges).sort(),
  }
}

export async function requireTeamAdmin(
  session: CrmSession,
  teamId: string,
): Promise<TeamAdminScope> {
  const scope = await resolveTeamAdminScope(session)
  if (!scope.organizationAdmin && !scope.directAdminTeamIds.includes(teamId)) {
    throw createError({ statusCode: 403, statusMessage: 'Team admin required' })
  }
  return scope
}

export async function requireTeamView(
  session: CrmSession,
  teamId: string,
): Promise<TeamAdminScope> {
  const scope = await resolveTeamAdminScope(session)
  if (!scope.managedTeamIds.includes(teamId)) {
    throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  }
  return scope
}

export async function requireFacilityAdminMembership(
  session: CrmSession,
  facilityId: string,
): Promise<void> {
  if (await hasAdministrativePermission(session, 'structure.manage')) return

  const { data, error } = await session.dataApi
    .from('facility_memberships')
    .select('facility_id')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
    .eq('user_id', session.userId)
    .eq('role', 'admin')
    .maybeSingle()
  throwDbError(error)

  if (!data) {
    throw createError({ statusCode: 403, statusMessage: 'Facility admin membership required' })
  }
}

export async function requireSafeTeamAdminRemoval(
  session: CrmSession,
  teamId: string,
  userId: string,
): Promise<{ role: string }> {
  const scope = await requireTeamAdmin(session, teamId)

  const membershipResult = await session.dataApi
    .from('team_memberships')
    .select('role')
    .eq('organization_id', session.organizationId)
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle()
  throwDbError(membershipResult.error)

  if (!membershipResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Team membership not found' })
  }

  const role = String(membershipResult.data.role ?? 'member')
  if (!scope.organizationAdmin && role === 'admin') {
    const adminCountResult = await session.dataApi
      .from('team_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', session.organizationId)
      .eq('team_id', teamId)
      .eq('role', 'admin')
    throwDbError(adminCountResult.error)

    if ((adminCountResult.count ?? 0) <= 1) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Team must keep at least one direct administrator',
      })
    }
  }

  return { role }
}

export async function hasSuperAdminRole(session: AuthenticatedSession): Promise<boolean> {
  const { data, error } = await session.dataApi
    .from('platform_user_roles')
    .select('user_id')
    .eq('user_id', session.userId)
    .eq('role', 'super_admin')
    .maybeSingle()

  throwDbError(error)
  return Boolean(data)
}

export async function requireSuperAdmin(session: AuthenticatedSession): Promise<void> {
  if (!await hasSuperAdminRole(session)) {
    throw createError({ statusCode: 403, statusMessage: 'SuperAdmin role required' })
  }
}

export function getRequiredParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `Missing route param: ${name}` })
  }
  return value
}

export function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

export function textValue(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value.length ? value : undefined
}

export function requiredText(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `${field} is required` })
  }
  return value
}

export function numberValue(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function stringArrayValue(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.map(textValue).filter((value): value is string => Boolean(value))
}

export function throwDbError(
  error: { message?: string; code?: string } | null | undefined,
  statusCode = 500,
): void {
  if (!error) return
  const mappedStatus = statusCode === 500
    ? ({
        '23505': 409,
        '23514': 409,
        '23503': 400,
        '42501': 403,
      }[String(error.code)] ?? statusCode)
    : statusCode
  throw createError({
    statusCode: mappedStatus,
    statusMessage: error.message || 'Database operation failed',
  })
}

export function defaultItemStatus(domain?: string): string {
  if (domain === 'insurance') return 'analiza_potrzeb'
  if (domain === 'real_estate') return 'przyjecie'
  return 'kwalifikacja'
}

export async function resolveProductType(
  session: CrmSession,
  body: Record<string, unknown>,
): Promise<{ id: string; domain: string; name: string }> {
  const productTypeId = textValue(body.product_type_id)
  const productTypeCode = textValue(body.product_type_code)

  let query = session.dataApi
    .from('crm_product_types')
    .select('id, domain, name')
    .or(`organization_id.is.null,organization_id.eq.${session.organizationId}`)
    .eq('is_active', true)
    .limit(1)

  if (productTypeId) query = query.eq('id', productTypeId)
  else if (productTypeCode) query = query.eq('code', productTypeCode)
  else {
    throw createError({
      statusCode: 400,
      statusMessage: 'product_type_id or product_type_code is required',
    })
  }

  const { data, error } = await query.single()
  if (error || !data) {
    throw createError({ statusCode: 404, statusMessage: 'Product type not found' })
  }

  return {
    id: String(data.id),
    domain: String(data.domain),
    name: String(data.name),
  }
}

export async function recordCrmActivity(
  session: CrmSession,
  activity: {
    client_id?: string
    case_id?: string
    case_item_id?: string
    submission_id?: string
    activity_type: string
    title: string
    body?: string
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await session.dataApi.from('crm_activities').insert({
    organization_id: session.organizationId,
    actor_user_id: session.userId,
    client_id: activity.client_id ?? null,
    case_id: activity.case_id ?? null,
    case_item_id: activity.case_item_id ?? null,
    submission_id: activity.submission_id ?? null,
    activity_type: activity.activity_type,
    title: activity.title,
    body: activity.body ?? null,
    payload: activity.payload ?? {},
  })

  if (error) {
    console.warn('[crm] failed to record activity', error.message)
  }
}
