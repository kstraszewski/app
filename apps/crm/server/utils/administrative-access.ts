import { createError } from 'h3'

export const administrativeRoleIds = [
  'organization_admin',
  'access_admin',
  'structure_admin',
  'consents_admin',
  'crm_config_admin',
  'forum_admin',
  'experiments_access',
] as const

export type AdministrativeRoleId = typeof administrativeRoleIds[number]

export interface ConsentPublishingGrantInput {
  justification: string
  expiresAt: string
}

export interface AdministrativeAccessPutInput {
  expectedRevision: number
  idempotencyKey: string
  roles: AdministrativeRoleId[]
  consentPublishingGrant: ConsentPublishingGrantInput | null
  changeReason: string
}

export interface AnonymizationGrantCreateInput {
  requestId: string
  approverUserId: string
  justification: string
  expiresAt: string
  idempotencyKey: string
}

export interface AnonymizationGrantApproveInput {
  expectedRevision: number
  idempotencyKey: string
  reason: string | null
}

export interface AnonymizationGrantRejectInput {
  expectedRevision: number
  idempotencyKey: string
  reason: string
}

export interface AnonymizationGrantRevokeInput {
  expectedRevision: number
  idempotencyKey: string
  reason: string
}

export type AdministrativeAccessDbConflictCode =
  | 'administrative_access_revision_conflict'
  | 'administrative_access_idempotency_conflict'

export interface AdministrativeAccessDbConflict {
  code: AdministrativeAccessDbConflictCode
  statusCode: 409
  statusMessage: string
}

export interface AdministrativeAccessDbErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
  constraint?: string | null
}

type JsonRecord = Record<string, unknown>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const administrativeRoleSet = new Set<AdministrativeRoleId>(administrativeRoleIds)
const administrativeRoleOrder = new Map<AdministrativeRoleId, number>(
  administrativeRoleIds.map((role, index) => [role, index]),
)
const maximumGrantDurationMilliseconds = 24 * 60 * 60 * 1_000

function badRequest(statusMessage: string): never {
  throw createError({ statusCode: 400, statusMessage })
}

function recordValue(input: unknown, field: string): JsonRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return badRequest(`${field} must be an object`)
  }
  return input as JsonRecord
}

function assertOnlyKeys(
  record: JsonRecord,
  allowedKeys: readonly string[],
  field = 'body',
): void {
  const unexpected = Object.keys(record)
    .filter(key => !allowedKeys.includes(key))
    .sort()[0]
  if (unexpected) {
    badRequest(`Unsupported field in ${field}: ${unexpected}`)
  }
}

function requiredTrimmedText(
  input: unknown,
  field: string,
  minimumLength: number,
  maximumLength: number,
): string {
  if (typeof input !== 'string') {
    return badRequest(`${field} must be text`)
  }
  const value = input.trim()
  if (value.length < minimumLength) {
    return badRequest(`${field} must contain at least ${minimumLength} characters`)
  }
  if (value.length > maximumLength) {
    return badRequest(`${field} must contain at most ${maximumLength} characters`)
  }
  return value
}

function optionalReason(input: unknown, field: string): string | null {
  if (input === undefined || input === null || input === '') return null
  return requiredTrimmedText(input, field, 10, 2_000)
}

function expectedRevisionValue(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    return badRequest('expectedRevision must be a non-negative safe integer')
  }
  return input
}

function requiredUuid(input: unknown, field: string): string {
  if (typeof input !== 'string') return badRequest(`${field} must be a UUID`)
  const value = input.trim().toLowerCase()
  if (!uuidPattern.test(value)) return badRequest(`${field} must be a UUID`)
  return value
}

function timestampValue(input: unknown, field: string): {
  iso: string
  milliseconds: number
} {
  if (typeof input !== 'string' || !input.trim()) {
    return badRequest(`${field} must be an ISO date-time with a timezone offset`)
  }
  const raw = input.trim()
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return badRequest(`${field} must be an ISO date-time with a timezone offset`)
  }
  const milliseconds = new Date(raw).getTime()
  if (!Number.isFinite(milliseconds)) {
    return badRequest(`${field} must be a valid date-time`)
  }
  return {
    iso: new Date(milliseconds).toISOString(),
    milliseconds,
  }
}

function nowMilliseconds(now: Date): number {
  const milliseconds = now.getTime()
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('now must be a valid Date')
  }
  return milliseconds
}

function futureTimestampValue(
  input: unknown,
  field: string,
  now: Date,
  maximumDurationMilliseconds?: number,
): string {
  const timestamp = timestampValue(input, field)
  const currentTime = nowMilliseconds(now)
  if (timestamp.milliseconds <= currentTime) {
    return badRequest(`${field} must be in the future`)
  }
  if (
    maximumDurationMilliseconds !== undefined
    && timestamp.milliseconds > currentTime + maximumDurationMilliseconds
  ) {
    return badRequest(`${field} must not be more than 24 hours in the future`)
  }
  return timestamp.iso
}

function rolesValue(input: unknown): AdministrativeRoleId[] {
  if (!Array.isArray(input)) return badRequest('roles must be an array')
  const roles: AdministrativeRoleId[] = []
  const seen = new Set<AdministrativeRoleId>()

  for (const value of input) {
    if (
      typeof value !== 'string'
      || !administrativeRoleSet.has(value as AdministrativeRoleId)
    ) {
      return badRequest('roles contains an unsupported value')
    }
    const role = value as AdministrativeRoleId
    if (seen.has(role)) return badRequest('roles must not contain duplicates')
    seen.add(role)
    roles.push(role)
  }

  return roles.sort((left, right) => (
    (administrativeRoleOrder.get(left) ?? 0)
    - (administrativeRoleOrder.get(right) ?? 0)
  ))
}

function consentPublishingGrantValue(
  input: unknown,
  now: Date,
): ConsentPublishingGrantInput | null {
  if (input === undefined || input === null) return null
  const grant = recordValue(input, 'consentPublishingGrant')
  assertOnlyKeys(
    grant,
    ['justification', 'expiresAt'],
    'consentPublishingGrant',
  )
  return {
    justification: requiredTrimmedText(
      grant.justification,
      'consentPublishingGrant.justification',
      10,
      2_000,
    ),
    expiresAt: futureTimestampValue(
      grant.expiresAt,
      'consentPublishingGrant.expiresAt',
      now,
    ),
  }
}

export function parseAdministrativeAccessPutInput(
  input: unknown,
  now = new Date(),
): AdministrativeAccessPutInput {
  const body = recordValue(input, 'body')
  assertOnlyKeys(body, [
    'expectedRevision',
    'idempotencyKey',
    'roles',
    'consentPublishingGrant',
    'changeReason',
  ])

  return {
    expectedRevision: expectedRevisionValue(body.expectedRevision),
    idempotencyKey: requiredUuid(body.idempotencyKey, 'idempotencyKey'),
    roles: rolesValue(body.roles),
    consentPublishingGrant: consentPublishingGrantValue(
      body.consentPublishingGrant,
      now,
    ),
    changeReason: requiredTrimmedText(
      body.changeReason,
      'changeReason',
      10,
      2_000,
    ),
  }
}

export function parseAnonymizationGrantCreateInput(
  input: unknown,
  now = new Date(),
): AnonymizationGrantCreateInput {
  const body = recordValue(input, 'body')
  assertOnlyKeys(body, [
    'requestId',
    'approverUserId',
    'justification',
    'expiresAt',
    'idempotencyKey',
  ])

  return {
    requestId: requiredUuid(body.requestId, 'requestId'),
    approverUserId: requiredUuid(body.approverUserId, 'approverUserId'),
    justification: requiredTrimmedText(
      body.justification,
      'justification',
      20,
      2_000,
    ),
    expiresAt: futureTimestampValue(
      body.expiresAt,
      'expiresAt',
      now,
      maximumGrantDurationMilliseconds,
    ),
    idempotencyKey: requiredUuid(body.idempotencyKey, 'idempotencyKey'),
  }
}

function parseGrantRevisionCommand(
  input: unknown,
  options: {
    reason: 'optional' | 'required'
  },
): {
  expectedRevision: number
  idempotencyKey: string
  reason: string | null
} {
  const body = recordValue(input, 'body')
  assertOnlyKeys(body, ['expectedRevision', 'idempotencyKey', 'reason'])
  const reason = options.reason === 'required'
    ? requiredTrimmedText(body.reason, 'reason', 10, 2_000)
    : optionalReason(body.reason, 'reason')
  return {
    expectedRevision: expectedRevisionValue(body.expectedRevision),
    idempotencyKey: requiredUuid(body.idempotencyKey, 'idempotencyKey'),
    reason,
  }
}

export function parseAnonymizationGrantApproveInput(
  input: unknown,
): AnonymizationGrantApproveInput {
  return parseGrantRevisionCommand(input, { reason: 'optional' })
}

export function parseAnonymizationGrantRejectInput(
  input: unknown,
): AnonymizationGrantRejectInput {
  const parsed = parseGrantRevisionCommand(input, { reason: 'required' })
  return { ...parsed, reason: parsed.reason! }
}

export function parseAnonymizationGrantRevokeInput(
  input: unknown,
): AnonymizationGrantRevokeInput {
  const parsed = parseGrantRevisionCommand(input, { reason: 'required' })
  return { ...parsed, reason: parsed.reason! }
}

export function administrativeAccessDbConflict(
  error: AdministrativeAccessDbErrorLike | null | undefined,
): AdministrativeAccessDbConflict | null {
  if (!error) return null
  const code = String(error.code ?? '')
  const detail = [
    error.message,
    error.details,
    error.hint,
    error.constraint,
  ].filter(Boolean).join(' ')

  if (
    /idempotenc(?:y|e)|idempotency_key/iu.test(detail)
    && (
      code === '23505'
      || /conflict|reused|already|duplicate|unique/iu.test(detail)
    )
  ) {
    return {
      code: 'administrative_access_idempotency_conflict',
      statusCode: 409,
      statusMessage: 'Idempotency key was already used for another operation.',
    }
  }

  if (
    code === '40001'
    || (
      /revision/iu.test(detail)
      && /conflict|changed|stale|mismatch|expected/iu.test(detail)
    )
  ) {
    return {
      code: 'administrative_access_revision_conflict',
      statusCode: 409,
      statusMessage: 'Administrative access changed in another session.',
    }
  }

  return null
}

export function throwAdministrativeAccessDbError(
  error: AdministrativeAccessDbErrorLike | null | undefined,
): void {
  if (!error) return

  const conflict = administrativeAccessDbConflict(error)
  if (conflict) {
    throw createError({
      statusCode: conflict.statusCode,
      statusMessage: conflict.statusMessage,
      data: { code: conflict.code },
    })
  }

  const code = String(error.code ?? '')
  const message = String(error.message ?? 'Administrative access operation failed')
  if (message.includes('anonymization_documents_require_manual_retention_review')) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Anonimizacja wymaga ręcznego przeglądu retencji dokumentów, wiadomości, załączników, obrazów lub zapisanych ofert.',
      data: { code: 'anonymization_manual_retention_review_required' },
    })
  }
  const statusCode = code === 'P0002' || /not_found/iu.test(message)
    ? 404
    : code === '42501'
      ? 403
      : code === '22023'
        ? 400
        : ['23505', '23514'].includes(code)
          ? 409
          : code === '23503'
            ? 400
            : 500

  throw createError({
    statusCode,
    statusMessage: message,
  })
}
