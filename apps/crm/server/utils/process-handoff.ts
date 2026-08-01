import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { CrmSession } from './crm'

export const processHandoffActions = [
  'accept',
  'reject',
  'cancel',
] as const

export const processHandoffStatuses = [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
] as const

export const processHandoffSelect = [
  'id',
  'organization_id',
  'case_id',
  'case_item_id',
  'previous_owner_user_id',
  'proposed_owner_user_id',
  'requested_by_user_id',
  'status',
  'request_note',
  'response_note',
  'requested_at',
  'resolved_at',
  'resolved_by_user_id',
  'revision',
].join(', ')

export type ProcessHandoffAction = typeof processHandoffActions[number]
export type ProcessHandoffStatus = typeof processHandoffStatuses[number]

export interface ProcessHandoffRequestInput {
  proposedOwnerUserId: string
  requestNote: string | null
  idempotencyKey: string
}

export interface ProcessHandoffResponseInput {
  action: ProcessHandoffAction
  responseNote: string | null
}

export interface ProcessHandoffFingerprintInput {
  organizationId: string
  caseId: string
  caseItemId: string
  requestedByUserId: string
  proposedOwnerUserId: string
  requestNote: string | null
}

type ActorSession = Pick<CrmSession, 'userId' | 'role'>
type OwnedRecord = { owner_user_id: string | null }
type HandoffActors = {
  requested_by_user_id: string | null
  proposed_owner_user_id: string | null
}
type LooseRecord = Record<string, any>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha256Pattern = /^[0-9a-f]{64}$/

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function objectValue(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const unexpected = Object.keys(record).filter(key => !allowedKeys.includes(key))
  if (unexpected.length) {
    badRequest(`Unsupported field: ${unexpected.sort()[0]}`)
  }
}

function requiredTrimmedText(
  input: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof input !== 'string' || !input.trim()) {
    return badRequest(`${field} is required`)
  }
  const value = input.trim()
  if (value.length > maximumLength) {
    return badRequest(`${field} is too long`)
  }
  return value
}

function optionalTrimmedText(
  input: unknown,
  field: string,
  maximumLength: number,
): string | null {
  if (input === undefined || input === null || input === '') return null
  if (typeof input !== 'string') return badRequest(`${field} must be text`)
  const value = input.trim()
  if (!value) return null
  if (value.length > maximumLength) {
    return badRequest(`${field} is too long`)
  }
  return value
}

function requiredUuid(input: unknown, field: string): string {
  const value = requiredTrimmedText(input, field, 36).toLowerCase()
  if (!uuidPattern.test(value)) return badRequest(`${field} must be a UUID`)
  return value
}

function enumValue<const T extends readonly string[]>(
  input: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof input !== 'string' || !allowed.includes(input as T[number])) {
    return badRequest(`${field} has an unsupported value`)
  }
  return input as T[number]
}

export function parseProcessHandoffRequest(
  input: unknown,
): ProcessHandoffRequestInput {
  const body = objectValue(input)
  assertOnlyKeys(body, [
    'proposed_owner_user_id',
    'request_note',
    'idempotency_key',
  ])

  return {
    proposedOwnerUserId: requiredUuid(
      body.proposed_owner_user_id,
      'proposed_owner_user_id',
    ),
    requestNote: optionalTrimmedText(body.request_note, 'request_note', 2_000),
    idempotencyKey: requiredUuid(body.idempotency_key, 'idempotency_key'),
  }
}

export function parseProcessHandoffResponse(
  input: unknown,
): ProcessHandoffResponseInput {
  const body = objectValue(input)
  assertOnlyKeys(body, ['action', 'response_note'])

  return {
    action: enumValue(body.action, processHandoffActions, 'action'),
    responseNote: optionalTrimmedText(
      body.response_note,
      'response_note',
      2_000,
    ),
  }
}

export function processHandoffFingerprint(
  input: ProcessHandoffFingerprintInput,
): string {
  const canonical = {
    organization_id: input.organizationId,
    case_id: input.caseId,
    case_item_id: input.caseItemId,
    requested_by_user_id: input.requestedByUserId,
    proposed_owner_user_id: input.proposedOwnerUserId,
    request_note: input.requestNote,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function assertProcessHandoffFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Stored process handoff fingerprint is invalid',
    })
  }
  return value
}

export function canHandoffProcess(
  session: ActorSession,
  crmCase: OwnedRecord,
  process: OwnedRecord,
): boolean {
  return session.role === 'admin'
    || crmCase.owner_user_id === session.userId
    || process.owner_user_id === session.userId
}

export function canChangeProcessStatus(
  session: ActorSession,
  crmCase: OwnedRecord,
  process: OwnedRecord,
): boolean {
  return canHandoffProcess(session, crmCase, process)
}

export function canRespondToProcessHandoff(
  session: ActorSession,
  handoff: HandoffActors,
  action: ProcessHandoffAction,
  crmCase?: OwnedRecord,
  process?: OwnedRecord,
): boolean {
  if (action !== 'cancel') {
    return handoff.proposed_owner_user_id === session.userId
  }
  return session.role === 'admin'
    || handoff.requested_by_user_id === session.userId
    || crmCase?.owner_user_id === session.userId
    || process?.owner_user_id === session.userId
}

export function expectedProcessHandoffStatus(
  action: ProcessHandoffAction,
): Exclude<ProcessHandoffStatus, 'pending'> {
  if (action === 'accept') return 'accepted'
  if (action === 'reject') return 'rejected'
  return 'cancelled'
}

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export interface ProcessHandoffProfile {
  id: string
  email: string
  full_name: string | null
}

export async function loadProcessHandoffProfiles(
  session: CrmSession,
  userIds: Iterable<string | null | undefined>,
): Promise<Map<string, ProcessHandoffProfile>> {
  const ids = [...new Set(
    [...userIds].filter((id): id is string => Boolean(id)),
  )]
  if (!ids.length) return new Map()

  const { data, error } = await session.dataApi
    .from('organization_memberships')
    .select(`
      user_id,
      user:users!organization_memberships_user_id_fkey!inner(
        id,
        email,
        full_name
      )
    `)
    .eq('organization_id', session.organizationId)
    .in('user_id', ids)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Could not load process handoff participants',
    })
  }

  return new Map(((data ?? []) as LooseRecord[]).flatMap((membership) => {
    const user = singleRelation<LooseRecord>(membership.user)
    if (!user) return []
    const profile: ProcessHandoffProfile = {
      id: String(user.id ?? membership.user_id),
      email: String(user.email ?? ''),
      full_name: typeof user.full_name === 'string' ? user.full_name : null,
    }
    return [[String(membership.user_id), profile] as const]
  }))
}

export function withProcessHandoffProfiles(
  handoff: LooseRecord,
  profileById: Map<string, ProcessHandoffProfile>,
): LooseRecord {
  const profile = (value: unknown) => {
    const id = typeof value === 'string' && value ? value : null
    return id ? profileById.get(id) ?? null : null
  }

  return {
    ...handoff,
    previous_owner: profile(handoff.previous_owner_user_id),
    proposed_owner: profile(handoff.proposed_owner_user_id),
    requested_by: profile(handoff.requested_by_user_id),
    resolved_by: profile(handoff.resolved_by_user_id),
  }
}

export function throwProcessHandoffRpcError(
  error: { message?: string, code?: string } | null | undefined,
): never {
  const message = String(error?.message ?? '')
  const code = String(error?.code ?? '')

  if (
    /invalid_crm_case_item_handoff_(?:request|response)|crm_case_item_handoff_(?:requester|proposed_owner)_membership_required/i
      .test(message)
    || code === '22023'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The process handoff request is invalid',
    })
  }
  if (
    /crm_case_item_handoff_(?:case_item_)?not_found/i
      .test(message)
    || code === 'P0002'
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Process handoff not found' })
  }
  if (
    /crm_case_item_handoff_(?:actor_membership_required|request_not_authorized|response_requires_proposed_owner|cancel_not_authorized|service_role_required)/i
      .test(message)
    || code === '42501'
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You cannot change this process handoff',
    })
  }
  if (
    /crm_case_item_handoff_(?:idempotency_key_reused|same_owner|pending_exists|already_resolved|response_conflict|owner_changed|concurrent_resolution)/i
      .test(message)
    || code === '23505'
    || code === '23514'
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The process handoff conflicts with its current state',
    })
  }

  throw createError({
    statusCode: 500,
    statusMessage: message || 'Process handoff operation failed',
  })
}
