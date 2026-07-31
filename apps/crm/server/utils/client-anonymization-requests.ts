import { createError } from 'h3'

export const clientAnonymizationRequestChannels = [
  'email',
  'phone',
  'in_person',
  'letter',
  'other',
] as const

export type ClientAnonymizationRequestChannel =
  typeof clientAnonymizationRequestChannels[number]

export interface ClientAnonymizationRequestCreateInput {
  subjectPersonId: string
  requestChannel: ClientAnonymizationRequestChannel
  requestedAt: string
  justification: string
  idempotencyKey: string
}

export interface ClientAnonymizationRequestDbErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
  constraint?: string | null
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const channelSet = new Set<string>(clientAnonymizationRequestChannels)
const futureClockSkewMilliseconds = 5 * 60 * 1_000

function badRequest(statusMessage: string): never {
  throw createError({ statusCode: 400, statusMessage })
}

function recordValue(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return badRequest('body must be an object')
  }
  return input as Record<string, unknown>
}

function requiredUuid(input: unknown, field: string): string {
  if (typeof input !== 'string') {
    return badRequest(`${field} must be a UUID`)
  }
  const value = input.trim().toLowerCase()
  if (!uuidPattern.test(value)) {
    return badRequest(`${field} must be a UUID`)
  }
  return value
}

function requestedAtValue(input: unknown, now: Date): string {
  if (typeof input !== 'string' || !input.trim()) {
    return badRequest('requestedAt must be an ISO date-time with a timezone offset')
  }
  const value = input.trim()
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return badRequest('requestedAt must be an ISO date-time with a timezone offset')
  }
  const milliseconds = new Date(value).getTime()
  if (!Number.isFinite(milliseconds)) {
    return badRequest('requestedAt must be a valid date-time')
  }
  const nowMilliseconds = now.getTime()
  if (!Number.isFinite(nowMilliseconds)) {
    throw new TypeError('now must be a valid Date')
  }
  if (milliseconds > nowMilliseconds + futureClockSkewMilliseconds) {
    return badRequest('requestedAt must not be in the future')
  }
  return new Date(milliseconds).toISOString()
}

function justificationValue(input: unknown): string {
  if (typeof input !== 'string') {
    return badRequest('justification must be text')
  }
  const value = input.trim()
  if (value.length < 20) {
    return badRequest('justification must contain at least 20 characters')
  }
  if (value.length > 2_000) {
    return badRequest('justification must contain at most 2000 characters')
  }
  return value
}

export function parseClientAnonymizationRequestCreateInput(
  input: unknown,
  now = new Date(),
): ClientAnonymizationRequestCreateInput {
  const body = recordValue(input)
  const allowedKeys = new Set([
    'subjectPersonId',
    'requestChannel',
    'requestedAt',
    'justification',
    'idempotencyKey',
  ])
  const unsupportedField = Object.keys(body)
    .filter(key => !allowedKeys.has(key))
    .sort()[0]
  if (unsupportedField) {
    return badRequest(`Unsupported field in body: ${unsupportedField}`)
  }

  if (
    typeof body.requestChannel !== 'string'
    || !channelSet.has(body.requestChannel)
  ) {
    return badRequest('requestChannel contains an unsupported value')
  }

  return {
    subjectPersonId: requiredUuid(body.subjectPersonId, 'subjectPersonId'),
    requestChannel:
      body.requestChannel as ClientAnonymizationRequestChannel,
    requestedAt: requestedAtValue(body.requestedAt, now),
    justification: justificationValue(body.justification),
    idempotencyKey: requiredUuid(body.idempotencyKey, 'idempotencyKey'),
  }
}

export function canCreateClientAnonymizationRequest(input: {
  currentUserId: string
  ownerUserId: string | null | undefined
  hasCreatePermission: boolean
  clientStatus: string
}): boolean {
  if (input.clientStatus === 'anonymized') return false
  return (
    input.currentUserId === input.ownerUserId
    || input.hasCreatePermission
  )
}

export function throwClientAnonymizationRequestDbError(
  error: ClientAnonymizationRequestDbErrorLike | null | undefined,
): void {
  if (!error) return

  const message = String(
    error.message ?? 'Client anonymization request operation failed',
  )
  const detail = [
    message,
    error.details,
    error.hint,
    error.constraint,
  ].filter(Boolean).join(' ')

  if (
    /anonymization_request_active_request_exists|one_active_client/iu.test(
      detail,
    )
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dla tego klienta istnieje już aktywne żądanie anonimizacji.',
      data: { code: 'anonymization_request_active_request_exists' },
    })
  }

  if (/anonymization_request_idempotency_conflict|idempotency_key/iu.test(detail)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Klucz ponowienia został już użyty dla innego żądania.',
      data: { code: 'anonymization_request_idempotency_conflict' },
    })
  }

  if (/anonymization_request_client_already_anonymized/iu.test(detail)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dane tego klienta zostały już zanonimizowane.',
      data: { code: 'anonymization_request_client_already_anonymized' },
    })
  }

  if (
    error.code === 'P0002'
    || /anonymization_request_client_not_found/iu.test(detail)
  ) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Nie znaleziono klienta.',
    })
  }

  if (
    error.code === '42501'
    || /anonymization_request_forbidden|authentication_required/iu.test(detail)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage:
        'Nie masz uprawnienia do zgłoszenia anonimizacji dla tego klienta.',
    })
  }

  if (
    error.code === '22023'
    || /anonymization_request_(?:subject|channel|justification|requested_at|required)/iu.test(
      detail,
    )
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dane żądania anonimizacji są nieprawidłowe.',
    })
  }

  throw createError({
    statusCode: ['23505', '23514'].includes(String(error.code)) ? 409 : 500,
    statusMessage: message,
  })
}
