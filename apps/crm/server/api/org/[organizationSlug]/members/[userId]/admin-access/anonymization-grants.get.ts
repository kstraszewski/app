import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, getQuery, setHeader } from 'h3'
import {
  getRequiredParam,
  hasAdministrativePermission,
  requireCrmSession,
  requireOrganizationMember,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

type GrantRow = {
  id: string
  revision: number
  permission_key: string
  status: string
  request_id: string
  grantee_user_id: string
  requested_by_user_id: string
  approver_user_id: string
  justification: string
  decision_reason: string | null
  expires_at: string
  approved_at: string | null
  rejected_at: string | null
  revoked_at: string | null
  revoked_by_user_id: string | null
  consumed_at: string | null
  consumed_by_user_id: string | null
  created_at: string
}

type RequestRow = {
  id: string
  client_id: string
  request_number: string
  status: string
  due_at: string
}

type ClientRow = {
  id: string
  display_name: string
}

type UserRow = {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
}

function limitValue(input: unknown): number {
  if (input === undefined) return 50
  if (typeof input !== 'string' || !/^\d+$/.test(input)) {
    throw createError({ statusCode: 400, statusMessage: 'limit must be an integer' })
  }
  const value = Number(input)
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw createError({ statusCode: 400, statusMessage: 'limit must be between 1 and 100' })
  }
  return value
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function userSnapshot(user: UserRow | undefined) {
  if (!user) return null
  return {
    userId: String(user.id),
    fullName: String(user.full_name || user.email),
    email: String(user.email),
    avatarUrl: user.avatar_url === null ? null : String(user.avatar_url),
  }
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const userId = uuidValue(getRequiredParam(event, 'userId'), 'userId')
  const limit = limitValue(getQuery(event).limit)
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  if (userId !== session.userId) {
    const [canManageGrants, canApproveGrants] = await Promise.all([
      hasAdministrativePermission(session, 'iam.grants.manage'),
      hasAdministrativePermission(session, 'privacy.grants.approve'),
    ])
    if (!canManageGrants && !canApproveGrants) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Administrative permission required to read grants',
      })
    }
  }

  // This RLS-scoped query is the authorization boundary. Service role is used
  // below only to enrich these already-authorized grant rows with request data.
  const grantResult = await session.dataApi
    .from('crm_client_anonymization_execution_grants')
    .select(`
      id,
      revision,
      permission_key,
      status,
      request_id,
      grantee_user_id,
      requested_by_user_id,
      approver_user_id,
      justification,
      decision_reason,
      expires_at,
      approved_at,
      rejected_at,
      revoked_at,
      revoked_by_user_id,
      consumed_at,
      consumed_by_user_id,
      created_at
    `)
    .eq('organization_id', session.organizationId)
    .eq('grantee_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  throwDbError(grantResult.error)

  const grants = (grantResult.data ?? []) as GrantRow[]
  if (!grants.length) {
    return { data: [], limit }
  }

  const backendData = serverDataBackend(event) as any
  const requestIds = uniqueStrings(grants.map(grant => grant.request_id))
  const requestResult = await backendData
    .from('crm_client_anonymization_requests')
    .select('id, client_id, request_number, status, due_at')
    .eq('organization_id', session.organizationId)
    .in('id', requestIds)
  throwDbError(requestResult.error)

  const requests = (requestResult.data ?? []) as RequestRow[]
  const clientIds = uniqueStrings(requests.map(request => request.client_id))
  const userIds = uniqueStrings(grants.flatMap(grant => [
    grant.grantee_user_id,
    grant.requested_by_user_id,
    grant.approver_user_id,
    grant.revoked_by_user_id,
    grant.consumed_by_user_id,
  ]))

  const [clientsResult, usersResult] = await Promise.all([
    clientIds.length
      ? backendData
          .from('crm_clients')
          .select('id, display_name')
          .eq('organization_id', session.organizationId)
          .in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    backendData
      .from('users')
      .select('id, full_name, email, avatar_url')
      .in('id', userIds),
  ])
  throwDbError(clientsResult.error)
  throwDbError(usersResult.error)

  const requestById = new Map(requests.map(request => [String(request.id), request]))
  const clientById = new Map(
    ((clientsResult.data ?? []) as ClientRow[]).map(client => [String(client.id), client]),
  )
  const userById = new Map(
    ((usersResult.data ?? []) as UserRow[]).map(user => [String(user.id), user]),
  )
  const now = Date.now()

  return {
    data: grants.map((grant) => {
      const request = requestById.get(String(grant.request_id))
      const client = request ? clientById.get(String(request.client_id)) : undefined
      const isExpired = ['pending_approval', 'active'].includes(grant.status)
        && new Date(grant.expires_at).getTime() <= now

      return {
        id: String(grant.id),
        revision: Number(grant.revision),
        permissionKey: String(grant.permission_key),
        status: isExpired ? 'expired' : String(grant.status),
        singleUse: true,
        request: request
          ? {
              id: String(request.id),
              requestNumber: String(request.request_number),
              status: String(request.status),
              dueAt: String(request.due_at),
              client: client
                ? {
                    id: String(client.id),
                    displayName: String(client.display_name),
                  }
                : null,
            }
          : null,
        grantee: userSnapshot(userById.get(String(grant.grantee_user_id))),
        requestedBy: userSnapshot(userById.get(String(grant.requested_by_user_id))),
        approver: userSnapshot(userById.get(String(grant.approver_user_id))),
        revokedBy: grant.revoked_by_user_id
          ? userSnapshot(userById.get(String(grant.revoked_by_user_id)))
          : null,
        consumedBy: grant.consumed_by_user_id
          ? userSnapshot(userById.get(String(grant.consumed_by_user_id)))
          : null,
        justification: String(grant.justification),
        decisionReason: grant.decision_reason === null
          ? null
          : String(grant.decision_reason),
        requestedAt: String(grant.created_at),
        approvedAt: grant.approved_at === null ? null : String(grant.approved_at),
        rejectedAt: grant.rejected_at === null ? null : String(grant.rejected_at),
        expiresAt: String(grant.expires_at),
        consumedAt: grant.consumed_at === null ? null : String(grant.consumed_at),
        revokedAt: grant.revoked_at === null ? null : String(grant.revoked_at),
      }
    }),
    limit,
  }
})
