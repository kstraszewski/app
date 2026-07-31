import { createError, getQuery, setHeader } from 'h3'
import {
  asRecord,
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  requireOrganizationMember,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

type AuditEventRow = {
  id: string
  actor_snapshot: unknown
  target_snapshot: unknown
  event_type: string
  resource_type: string
  resource_id: string | null
  resource_label: string | null
  changes: unknown
  reason: string | null
  source: string
  correlation_id: string
  revision_before: number | null
  revision_after: number | null
  created_at: string
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

function cursorValue(input: unknown): { createdAt: string; id: string } | null {
  if (input === undefined) return null
  if (typeof input !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'cursor must be text' })
  }
  const separatorIndex = input.lastIndexOf('|')
  if (separatorIndex < 1) {
    throw createError({ statusCode: 400, statusMessage: 'cursor is invalid' })
  }
  const createdAt = input.slice(0, separatorIndex)
  const milliseconds = new Date(createdAt).getTime()
  if (!Number.isFinite(milliseconds)) {
    throw createError({ statusCode: 400, statusMessage: 'cursor is invalid' })
  }
  return {
    createdAt: new Date(milliseconds).toISOString(),
    id: uuidValue(input.slice(separatorIndex + 1), 'cursor id'),
  }
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const userId = uuidValue(getRequiredParam(event, 'userId'), 'userId')
  const query = getQuery(event)
  const limit = limitValue(query.limit)
  const cursor = cursorValue(query.cursor)
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  await requireAdministrativePermission(session, 'iam.audit.read')

  let request = session.dataApi
    .from('organization_user_audit_events')
    .select(`
      id,
      actor_snapshot,
      target_snapshot,
      event_type,
      resource_type,
      resource_id,
      resource_label,
      changes,
      reason,
      source,
      correlation_id,
      revision_before,
      revision_after,
      created_at
    `)
    .eq('organization_id', session.organizationId)
    .eq('target_user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursor) {
    request = request.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await request
  throwDbError(error)

  const rows = (data ?? []) as AuditEventRow[]
  const hasMore = rows.length > limit
  const visibleRows = rows.slice(0, limit)
  const last = visibleRows.at(-1)

  return {
    data: visibleRows.map(row => ({
      id: String(row.id),
      eventType: String(row.event_type),
      resourceType: String(row.resource_type),
      resourceId: row.resource_id === null ? null : String(row.resource_id),
      resourceLabel: row.resource_label === null ? null : String(row.resource_label),
      changes: Array.isArray(row.changes) ? row.changes : [],
      reason: row.reason === null ? null : String(row.reason),
      source: String(row.source),
      correlationId: String(row.correlation_id),
      revisionBefore: row.revision_before === null ? null : Number(row.revision_before),
      revisionAfter: row.revision_after === null ? null : Number(row.revision_after),
      createdAt: String(row.created_at),
      actor: asRecord(row.actor_snapshot),
      target: asRecord(row.target_snapshot),
    })),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
    },
  }
})
