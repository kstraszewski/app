import { createHash, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { CrmSession } from './crm'

export const taskDelegationStatuses = [
  'not_delegated',
  'pending',
  'accepted',
  'rejected',
  'cancelled',
] as const

export const delegatedTaskStatuses = [
  'open',
  'in_progress',
  'done',
  'cancelled',
] as const

export const delegatedTaskPriorities = [
  'low',
  'normal',
  'high',
  'urgent',
] as const

export const taskDataAccessScopes = [
  'case_summary',
  'client_contact',
  'client_identity',
  'documents',
  'offers',
  'financial_data',
  'activities',
] as const

export const defaultTaskDataAccessScope: TaskDataAccessScope[] = [
  'case_summary',
  'client_contact',
]

export const delegatedTaskSelect = [
  'id',
  'organization_id',
  'delegator_user_id',
  'assignee_user_id',
  'client_id',
  'case_id',
  'case_item_id',
  'title',
  'description',
  'status_code',
  'delegation_status',
  'priority',
  'due_at',
  'completed_at',
  'data_access_scope',
  'delegated_at',
  'responded_at',
  'accepted_at',
  'rejected_at',
  'rejection_reason',
  'cancelled_at',
  'idempotency_key',
  'idempotency_fingerprint',
  'metadata',
  'created_at',
  'updated_at',
].join(', ')

export type TaskDelegationStatus = typeof taskDelegationStatuses[number]
export type DelegatedTaskStatus = typeof delegatedTaskStatuses[number]
export type DelegatedTaskPriority = typeof delegatedTaskPriorities[number]
export type TaskDataAccessScope = typeof taskDataAccessScopes[number]
export type TaskDelegationAction = 'accept' | 'reject' | 'cancel'

export interface DelegatedTaskInput {
  title: string
  description: string | null
  assigneeUserId: string
  caseItemId: string | null
  dueAt: string
  priority: DelegatedTaskPriority
  dataAccessScope: TaskDataAccessScope[]
  idempotencyKey: string
  appointment: DelegatedTaskAppointmentInput | null
}

export interface DelegatedTaskAppointmentInput {
  facilityId: string
  serviceId: string
  startsAt: string
  clientPersonId: string | null
  meetingMode: 'office' | 'online'
  meetingUrl: string | null
  notes: string | null
}

export interface TaskDelegationResponseInput {
  action: TaskDelegationAction
  reason: string | null
}

export interface OrganizationProfile {
  user_id: string
  email: string
  full_name: string
  role: 'expert' | 'admin'
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

export function requiredUuid(input: unknown, field: string): string {
  const value = requiredTrimmedText(input, field, 36).toLowerCase()
  if (!uuidPattern.test(value)) return badRequest(`${field} must be a UUID`)
  return value
}

function optionalUuid(input: unknown, field: string): string | null {
  if (input === undefined || input === null || input === '') return null
  return requiredUuid(input, field)
}

function isoTimestamp(input: unknown, field: string): string {
  const raw = requiredTrimmedText(input, field, 64)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return badRequest(`${field} must be an ISO date-time with a timezone offset`)
  }
  const timestamp = new Date(raw)
  if (!Number.isFinite(timestamp.getTime())) {
    return badRequest(`${field} must be a valid timestamp`)
  }
  return timestamp.toISOString()
}

function enumValue<const T extends readonly string[]>(
  input: unknown,
  allowed: T,
  field: string,
  fallback?: T[number],
): T[number] {
  if (input === undefined && fallback !== undefined) return fallback
  if (typeof input !== 'string' || !allowed.includes(input as T[number])) {
    return badRequest(`${field} has an unsupported value`)
  }
  return input as T[number]
}

function dataAccessScopeValue(input: unknown): TaskDataAccessScope[] {
  if (input === undefined) return [...defaultTaskDataAccessScope]
  if (!Array.isArray(input)) {
    return badRequest('data_access_scope must be an array')
  }

  const unique = new Set<TaskDataAccessScope>()
  for (const value of input) {
    if (
      typeof value !== 'string'
      || !taskDataAccessScopes.includes(value as TaskDataAccessScope)
    ) {
      return badRequest('data_access_scope contains an unsupported value')
    }
    unique.add(value as TaskDataAccessScope)
  }

  if (!unique.size) {
    return badRequest('data_access_scope must contain at least one value')
  }
  return [...unique].sort()
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

function delegatedTaskAppointmentValue(
  input: unknown,
): DelegatedTaskAppointmentInput | null {
  if (input === undefined || input === null) return null
  const appointment = objectValue(input)
  if (!Object.keys(appointment).length) {
    return badRequest('appointment must be an object')
  }
  assertOnlyKeys(appointment, [
    'facility_id',
    'service_id',
    'starts_at',
    'client_person_id',
    'meeting_mode',
    'meeting_url',
    'notes',
  ])

  const meetingMode = enumValue(
    appointment.meeting_mode,
    ['office', 'online'] as const,
    'appointment.meeting_mode',
    'office',
  )
  const meetingUrl = optionalTrimmedText(
    appointment.meeting_url,
    'appointment.meeting_url',
    2_000,
  )
  if (meetingMode === 'office' && meetingUrl) {
    return badRequest(
      'appointment.meeting_url is only available for online meetings',
    )
  }
  if (meetingUrl) {
    try {
      const url = new URL(meetingUrl)
      if (
        !['http:', 'https:'].includes(url.protocol)
        || url.username
        || url.password
      ) {
        throw new Error('Unsupported meeting URL')
      }
    }
    catch {
      return badRequest(
        'appointment.meeting_url must be a valid HTTP(S) URL',
      )
    }
  }

  return {
    facilityId: requiredUuid(
      appointment.facility_id,
      'appointment.facility_id',
    ),
    serviceId: requiredUuid(
      appointment.service_id,
      'appointment.service_id',
    ),
    startsAt: isoTimestamp(
      appointment.starts_at,
      'appointment.starts_at',
    ),
    clientPersonId: optionalUuid(
      appointment.client_person_id,
      'appointment.client_person_id',
    ),
    meetingMode,
    meetingUrl,
    notes: optionalTrimmedText(
      appointment.notes,
      'appointment.notes',
      2_000,
    ),
  }
}

export function parseDelegatedTaskInput(input: unknown): DelegatedTaskInput {
  const body = objectValue(input)
  assertOnlyKeys(body, [
    'title',
    'description',
    'assignee_user_id',
    'case_item_id',
    'due_at',
    'priority',
    'data_access_scope',
    'idempotency_key',
    'appointment',
  ])

  const appointment = delegatedTaskAppointmentValue(body.appointment)
  const dataAccessScope = dataAccessScopeValue(body.data_access_scope)
  if (
    appointment
    && (
      !dataAccessScope.includes('client_contact')
      || !dataAccessScope.includes('client_identity')
    )
  ) {
    return badRequest(
      'appointments require client_contact and client_identity data access',
    )
  }
  const dueAt = body.due_at === undefined
    || body.due_at === null
    || body.due_at === ''
    ? appointment?.startsAt ?? badRequest(
        'due_at is required when no appointment is selected',
      )
    : isoTimestamp(body.due_at, 'due_at')

  return {
    title: requiredTrimmedText(body.title, 'title', 180),
    description: optionalTrimmedText(body.description, 'description', 4_000),
    assigneeUserId: requiredUuid(body.assignee_user_id, 'assignee_user_id'),
    caseItemId: optionalUuid(body.case_item_id, 'case_item_id'),
    dueAt,
    priority: enumValue(
      body.priority,
      delegatedTaskPriorities,
      'priority',
      'normal',
    ),
    dataAccessScope,
    idempotencyKey: body.idempotency_key === undefined
      ? randomUUID()
      : requiredUuid(body.idempotency_key, 'idempotency_key'),
    appointment,
  }
}

export function taskDelegationFingerprint(input: {
  organizationId: string
  caseId: string
  delegatorUserId: string
  task: DelegatedTaskInput
}): string {
  const canonical: Record<string, unknown> = {
    organization_id: input.organizationId,
    case_id: input.caseId,
    case_item_id: input.task.caseItemId,
    delegator_user_id: input.delegatorUserId,
    assignee_user_id: input.task.assigneeUserId,
    title: input.task.title,
    description: input.task.description,
    due_at: input.task.dueAt,
    priority: input.task.priority,
    data_access_scope: [...input.task.dataAccessScope].sort(),
  }
  if (input.task.appointment) {
    canonical.appointment = {
      facility_id: input.task.appointment.facilityId,
      service_id: input.task.appointment.serviceId,
      starts_at: input.task.appointment.startsAt,
      client_person_id: input.task.appointment.clientPersonId,
      meeting_mode: input.task.appointment.meetingMode,
      meeting_url: input.task.appointment.meetingUrl,
      notes: input.task.appointment.notes,
    }
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function parseTaskDelegationResponse(
  input: unknown,
): TaskDelegationResponseInput {
  const body = objectValue(input)
  assertOnlyKeys(body, ['action', 'reason'])
  const action = enumValue(
    body.action,
    ['accept', 'reject', 'cancel'] as const,
    'action',
  )
  const reason = optionalTrimmedText(body.reason, 'reason', 1_000)
  if (action === 'reject' && !reason) {
    return badRequest('reason is required when rejecting a task')
  }
  if (action !== 'reject' && reason) {
    return badRequest('reason is only supported when rejecting a task')
  }
  return { action, reason }
}

export function parseDelegatedTaskStatus(input: unknown): DelegatedTaskStatus {
  const body = objectValue(input)
  assertOnlyKeys(body, ['status_code'])
  const status = enumValue(
    body.status_code,
    ['open', 'in_progress', 'done'] as const,
    'status_code',
  )
  return status
}

export function expectedDelegationStatus(
  action: TaskDelegationAction,
): Exclude<TaskDelegationStatus, 'not_delegated' | 'pending'> {
  if (action === 'accept') return 'accepted'
  if (action === 'reject') return 'rejected'
  return 'cancelled'
}

export function canRespondToDelegation(
  session: Pick<CrmSession, 'userId' | 'role'>,
  task: {
    delegator_user_id: string | null
    assignee_user_id: string | null
  },
  action: TaskDelegationAction,
): boolean {
  if (session.role === 'admin') return true
  if (action === 'cancel') return task.delegator_user_id === session.userId
  return task.assignee_user_id === session.userId
}

export function canUpdateDelegatedTaskStatus(
  session: Pick<CrmSession, 'userId' | 'role'>,
  task: { assignee_user_id: string | null },
): boolean {
  return session.role === 'admin' || task.assignee_user_id === session.userId
}

export function assertDelegationFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Stored task idempotency fingerprint is invalid',
    })
  }
  return value
}

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export async function loadOrganizationProfiles(
  session: CrmSession,
  userIds: Iterable<string | null | undefined>,
): Promise<Map<string, OrganizationProfile>> {
  const ids = [...new Set(
    [...userIds].filter((id): id is string => Boolean(id)),
  )]
  if (!ids.length) return new Map()

  const { data, error } = await session.supabase
    .from('organization_memberships')
    .select(`
      user_id,
      role,
      user:users!organization_memberships_user_id_fkey!inner(
        email,
        full_name
      )
    `)
    .eq('organization_id', session.organizationId)
    .in('user_id', ids)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Could not load task participants',
    })
  }

  return new Map(((data ?? []) as LooseRecord[]).flatMap((membership) => {
    const user = singleRelation<LooseRecord>(membership.user)
    if (!user) return []
    const profile: OrganizationProfile = {
      user_id: String(membership.user_id),
      email: String(user.email ?? ''),
      full_name: String(user.full_name ?? ''),
      role: membership.role === 'admin' ? 'admin' : 'expert',
    }
    return [[profile.user_id, profile] as const]
  }))
}

export function withTaskParticipants(
  task: LooseRecord,
  profileById: Map<string, OrganizationProfile>,
): LooseRecord {
  const delegatorId = task.delegator_user_id
    ? String(task.delegator_user_id)
    : null
  const assigneeId = task.assignee_user_id
    ? String(task.assignee_user_id)
    : null
  return {
    ...task,
    delegator: delegatorId ? profileById.get(delegatorId) ?? null : null,
    assignee: assigneeId ? profileById.get(assigneeId) ?? null : null,
  }
}
