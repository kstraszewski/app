import { createError } from 'h3'
import {
  numberValue,
  throwDbError,
  type CrmSession,
} from './crm'

const consentCodePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const languageCodePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/
const consentChannels = new Set(['email', 'sms', 'phone', 'messaging', 'other'])
const consentStatuses = new Set(['draft', 'published', 'archived'])

interface ConsentVersionRow {
  id: string
  definition_id: string
  internal_name: string
  display_title: string
  content: string
  purpose: string
  channel: string
  legal_basis: string
  is_required: boolean
  status: string
  sort_order: number
  language_code: string
  effective_from: string
  effective_to: string | null
  [key: string]: unknown
}

interface ConsentDefinitionRow {
  id: string
  code: string
  current_version_id: string
  [key: string]: unknown
}

export interface ConsentDefinitionPayload extends ConsentDefinitionRow {
  current_version: ConsentVersionRow | null
  versions?: ConsentVersionRow[]
}

export interface ConsentVersionInput {
  internal_name: string
  display_title: string
  content: string
  purpose: string
  channel: string
  legal_basis: string
  is_required: boolean
  status: string
  sort_order: number
  language_code: string
  effective_from: string
  effective_to: string | null
  change_note: string | null
}

export interface ConsentDefinitionCreateInput extends ConsentVersionInput {
  code: string
}

function validationError(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function requiredConsentText(value: unknown, field: string): string {
  if (typeof value !== 'string') validationError(`${field} is required`)
  const result = value.trim()
  if (!result) validationError(`${field} is required`)
  return result
}

function optionalConsentText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') validationError(`${field} must be text or null`)
  return value.trim() || null
}

function consentEnum(value: unknown, field: string, allowed: Set<string>): string {
  const result = requiredConsentText(value, field)
  if (!allowed.has(result)) validationError(`${field} has an unsupported value`)
  return result
}

function consentSortOrder(value: unknown): number {
  const result = numberValue(value)
  if (
    result === undefined
    || !Number.isInteger(result)
    || result < -2_147_483_648
    || result > 2_147_483_647
  ) {
    validationError('sort_order must be a 32-bit integer')
  }
  return result
}

function consentBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') validationError(`${field} must be a boolean`)
  return value
}

function consentDateTime(value: unknown, field: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null
  if (typeof value !== 'string' || !value.trim()) validationError(`${field} is required`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) validationError(`${field} must be a valid date and time`)
  return date.toISOString()
}

export function parseConsentCode(value: unknown): string {
  const result = requiredConsentText(value, 'code')
  if (!consentCodePattern.test(result)) {
    validationError('code must use lowercase letters, digits and single underscores')
  }
  return result
}

function parseConsentVersionInput(
  body: Record<string, unknown>,
  fallback?: ConsentVersionRow,
): ConsentVersionInput {
  const value = (field: keyof ConsentVersionRow, defaultValue?: unknown) => {
    if (field in body) return body[field]
    if (fallback) return fallback[field]
    return defaultValue
  }

  const languageCode = requiredConsentText(value('language_code', 'pl'), 'language_code')
  if (!languageCodePattern.test(languageCode)) {
    validationError('language_code must use a value such as pl or pl-PL')
  }

  const effectiveFrom = consentDateTime(
    value('effective_from', new Date().toISOString()),
    'effective_from',
  ) as string
  const effectiveTo = consentDateTime(value('effective_to'), 'effective_to', true)
  if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
    validationError('effective_to must be later than effective_from')
  }

  return {
    internal_name: requiredConsentText(value('internal_name'), 'internal_name'),
    display_title: requiredConsentText(value('display_title'), 'display_title'),
    content: requiredConsentText(value('content'), 'content'),
    purpose: requiredConsentText(value('purpose'), 'purpose'),
    channel: consentEnum(value('channel'), 'channel', consentChannels),
    legal_basis: requiredConsentText(value('legal_basis'), 'legal_basis'),
    is_required: consentBoolean(value('is_required', false), 'is_required'),
    status: consentEnum(value('status', 'draft'), 'status', consentStatuses),
    sort_order: consentSortOrder(value('sort_order', 0)),
    language_code: languageCode,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    change_note: optionalConsentText(body.change_note, 'change_note'),
  }
}

export function parseConsentDefinitionCreate(
  body: Record<string, unknown>,
): ConsentDefinitionCreateInput {
  return {
    code: parseConsentCode(body.code),
    ...parseConsentVersionInput(body),
  }
}

export function parseConsentDefinitionUpdate(
  body: Record<string, unknown>,
  definition: ConsentDefinitionPayload,
): ConsentVersionInput {
  if ('code' in body && parseConsentCode(body.code) !== definition.code) {
    validationError('code cannot be changed')
  }
  if (!definition.current_version) {
    throwDbError({ message: 'Consent definition current version is missing' })
    throw new Error('Unreachable')
  }
  return parseConsentVersionInput(body, definition.current_version)
}

export async function loadConsentDefinitions(
  session: CrmSession,
  options: { activeOnly?: boolean, definitionId?: string } = {},
): Promise<ConsentDefinitionPayload[]> {
  const activeOnly = options.activeOnly === true
  let definitionRequest = session.dataApi
    .from('crm_consent_definitions')
    .select('*')
    .eq('organization_id', session.organizationId)

  if (activeOnly) definitionRequest = definitionRequest.eq('context', 'client_creation')
  if (options.definitionId) definitionRequest = definitionRequest.eq('id', options.definitionId)

  const { data: rawDefinitions, error: definitionError } = await definitionRequest
  throwDbError(definitionError)

  const definitions = (rawDefinitions ?? []) as ConsentDefinitionRow[]
  if (!definitions.length) return []

  const definitionIds = definitions.map(definition => definition.id)
  const currentVersionIds = definitions.map(definition => definition.current_version_id)
  let versionRequest = session.dataApi
    .from('crm_consent_definition_versions')
    .select('*')
    .eq('organization_id', session.organizationId)

  if (activeOnly) {
    const now = new Date().toISOString()
    versionRequest = versionRequest
      .in('id', currentVersionIds)
      .eq('status', 'published')
      .lte('effective_from', now)
      .or(`effective_to.is.null,effective_to.gt.${now}`)
      .order('sort_order')
      .order('display_title')
  } else {
    versionRequest = versionRequest
      .in('definition_id', definitionIds)
      .order('version', { ascending: false })
  }

  const { data: rawVersions, error: versionError } = await versionRequest
  throwDbError(versionError)

  const versions = (rawVersions ?? []) as ConsentVersionRow[]
  const currentVersionById = new Map(versions.map(version => [version.id, version]))
  const versionsByDefinition = new Map<string, ConsentVersionRow[]>()
  if (!activeOnly) {
    for (const version of versions) {
      const history = versionsByDefinition.get(version.definition_id) ?? []
      history.push(version)
      versionsByDefinition.set(version.definition_id, history)
    }
  }

  const payload = definitions.flatMap((definition): ConsentDefinitionPayload[] => {
    const currentVersion = currentVersionById.get(definition.current_version_id) ?? null
    if (activeOnly && !currentVersion) return []
    return [{
      ...definition,
      current_version: currentVersion,
      ...(activeOnly ? {} : { versions: versionsByDefinition.get(definition.id) ?? [] }),
    }]
  })

  return payload.sort((left, right) => {
    const leftOrder = Number(left.current_version?.sort_order ?? 0)
    const rightOrder = Number(right.current_version?.sort_order ?? 0)
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    const titleOrder = String(left.current_version?.display_title ?? '')
      .localeCompare(String(right.current_version?.display_title ?? ''), 'pl')
    return titleOrder || left.code.localeCompare(right.code, 'pl')
  })
}
