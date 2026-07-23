import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, type H3Event } from 'h3'
import {
  type DocumentSelectionCondition,
  validateDocumentRequirement,
} from '~~/shared/document-requirements'
import {
  asRecord,
  requireAuthenticatedSession,
  requireSuperAdmin,
  type AuthenticatedSession,
} from './crm'

export type MortgageBackofficeClient = any
export type MortgageBackofficeRecord = Record<string, unknown>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export async function requireMortgageBackoffice(event: H3Event): Promise<{
  session: AuthenticatedSession
  serviceRole: MortgageBackofficeClient
}> {
  const session = await requireAuthenticatedSession(event)
  await requireSuperAdmin(session)
  return {
    session,
    serviceRole: serverSupabaseServiceRole(event) as MortgageBackofficeClient,
  }
}

export function mortgageBackofficeUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a UUID` })
  }
  return value
}

export function mortgageBackofficeText(
  value: unknown,
  field: string,
  options: { min?: number, max?: number } = {},
): string {
  const result = typeof value === 'string' ? value.trim() : ''
  const min = options.min ?? 1
  const max = options.max ?? 200
  if (result.length < min || result.length > max) {
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  }
  return result
}

export function mortgageBackofficeSlug(value: unknown, field = 'slug'): string {
  const result = mortgageBackofficeText(value, field, { min: 2, max: 100 })
  if (!slugPattern.test(result)) {
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  }
  return result
}

export function mortgageBackofficeRevision(value: unknown): number {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw createError({ statusCode: 400, statusMessage: 'expectedRevision is invalid' })
  }
  return result
}

export function mortgageOfferDraftData(value: unknown): MortgageBackofficeRecord {
  const draftData = asRecord(value)
  if (draftData.schemaVersion !== 'openexpert.mortgage-offer/2.0') {
    throw createError({
      statusCode: 400,
      statusMessage: 'draftData must use openexpert.mortgage-offer/2.0',
    })
  }
  const serialized = JSON.stringify(draftData)
  if (serialized.length > 1_000_000) {
    throw createError({ statusCode: 413, statusMessage: 'Mortgage offer draft is too large' })
  }
  return draftData
}

export interface MortgageBackofficeValidationIssue {
  kind: 'error'
  code: string
  path: string
  message: string
}

export function mortgageOfferDocumentationIssues(
  draftData: MortgageBackofficeRecord,
): MortgageBackofficeValidationIssue[] {
  const issues: MortgageBackofficeValidationIssue[] = []
  const documentation = asRecord(draftData.documentation)
  const requirements = Array.isArray(documentation.requirements) ? documentation.requirements : []
  const sources = Array.isArray(documentation.sources) ? documentation.sources : []
  const sourceKinds = new Set([
    'bank_tariff',
    'bank_product_page',
    'bank_terms',
    'bank_information_sheet',
    'regulation',
    'expert_note',
    'other',
  ])
  const sourceRoles = new Set(['pricing', 'eligibility', 'costs', 'documents', 'legal', 'general'])
  const codes = new Set<string>()
  const sourceIds = new Set(sources.flatMap((source) => {
    const id = asRecord(source).id
    return typeof id === 'string' && id ? [id] : []
  }))
  const features = Array.isArray(draftData.features) ? draftData.features.map(asRecord) : []
  const featureOptions = new Map(features.flatMap((feature) => {
    const featureId = typeof feature.id === 'string' ? feature.id : ''
    const options = Array.isArray(feature.options)
      ? feature.options.map(asRecord).flatMap(option => typeof option.id === 'string' ? [option.id] : [])
      : []
    return featureId ? [[featureId, new Set(options)] as const] : []
  }))

  const validateDocumentConditionSelections = (
    condition: DocumentSelectionCondition,
    path: string,
  ): void => {
    if (condition.op === 'selection_is') {
      if (!featureOptions.get(condition.featureId)?.has(condition.optionId)) {
        issues.push({
          kind: 'error',
          code: 'unknown_document_condition_selection',
          path,
          message: 'A document condition references an unknown offer feature option.',
        })
      }
      return
    }
    if (condition.op === 'not') return validateDocumentConditionSelections(condition.condition, `${path}.condition`)
    condition.conditions.forEach((child, index) => validateDocumentConditionSelections(child, `${path}.conditions.${index}`))
  }

  const validateEvidenceRefs = (value: unknown, path: string, required: boolean): void => {
    if (!Array.isArray(value) || (required && value.length === 0)) {
      if (required) issues.push({
        kind: 'error',
        code: 'missing_rule_evidence',
        path,
        message: 'This pricing rule requires at least one source reference before publication.',
      })
      return
    }
    for (const [index, rawReference] of value.entries()) {
      const reference = asRecord(rawReference)
      if (typeof reference.sourceId !== 'string' || !sourceIds.has(reference.sourceId)) {
        issues.push({
          kind: 'error',
          code: 'unknown_rule_evidence_source',
          path: `${path}.${index}.sourceId`,
          message: 'A pricing rule references a source that is not part of this offer.',
        })
      }
      if (typeof reference.locator === 'string' && reference.locator.length > 300) {
        issues.push({ kind: 'error', code: 'rule_evidence_locator_too_long', path: `${path}.${index}.locator`, message: 'A source locator may contain at most 300 characters.' })
      }
      if (typeof reference.note === 'string' && reference.note.length > 1_000) {
        issues.push({ kind: 'error', code: 'rule_evidence_note_too_long', path: `${path}.${index}.note`, message: 'A source note may contain at most 1,000 characters.' })
      }
    }
  }

  for (const [index, rawRequirement] of requirements.entries()) {
    const basePath = `documentation.requirements.${index}`
    const requirement = asRecord(rawRequirement)
    const validation = validateDocumentRequirement(rawRequirement)
    for (const issue of validation.issues) {
      issues.push({
        kind: 'error',
        code: issue.code,
        path: issue.path ? `${basePath}.${issue.path}` : basePath,
        message: issue.message,
      })
    }

    const code = typeof requirement.code === 'string' ? requirement.code.trim() : ''
    if (code && codes.has(code)) {
      issues.push({
        kind: 'error',
        code: 'duplicate_document_code',
        path: `${basePath}.code`,
        message: 'Document codes must be unique.',
      })
    }
    if (code) codes.add(code)
    if (validation.value?.when) {
      validateDocumentConditionSelections(validation.value.when, `${basePath}.when`)
    } else if (validation.value?.applicability === 'conditional') {
      issues.push({
        kind: 'error',
        code: 'missing_document_condition',
        path: `${basePath}.when`,
        message: 'A conditional document requires a machine-readable offer-variant condition.',
      })
    }
    validateEvidenceRefs(
      requirement.evidenceRefs,
      `${basePath}.evidenceRefs`,
      requirement.evidence === 'confirmed_bank_source',
    )
  }

  validateEvidenceRefs(asRecord(draftData.eligibility).evidenceRefs, 'eligibility.evidenceRefs', true)
  validateEvidenceRefs(asRecord(draftData.disbursementPolicy).evidenceRefs, 'disbursementPolicy.evidenceRefs', true)
  const ratePlan = asRecord(draftData.ratePlan)
  ;(Array.isArray(ratePlan.phases) ? ratePlan.phases : []).forEach((phase, index) => {
    validateEvidenceRefs(asRecord(phase).evidenceRefs, `ratePlan.phases.${index}.evidenceRefs`, true)
  })
  ;(Array.isArray(ratePlan.modifiers) ? ratePlan.modifiers : []).forEach((modifier, index) => {
    validateEvidenceRefs(asRecord(modifier).evidenceRefs, `ratePlan.modifiers.${index}.evidenceRefs`, true)
  })
  features.forEach((feature, index) => {
    validateEvidenceRefs(feature.evidenceRefs, `features.${index}.evidenceRefs`, true)
  })
  ;(Array.isArray(draftData.costs) ? draftData.costs : []).forEach((cost, index) => {
    const rule = asRecord(cost)
    validateEvidenceRefs(rule.evidenceRefs, `costs.${index}.evidenceRefs`, rule.state === 'known')
  })
  if (draftData.bridgeInsurance) {
    validateEvidenceRefs(asRecord(draftData.bridgeInsurance).evidenceRefs, 'bridgeInsurance.evidenceRefs', true)
  }

  if (!sources.length) {
    issues.push({
      kind: 'error',
      code: 'missing_offer_source',
      path: 'documentation.sources',
      message: 'At least one source document is required before publication.',
    })
  }
  if (sources.length > 50) {
    issues.push({
      kind: 'error',
      code: 'too_many_offer_sources',
      path: 'documentation.sources',
      message: 'An offer may contain at most 50 source documents.',
    })
  }
  for (const [index, rawSource] of sources.entries()) {
    const source = asRecord(rawSource)
    if (typeof source.id !== 'string' || !source.id || sources.some((candidate, candidateIndex) => (
      candidateIndex < index && asRecord(candidate).id === source.id
    ))) {
      issues.push({
        kind: 'error',
        code: typeof source.id === 'string' && source.id ? 'duplicate_offer_source_id' : 'missing_offer_source_id',
        path: `documentation.sources.${index}.id`,
        message: 'Every source requires a stable, unique id.',
      })
    }
    if (typeof source.title !== 'string' || !source.title.trim() || source.title.length > 300) {
      issues.push({
        kind: 'error',
        code: 'missing_offer_source_title',
        path: `documentation.sources.${index}.title`,
        message: 'A source title is required.',
      })
    }
    if (typeof source.kind !== 'string' || !sourceKinds.has(source.kind)) {
      issues.push({
        kind: 'error',
        code: 'invalid_offer_source_kind',
        path: `documentation.sources.${index}.kind`,
        message: 'A source must use a supported document kind.',
      })
    }
    if (typeof source.role !== 'string' || !sourceRoles.has(source.role)) {
      issues.push({
        kind: 'error',
        code: 'invalid_offer_source_role',
        path: `documentation.sources.${index}.role`,
        message: 'A source must declare which part of the offer it supports.',
      })
    }
    try {
      const rawUrl = typeof source.url === 'string' ? source.url : ''
      const url = new URL(rawUrl)
      if (rawUrl.length > 2_000 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Unsupported source URL')
      }
    } catch {
      issues.push({
        kind: 'error',
        code: 'invalid_offer_source_url',
        path: `documentation.sources.${index}.url`,
        message: 'A source must use a valid public HTTP or HTTPS URL.',
      })
    }
    if (typeof source.sha256 === 'string' && source.sha256 && !/^[0-9a-f]{64}$/iu.test(source.sha256)) {
      issues.push({
        kind: 'error',
        code: 'invalid_offer_source_sha256',
        path: `documentation.sources.${index}.sha256`,
        message: 'A source SHA-256 must contain 64 hexadecimal characters.',
      })
    }
    for (const dateKey of ['retrievedAt', 'publishedAt'] as const) {
      const value = source[dateKey]
      const required = dateKey === 'retrievedAt'
      const dateIsValid = typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}$/u.test(value)
        && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
        && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
      if ((required && !dateIsValid) || (!required && value != null && value !== '' && !dateIsValid)) {
        issues.push({
          kind: 'error',
          code: required && !value ? 'missing_offer_source_retrieved_at' : 'invalid_offer_source_date',
          path: `documentation.sources.${index}.${dateKey}`,
          message: required
            ? 'A source retrieval date is required and must use YYYY-MM-DD.'
            : 'A source date must use YYYY-MM-DD.',
        })
      }
    }
  }
  return issues
}

export async function materializeMortgageOfferSources(
  serviceRole: MortgageBackofficeClient,
  input: {
    bankId: string
    productId: string
    draftData: MortgageBackofficeRecord
  },
): Promise<MortgageBackofficeRecord> {
  const cloned = JSON.parse(JSON.stringify(input.draftData)) as MortgageBackofficeRecord
  const documentation = asRecord(cloned.documentation)
  const sources = Array.isArray(documentation.sources) ? documentation.sources : []
  const kindMap: Record<string, string> = {
    bank_tariff: 'pricing_table',
    bank_product_page: 'product_page',
    bank_terms: 'promotion_rules',
    bank_information_sheet: 'general_information',
    regulation: 'general_information',
    expert_note: 'other',
    other: 'other',
  }
  const materialized: MortgageBackofficeRecord[] = []

  for (const rawSource of sources) {
    const source = asRecord(rawSource)
    const sourceUrl = String(source.url)
    const normalizedSha256 = typeof source.sha256 === 'string' && source.sha256
      ? source.sha256.toLowerCase()
      : null
    const retrievedAt = `${String(source.retrievedAt)}T00:00:00.000Z`
    const sourceDocument = {
      title: String(source.title).trim(),
      source_url: sourceUrl,
      source_kind: kindMap[String(source.kind)] ?? 'other',
      sha256: normalizedSha256,
      retrieved_at: retrievedAt,
      published_at: typeof source.publishedAt === 'string' && source.publishedAt ? source.publishedAt : null,
    }
    // A source row referenced by an immutable version must never be overwritten
    // when a later draft points at the same URL with changed metadata/content.
    const sourceFingerprint = createHash('sha256')
      .update(JSON.stringify(sourceDocument))
      .digest('hex')
    const sourceKey = `backoffice:${input.productId}:${sourceFingerprint}`
    const { data: existingSource, error: existingSourceError } = await serviceRole
      .from('mortgage_source_documents')
      .select('id')
      .eq('source_key', sourceKey)
      .eq('bank_id', input.bankId)
      .eq('product_id', input.productId)
      .maybeSingle()
    throwMortgageBackofficeDbError(existingSourceError)

    let sourceDocumentId = existingSource?.id as string | undefined
    if (!sourceDocumentId) {
      const sourceRow = {
        source_key: sourceKey,
        bank_id: input.bankId,
        product_id: input.productId,
        ...sourceDocument,
        retrieval_status: 'downloaded',
        extraction_status: 'reviewed',
        facts: {
          managedBy: 'mortgage_offer_backoffice_v2',
          sourceKind: source.kind ?? 'other',
        },
        error_message: null,
      }
      const { data: insertedSource, error: insertSourceError } = await serviceRole
        .from('mortgage_source_documents')
        .insert(sourceRow)
        .select('id')
        .single()
      if (insertSourceError?.code === '23505') {
        const { data: racedSource, error: racedSourceError } = await serviceRole
          .from('mortgage_source_documents')
          .select('id')
          .eq('source_key', sourceKey)
          .single()
        throwMortgageBackofficeDbError(racedSourceError)
        sourceDocumentId = racedSource.id
      } else {
        throwMortgageBackofficeDbError(insertSourceError)
        sourceDocumentId = insertedSource.id
      }
    }
    materialized.push({ ...source, sourceDocumentId })
  }

  documentation.sources = materialized
  cloned.documentation = documentation
  return cloned
}

export type MortgageProductKind = 'mortgage' | 'home_equity'

export interface MortgageProductClassification {
  productKind: MortgageProductKind
  category: 'housing' | 'construction' | 'refinance' | 'eco' | 'family'
  /**
   * The existing creation RPC keeps its historic `p_category` signature. This
   * normalized alias lets it persist product kind and category atomically.
   */
  rpcCategory: string
}

export function mortgageProductClassification(
  categoryValue: unknown,
  productKindValue?: unknown,
): MortgageProductClassification {
  const rawCategory = String(categoryValue ?? '').trim().toLowerCase()
  const rawProductKind = String(productKindValue ?? '').trim().toLowerCase()
  const inferredKind = rawCategory === 'secured_loan' || rawCategory === 'home_equity'
    ? 'home_equity'
    : 'mortgage'
  const productKindAlias = rawProductKind === 'secured_loan' ? 'home_equity' : rawProductKind
  const productKind = (productKindAlias || inferredKind) as MortgageProductKind
  if (!['mortgage', 'home_equity'].includes(productKind)) {
    throw createError({ statusCode: 400, statusMessage: 'productKind is unsupported' })
  }

  const categoryAliases: Record<string, MortgageProductClassification['category']> = {
    mortgage: 'housing',
    secured_loan: 'housing',
    home_equity: 'housing',
  }
  const category = categoryAliases[rawCategory]
    ?? rawCategory as MortgageProductClassification['category']
  if (!['housing', 'construction', 'refinance', 'eco', 'family'].includes(category)) {
    throw createError({ statusCode: 400, statusMessage: 'category is unsupported' })
  }
  if (productKind === 'home_equity' && category !== 'housing') {
    throw createError({
      statusCode: 400,
      statusMessage: 'home_equity currently supports only the housing legacy category',
    })
  }

  return {
    productKind,
    category,
    rpcCategory: productKind === 'home_equity' ? 'home_equity' : category,
  }
}

export function mortgageProductCategory(value: unknown): string {
  return mortgageProductClassification(value).category
}

export function throwMortgageBackofficeDbError(
  error: { code?: string, message?: string, details?: string } | null | undefined,
  fallback = 'Mortgage backoffice database operation failed',
): void {
  if (!error) return
  if (error.code === '23505') {
    throw createError({ statusCode: 409, statusMessage: 'An offer with this code already exists for the institution' })
  }
  if (error.code === 'P0001' && /revision/i.test(error.message ?? '')) {
    throw createError({ statusCode: 409, statusMessage: 'The draft changed in another session' })
  }
  if (error.code === '40001') {
    throw createError({ statusCode: 409, statusMessage: 'The draft changed in another session' })
  }
  if (error.code === '23514') {
    throw createError({ statusCode: 422, statusMessage: error.message || 'Mortgage offer validation failed' })
  }
  if (error.code === 'P0002') {
    throw createError({ statusCode: 404, statusMessage: error.message || 'Mortgage offer not found' })
  }
  if (error.code === '55000' && /archived.*cannot_be_edited/iu.test(error.message ?? '')) {
    throw createError({ statusCode: 409, statusMessage: 'Archived offer cannot be edited' })
  }
  throw createError({ statusCode: 500, statusMessage: error.message || fallback })
}

export function mortgageOfferValidity(draftData: unknown): { validFrom: string | null, validTo: string | null } {
  const validity = asRecord(asRecord(draftData).validity)
  return {
    validFrom: typeof validity.effectiveFrom === 'string' ? validity.effectiveFrom : null,
    validTo: typeof validity.effectiveTo === 'string' ? validity.effectiveTo : null,
  }
}
