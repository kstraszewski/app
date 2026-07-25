import { createError } from 'h3'
import { throwDbError } from '~~/server/utils/crm'

export const expertTimeOffSelect = [
  'id',
  'organization_id',
  'expert_user_id',
  'kind',
  'starts_at',
  'ends_at',
  'timezone',
  'all_day',
  'status',
  'notes',
  'created_by_user_id',
  'cancelled_at',
  'created_at',
  'updated_at',
].join(', ')

export function expertTimeOffPayload(
  row: Record<string, any>,
  options: { includeNotes?: boolean } = {},
) {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    expert_user_id: String(row.expert_user_id),
    kind: row.kind === 'vacation' ? 'vacation' : String(row.kind),
    starts_at: String(row.starts_at),
    ends_at: String(row.ends_at),
    timezone: String(row.timezone),
    all_day: row.all_day === true,
    status: row.status === 'cancelled' ? 'cancelled' : 'active',
    notes: options.includeNotes === false || row.notes == null
      ? null
      : String(row.notes),
    created_by_user_id: String(row.created_by_user_id),
    cancelled_at: row.cancelled_at ? String(row.cancelled_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function throwTimeOffDbError(
  error: { message?: string; code?: string } | null | undefined,
): void {
  if (!error) return
  if (error.code === '23P01') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Time off conflicts with an existing appointment or time off',
    })
  }
  throwDbError(error)
}
