import { createError } from 'h3'
import { throwDbError, type CrmSession } from './crm'
import { resolveMortgageBankLogoUrl } from './openexpert-mock-bank-brand'

const logoBucket = 'mortgage-bank-logos'

export const mortgageOverrideParameterKeys = [
  'effective_from',
  'effective_to',
  'calculation_date',
  'data_status',
  'completeness_score',
  'interest_type',
  'fixed_rate_pct',
  'fixed_period_months',
  'margin_pct',
  'reference_rate_code',
  'reference_rate_pct',
  'reference_rate_as_of',
  'representative_apr_pct',
  'min_amount',
  'max_amount',
  'min_term_months',
  'max_term_months',
  'max_ltv_pct',
  'is_eco',
  'cost_rules',
  'requirements',
  'document_requirements',
  'multiform_template_ids',
  'representative_example',
  'assumptions',
  'unknown_fields',
] as const

type MortgageOverrideParameterKey = typeof mortgageOverrideParameterKeys[number]
type JsonRecord = Record<string, unknown>

const parameterKeySet = new Set<string>(mortgageOverrideParameterKeys)
const dateKeys = ['effective_from', 'effective_to', 'calculation_date', 'reference_rate_as_of'] as const
const nullableNumberRules: Record<string, { min: number, max: number, integer?: boolean }> = {
  fixed_rate_pct: { min: 0, max: 100 },
  fixed_period_months: { min: 1, max: 600, integer: true },
  margin_pct: { min: -20, max: 100 },
  reference_rate_pct: { min: -20, max: 100 },
  representative_apr_pct: { min: 0, max: 100 },
  min_amount: { min: 0, max: 1_000_000_000 },
  max_amount: { min: 0, max: 1_000_000_000 },
  min_term_months: { min: 1, max: 600, integer: true },
  max_term_months: { min: 1, max: 600, integer: true },
  max_ltv_pct: { min: 0, max: 200 },
}
const costRuleKeys = new Set([
  'commissionPct',
  'appraisalFee',
  'pccFee',
  'courtFee',
  'accountMonthlyFee',
  'cardMonthlyFee',
  'propertyInsuranceAnnualRatePct',
  'lifeInsuranceMonthlyRatePct',
  'lifeInsuranceMonths',
])
const documentRequirementKeys = new Set([
  'code',
  'label',
  'category',
  'itemKind',
  'scope',
  'stage',
  'applicability',
  'evidence',
  'required',
  'multiple',
  'allowedMimeTypes',
  'templateId',
  'notes',
])
const documentRequirementItemKinds = new Set([
  'client_document',
  'bank_document',
  'external_check',
  'manual_action',
])
const documentRequirementCategories = new Set([
  'application',
  'identity',
  'income_employment',
  'income_business',
  'income_other',
  'liabilities',
  'transaction',
  'property_legal',
  'valuation',
  'construction_renovation',
  'refinance_discharge',
  'insurance_security',
  'disbursement',
  'disclosure_privacy',
  'other',
])
const documentRequirementScopes = new Set([
  'case',
  'primary_applicant',
  'each_applicant',
])
const documentRequirementStages = new Set([
  'analysis',
  'agreement',
  'disbursement',
  'tranche',
  'maintenance',
])
const documentRequirementApplicability = new Set([
  'always',
  'conditional',
  'optional',
  'case_requested',
])
const documentRequirementEvidence = new Set([
  'confirmed_bank_source',
  'inferred',
  'expert_default',
  'organization_custom',
])
const allowedDocumentMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
])
const identifierPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

function recordValue(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an object` })
  }
  return value as JsonRecord
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a finite number` })
  }
  return parsed
}

function nullableText(value: unknown, field: string, maxLength = 200): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text or null` })
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }
  return trimmed
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a list with at most 100 entries` })
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim() || entry.trim().length > 500) {
      throw createError({ statusCode: 400, statusMessage: `${field} contains an invalid entry` })
    }
    return entry.trim()
  })
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text` })
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  }
  return trimmed
}

function identifier(value: unknown, field: string, maxLength = 100): string {
  const parsed = requiredText(value, field, maxLength)
  if (!identifierPattern.test(parsed)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a lowercase identifier using letters, numbers, dots, dashes or underscores`,
    })
  }
  return parsed
}

function enumValue(value: unknown, allowed: Set<string>, field: string): string {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} is unsupported` })
  }
  return value
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be boolean` })
  }
  return value
}

function sanitizeMultiformTemplateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw createError({
      statusCode: 400,
      statusMessage: 'multiform_template_ids must be a list with at most 50 entries',
    })
  }

  const identifiers = value.map((entry, index) => (
    identifier(entry, `multiform_template_ids[${index}]`, 120)
  ))
  if (new Set(identifiers).size !== identifiers.length) {
    throw createError({ statusCode: 400, statusMessage: 'multiform_template_ids contains duplicates' })
  }
  return identifiers
}

function sanitizeAllowedMimeTypes(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > allowedDocumentMimeTypes.size) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a MIME type list` })
  }
  const result = value.map((entry) => {
    if (typeof entry !== 'string' || !allowedDocumentMimeTypes.has(entry)) {
      throw createError({ statusCode: 400, statusMessage: `${field} contains an unsupported MIME type` })
    }
    return entry
  })
  if (new Set(result).size !== result.length) {
    throw createError({ statusCode: 400, statusMessage: `${field} contains duplicates` })
  }
  return result
}

function sanitizeDocumentRequirements(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: 'document_requirements must be a list with at most 100 entries',
    })
  }

  const codes = new Set<string>()
  return value.map((entry, index) => {
    const field = `document_requirements[${index}]`
    const source = recordValue(entry, field)
    const unknownKeys = Object.keys(source).filter(key => !documentRequirementKeys.has(key))
    if (unknownKeys.length) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} contains unsupported fields: ${unknownKeys.join(', ')}`,
      })
    }

    const code = identifier(source.code, `${field}.code`, 100)
    if (codes.has(code)) {
      throw createError({ statusCode: 400, statusMessage: `Duplicate document requirement code: ${code}` })
    }
    codes.add(code)

    const itemKind = enumValue(source.itemKind, documentRequirementItemKinds, `${field}.itemKind`)
    const allowedMimeTypes = sanitizeAllowedMimeTypes(source.allowedMimeTypes, `${field}.allowedMimeTypes`)
    if (itemKind === 'client_document' && allowedMimeTypes.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field}.allowedMimeTypes must not be empty for a client document`,
      })
    }

    const result: JsonRecord = {
      code,
      label: requiredText(source.label, `${field}.label`, 200),
      category: enumValue(source.category, documentRequirementCategories, `${field}.category`),
      itemKind,
      scope: enumValue(source.scope, documentRequirementScopes, `${field}.scope`),
      stage: enumValue(source.stage, documentRequirementStages, `${field}.stage`),
      applicability: enumValue(source.applicability, documentRequirementApplicability, `${field}.applicability`),
      evidence: enumValue(source.evidence, documentRequirementEvidence, `${field}.evidence`),
      required: booleanValue(source.required, `${field}.required`),
      multiple: booleanValue(source.multiple, `${field}.multiple`),
      allowedMimeTypes,
    }

    if ('templateId' in source && source.templateId !== null && source.templateId !== '') {
      if (itemKind !== 'bank_document') {
        throw createError({
          statusCode: 400,
          statusMessage: `${field}.templateId is supported only for a bank document`,
        })
      }
      result.templateId = identifier(source.templateId, `${field}.templateId`, 120)
    }
    if ('notes' in source && source.notes !== null && source.notes !== '') {
      result.notes = requiredText(source.notes, `${field}.notes`, 1_000)
    }
    return result
  })
}

function sanitizeCostRules(value: unknown): JsonRecord {
  const source = recordValue(value, 'cost_rules')
  const result: JsonRecord = {}
  for (const [key, rawValue] of Object.entries(source)) {
    if (!costRuleKeys.has(key)) {
      throw createError({ statusCode: 400, statusMessage: `Unsupported cost rule: ${key}` })
    }
    if (rawValue === null || rawValue === '') {
      result[key] = null
      continue
    }
    const parsed = finiteNumber(rawValue, `cost_rules.${key}`)
    if (parsed < 0 || parsed > 1_000_000_000 || (key === 'lifeInsuranceMonths' && !Number.isInteger(parsed))) {
      throw createError({ statusCode: 400, statusMessage: `cost_rules.${key} is outside the allowed range` })
    }
    result[key] = parsed
  }
  return result
}

export function sanitizeMortgageOverrideParameters(value: unknown): Record<MortgageOverrideParameterKey, unknown> | JsonRecord {
  const source = recordValue(value ?? {}, 'parameters')
  const unknownKeys = Object.keys(source).filter(key => !parameterKeySet.has(key))
  if (unknownKeys.length) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported mortgage parameters: ${unknownKeys.join(', ')}` })
  }

  const result: JsonRecord = {}
  for (const key of dateKeys) {
    if (!(key in source)) continue
    const parsed = nullableText(source[key], key, 10)
    if (parsed !== null && !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
      throw createError({ statusCode: 400, statusMessage: `${key} must use YYYY-MM-DD` })
    }
    result[key] = parsed
  }

  if ('data_status' in source) {
    if (!['confirmed', 'inferred', 'draft'].includes(String(source.data_status))) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported data_status' })
    }
    result.data_status = source.data_status
  }
  if ('interest_type' in source) {
    if (!['fixed_periodic', 'variable'].includes(String(source.interest_type))) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported interest_type' })
    }
    result.interest_type = source.interest_type
  }
  if ('completeness_score' in source) {
    const parsed = finiteNumber(source.completeness_score, 'completeness_score')
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      throw createError({ statusCode: 400, statusMessage: 'completeness_score must be an integer from 0 to 100' })
    }
    result.completeness_score = parsed
  }
  if ('is_eco' in source) {
    if (typeof source.is_eco !== 'boolean') {
      throw createError({ statusCode: 400, statusMessage: 'is_eco must be boolean' })
    }
    result.is_eco = source.is_eco
  }

  for (const [key, rule] of Object.entries(nullableNumberRules)) {
    if (!(key in source)) continue
    if (source[key] === null || source[key] === '') {
      result[key] = null
      continue
    }
    const parsed = finiteNumber(source[key], key)
    if (parsed < rule.min || parsed > rule.max || (rule.integer && !Number.isInteger(parsed))) {
      throw createError({ statusCode: 400, statusMessage: `${key} is outside the allowed range` })
    }
    result[key] = parsed
  }

  if ('reference_rate_code' in source) {
    result.reference_rate_code = nullableText(source.reference_rate_code, 'reference_rate_code', 40)
  }
  if ('cost_rules' in source) result.cost_rules = sanitizeCostRules(source.cost_rules)
  if ('requirements' in source) result.requirements = stringList(source.requirements, 'requirements')
  if ('document_requirements' in source) result.document_requirements = sanitizeDocumentRequirements(source.document_requirements)
  const referencedTemplateIds = Array.isArray(result.document_requirements)
    ? result.document_requirements.flatMap((entry) => {
        const templateId = (entry as JsonRecord).templateId
        return typeof templateId === 'string' ? [templateId] : []
      })
    : []
  if ('multiform_template_ids' in source || referencedTemplateIds.length) {
    const configured = 'multiform_template_ids' in source
      ? sanitizeMultiformTemplateIds(source.multiform_template_ids)
      : []
    result.multiform_template_ids = [...new Set([...configured, ...referencedTemplateIds])]
  }
  if ('assumptions' in source) result.assumptions = stringList(source.assumptions, 'assumptions')
  if ('unknown_fields' in source) result.unknown_fields = stringList(source.unknown_fields, 'unknown_fields')
  if ('representative_example' in source) {
    const example = recordValue(source.representative_example, 'representative_example')
    if (JSON.stringify(example).length > 20_000) {
      throw createError({ statusCode: 400, statusMessage: 'representative_example is too large' })
    }
    result.representative_example = example
  }

  return result
}

export function mergeMortgageVersion(baseVersion: JsonRecord, parameters: unknown): JsonRecord {
  const safeParameters = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? parameters as JsonRecord
    : {}
  return { ...baseVersion, ...safeParameters }
}

export async function loadMortgageCatalog(
  session: CrmSession,
  options: { includeDisabled?: boolean, includeMock?: boolean } = {},
): Promise<{ products: JsonRecord[], retrievedAt: string | null }> {
  const today = new Date().toISOString().slice(0, 10)
  const { data: products, error: productError } = await session.dataApi
    .from('mortgage_products')
    .select('id, slug, name, category, bank_id, current_published_version_id, mortgage_banks!inner(id, slug, name, website_url, logo_url, logo_background_color, is_mock)')
    .eq('is_active', true)
    .order('name')
  throwDbError(productError)

  const productIds = (products ?? []).map((product: any) => product.id)
  if (!productIds.length) return { products: [], retrievedAt: null }

  const bankIds = [...new Set((products ?? []).map((product: any) => product.bank_id))]
  const { data: versions, error: versionError } = await session.dataApi
    .from('mortgage_product_versions')
    .select('*')
    .in('product_id', productIds)
    .eq('lifecycle_status', 'published')
    .order('retrieved_at', { ascending: false })
  throwDbError(versionError)

  const sourceIds = [...new Set((versions ?? [])
    .map((version: any) => version.source_document_id)
    .filter(Boolean))]
  const { data: sources, error: sourceError } = sourceIds.length
    ? await session.dataApi
        .from('mortgage_source_documents')
        .select('id, title, source_url, source_kind, sha256, storage_path, retrieved_at, published_at, retrieval_status, extraction_status')
        .in('id', sourceIds)
    : { data: [], error: null }
  throwDbError(sourceError)

  const [{ data: overrides, error: overrideError }, { data: bankOverrides, error: bankOverrideError }] = await Promise.all([
    session.dataApi
      .from('mortgage_product_overrides')
      .select('id, product_id, is_enabled, custom_name, parameters, notes, revision, created_at, updated_at, created_by, updated_by')
      .eq('organization_id', session.organizationId)
      .in('product_id', productIds),
    session.dataApi
      .from('mortgage_bank_overrides')
      .select('id, bank_id, is_enabled, custom_name, custom_website_url, logo_path, revision, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .in('bank_id', bankIds),
  ])
  throwDbError(overrideError)
  throwDbError(bankOverrideError)

  const sourceById = new Map((sources ?? []).map((source: any) => [source.id, source]))
  const overrideByProduct = new Map((overrides ?? []).map((override: any) => [override.product_id, override]))
  const overrideByBank = new Map((bankOverrides ?? []).map((override: any) => [override.bank_id, override]))
  const versionById = new Map((versions ?? []).map((version: any) => [version.id, version]))
  const latestByProduct = new Map<string, any>()
  for (const product of products ?? []) {
    const pointed = versionById.get((product as any).current_published_version_id)
    if (pointed) latestByProduct.set((product as any).id, pointed)
  }
  for (const version of versions ?? []) {
    if (!latestByProduct.has(version.product_id)) latestByProduct.set(version.product_id, version)
  }

  const selectedVersionIds = [...new Set([...latestByProduct.values()].map(version => version.id))]
  const { data: variants, error: variantError } = selectedVersionIds.length
    ? await session.dataApi
        .from('mortgage_product_version_variants')
        .select('id, product_version_id, code, name, is_default, calculation_readiness, pricing_config, eligibility_config')
        .in('product_version_id', selectedVersionIds)
        .order('sort_order')
    : { data: [], error: null }
  throwDbError(variantError)
  const defaultVariantByVersion = new Map<string, any>()
  for (const variant of variants ?? []) {
    if (variant.is_default || !defaultVariantByVersion.has(variant.product_version_id)) {
      defaultVariantByVersion.set(variant.product_version_id, variant)
    }
  }

  return {
    retrievedAt: versions?.[0]?.retrieved_at ?? null,
    products: (products ?? []).flatMap((product: any) => {
      const version = latestByProduct.get(product.id)
      if (!version) return []
      if (version.effective_from && version.effective_from > today) return []
      if (version.effective_to && version.effective_to < today) return []
      const override = overrideByProduct.get(product.id) as any
      const bankOverride = overrideByBank.get(product.bank_id) as any
      if (bankOverride?.is_enabled === false && !options.includeDisabled) return []
      if (override?.is_enabled === false && !options.includeDisabled) return []
      const rawBank = Array.isArray(product.mortgage_banks)
        ? product.mortgage_banks[0]
        : product.mortgage_banks
      if (rawBank?.is_mock === true && !options.includeMock) return []
      const source = sourceById.get(version.source_document_id) ?? null
      const variant = defaultVariantByVersion.get(version.id) ?? null
      const baseVersion = {
        ...version,
        source,
        variant,
        offer_definition: variant?.pricing_config ?? null,
        calculation_readiness: variant?.calculation_readiness ?? 'partial',
      }
      const logoUrl = bankOverride?.logo_path
        ? session.dataApi.storage.from(logoBucket).getPublicUrl(bankOverride.logo_path).data.publicUrl
        : resolveMortgageBankLogoUrl(rawBank.slug, rawBank.logo_url)
      return [{
        id: product.id,
        slug: product.slug,
        name: override?.custom_name ?? product.name,
        baseName: product.name,
        category: product.category,
        bank: {
          ...rawBank,
          name: bankOverride?.custom_name ?? rawBank.name,
          website_url: bankOverride?.custom_website_url ?? rawBank.website_url,
          baseName: rawBank.name,
          baseWebsiteUrl: rawBank.website_url,
          isMock: rawBank.is_mock === true,
          isEnabled: bankOverride?.is_enabled ?? true,
          logoUrl,
          logoBackground: bankOverride?.logo_path ? null : rawBank.logo_background_color,
          override: bankOverride ?? null,
        },
        isEnabled: override?.is_enabled ?? true,
        version: Number(version.calculator_schema_version ?? 1) >= 2
          ? baseVersion
          : mergeMortgageVersion(baseVersion, override?.parameters),
        baseVersion,
        override: override ?? null,
      }]
    }),
  }
}
