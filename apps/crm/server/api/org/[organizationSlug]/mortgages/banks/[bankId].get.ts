import { serverSupabaseServiceRole } from '#supabase/server'
import { createError } from 'h3'
import {
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

const logoBucket = 'mortgage-bank-logos'

type DatabaseRecord = Record<string, any>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function records(value: unknown): DatabaseRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as DatabaseRecord[]
    : []
}

function collectionSize(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') return Object.keys(value).length
  return 0
}

function validationIssueCount(value: unknown): number {
  const report = asRecord(value)
  if (Array.isArray(report.issues)) return report.issues.length
  if (Array.isArray(report.errors)) return report.errors.length
  return 0
}

function normalizeRequirement(value: unknown, index: number) {
  const requirement = asRecord(value)
  return {
    code: text(requirement.code) ?? `document-${index + 1}`,
    label: text(requirement.label) ?? 'Dokument bez nazwy',
    category: text(requirement.category) ?? 'other',
    itemKind: text(requirement.itemKind ?? requirement.item_kind) ?? 'client_document',
    scope: text(requirement.scope) ?? 'case',
    stage: text(requirement.stage) ?? 'analysis',
    applicability: text(requirement.applicability) ?? (requirement.required === false ? 'optional' : 'always'),
    evidence: text(requirement.evidence) ?? 'expert_default',
    required: requirement.required !== false,
    multiple: requirement.multiple === true,
    allowedMimeTypes: Array.isArray(requirement.allowedMimeTypes)
      ? requirement.allowedMimeTypes.filter((item): item is string => typeof item === 'string')
      : [],
    templateId: text(requirement.templateId),
    notes: text(requirement.notes),
  }
}

function normalizeRequirements(value: unknown) {
  return records(value).map(normalizeRequirement)
}

function draftConfiguration(value: unknown) {
  const draft = asRecord(value)
  const documentation = asRecord(draft.documentation)
  const ratePlan = asRecord(draft.ratePlan)
  const costs = records(draft.costs)
  return {
    checklist: normalizeRequirements(documentation.requirements),
    sourceCount: collectionSize(documentation.sources),
    costCount: costs.length,
    unknownCostCount: costs.filter(cost => cost.state === 'unknown').length,
    ratePhaseCount: collectionSize(ratePlan.phases),
    marginModifierCount: collectionSize(ratePlan.modifiers),
    featureCount: collectionSize(draft.features),
    variantCount: collectionSize(draft.presets),
    hasBridgeInsurance: Boolean(draft.bridgeInsurance),
  }
}

function versionSummary(version: DatabaseRecord | undefined) {
  if (!version) return null
  return {
    id: String(version.id),
    revision: Number(version.version_number ?? 0),
    lifecycleStatus: String(version.lifecycle_status ?? 'published'),
    validFrom: text(version.effective_from),
    validTo: text(version.effective_to),
    dataStatus: text(version.data_status),
    completenessScore: number(version.completeness_score),
    interestType: text(version.interest_type),
    fixedRatePct: number(version.fixed_rate_pct),
    fixedPeriodMonths: number(version.fixed_period_months),
    marginPct: number(version.margin_pct),
    referenceRateCode: text(version.reference_rate_code),
    referenceRatePct: number(version.reference_rate_pct),
    referenceRateAsOf: text(version.reference_rate_as_of),
    representativeAprPct: number(version.representative_apr_pct),
    unknownFields: Array.isArray(version.unknown_fields)
      ? version.unknown_fields.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    checklistCount: normalizeRequirements(version.document_requirements).length,
    costRuleCount: collectionSize(version.cost_rules),
    requirementRuleCount: collectionSize(version.requirements),
    publishedAt: text(version.published_at),
    retiredAt: text(version.retired_at),
    retrievedAt: text(version.retrieved_at),
    updatedAt: text(version.updated_at),
  }
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const serviceRole = serverSupabaseServiceRole(event) as any

  const [bankResult, overrideResult, productsResult, sourcesResult, revisionsResult] = await Promise.all([
    serviceRole
      .from('mortgage_banks')
      .select('id, slug, name, website_url, logo_url, logo_background_color, created_at, updated_at')
      .eq('id', bankId)
      .maybeSingle(),
    serviceRole
      .from('mortgage_bank_overrides')
      .select('id, is_enabled, custom_name, custom_website_url, logo_path, notes, revision, created_at, updated_at, created_by, updated_by')
      .eq('organization_id', session.organizationId)
      .eq('bank_id', bankId)
      .maybeSingle(),
    serviceRole
      .from('mortgage_products')
      .select('id, bank_id, slug, name, category, distribution_channel, is_active, current_published_version_id, revision, archived_at, created_at, updated_at, created_by_user_id, updated_by_user_id')
      .eq('bank_id', bankId)
      .order('name'),
    serviceRole
      .from('mortgage_source_documents')
      .select('id, product_id, title, source_url, source_kind, mime_type, sha256, retrieved_at, published_at, retrieval_status, extraction_status, error_message, created_at, updated_at')
      .eq('bank_id', bankId)
      .order('retrieved_at', { ascending: false }),
    serviceRole
      .from('mortgage_bank_override_revisions')
      .select('id, revision, action, is_enabled, custom_name, custom_website_url, logo_path, notes, changed_by, created_at')
      .eq('organization_id', session.organizationId)
      .eq('bank_id', bankId)
      .order('created_at', { ascending: false }),
  ])
  throwMortgageBackofficeDbError(bankResult.error)
  throwMortgageBackofficeDbError(overrideResult.error)
  throwMortgageBackofficeDbError(productsResult.error)
  throwMortgageBackofficeDbError(sourcesResult.error)
  throwMortgageBackofficeDbError(revisionsResult.error)

  if (!bankResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Financial institution not found' })
  }

  const bank = bankResult.data as DatabaseRecord
  const override = overrideResult.data as DatabaseRecord | null
  const products = (productsResult.data ?? []) as DatabaseRecord[]
  const sources = (sourcesResult.data ?? []) as DatabaseRecord[]
  const revisions = (revisionsResult.data ?? []) as DatabaseRecord[]
  const productIds = products.map(product => String(product.id))

  const [draftsResult, versionsResult, productOverridesResult] = productIds.length
    ? await Promise.all([
        serviceRole
          .from('mortgage_product_drafts')
          .select('id, product_id, base_version_id, revision, draft_data, validation_report, created_at, updated_at, created_by_user_id, updated_by_user_id')
          .in('product_id', productIds),
        serviceRole
          .from('mortgage_product_versions')
          .select('id, product_id, version_number, lifecycle_status, effective_from, effective_to, data_status, completeness_score, interest_type, fixed_rate_pct, fixed_period_months, margin_pct, reference_rate_code, reference_rate_pct, reference_rate_as_of, representative_apr_pct, cost_rules, requirements, unknown_fields, document_requirements, published_at, retired_at, retrieved_at, updated_at')
          .in('product_id', productIds)
          .order('version_number', { ascending: false }),
        serviceRole
          .from('mortgage_product_overrides')
          .select('id, product_id, is_enabled, custom_name, notes, revision, created_at, updated_at')
          .eq('organization_id', session.organizationId)
          .in('product_id', productIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
  throwMortgageBackofficeDbError(draftsResult.error)
  throwMortgageBackofficeDbError(versionsResult.error)
  throwMortgageBackofficeDbError(productOverridesResult.error)

  const drafts = (draftsResult.data ?? []) as DatabaseRecord[]
  const versions = (versionsResult.data ?? []) as DatabaseRecord[]
  const productOverrides = (productOverridesResult.data ?? []) as DatabaseRecord[]
  const versionIds = versions.map(version => String(version.id))
  const { data: versionSources, error: versionSourcesError } = versionIds.length
    ? await serviceRole
        .from('mortgage_product_version_sources')
        .select('product_version_id, source_document_id, source_role, created_at')
        .in('product_version_id', versionIds)
    : { data: [], error: null }
  throwMortgageBackofficeDbError(versionSourcesError)

  const actorIds = [...new Set(revisions
    .map(revision => text(revision.changed_by))
    .filter((value): value is string => Boolean(value)))]
  const { data: actors, error: actorsError } = actorIds.length
    ? await serviceRole.from('users').select('id, full_name, email').in('id', actorIds)
    : { data: [], error: null }
  throwMortgageBackofficeDbError(actorsError)

  const actorById = new Map<string, DatabaseRecord>(
    ((actors ?? []) as DatabaseRecord[]).map(actor => [String(actor.id), actor]),
  )
  const draftByProduct = new Map(drafts.map(draft => [String(draft.product_id), draft]))
  const versionById = new Map(versions.map(version => [String(version.id), version]))
  const versionsByProduct = new Map<string, DatabaseRecord[]>()
  const productById = new Map(products.map(product => [String(product.id), product]))
  const productOverrideByProduct = new Map(productOverrides.map(productOverride => [String(productOverride.product_id), productOverride]))
  const sourcesByProduct = new Map<string, DatabaseRecord[]>()
  const linksBySource = new Map<string, DatabaseRecord[]>()

  for (const version of versions) {
    const productId = String(version.product_id)
    versionsByProduct.set(productId, [...(versionsByProduct.get(productId) ?? []), version])
  }
  for (const source of sources) {
    if (!source.product_id) continue
    const productId = String(source.product_id)
    sourcesByProduct.set(productId, [...(sourcesByProduct.get(productId) ?? []), source])
  }
  for (const link of versionSources ?? []) {
    const sourceId = String(link.source_document_id)
    linksBySource.set(sourceId, [...(linksBySource.get(sourceId) ?? []), link])
  }

  const offers = products.map((product) => {
    const productId = String(product.id)
    const productOverride = productOverrideByProduct.get(productId)
    const draft = draftByProduct.get(productId)
    const draftConfig = draftConfiguration(draft?.draft_data)
    const currentVersion = versionById.get(String(product.current_published_version_id ?? ''))
    const publishedChecklist = normalizeRequirements(currentVersion?.document_requirements)
    const productVersions = versionsByProduct.get(productId) ?? []
    const hasPublishedVersion = Boolean(currentVersion)
    const publicationStatus = product.archived_at
      ? 'archived'
      : hasPublishedVersion
        ? 'published'
        : 'draft'
    const today = new Date().toISOString().slice(0, 10)
    const organizationEnabled = productOverride?.is_enabled ?? true
    const versionIsEffective = Boolean(currentVersion)
      && currentVersion?.lifecycle_status === 'published'
      && (!currentVersion.effective_from || String(currentVersion.effective_from) <= today)
      && (!currentVersion.effective_to || String(currentVersion.effective_to) >= today)
    const liveInCalculator = Boolean(
      (override?.is_enabled ?? true)
      && product.is_active !== false
      && organizationEnabled
      && !product.archived_at
      && versionIsEffective,
    )

    return {
      id: productId,
      code: String(product.slug ?? ''),
      slug: String(product.slug ?? ''),
      name: text(productOverride?.custom_name) ?? String(product.name ?? 'Oferta hipoteczna'),
      baseName: String(product.name ?? 'Oferta hipoteczna'),
      category: String(product.category ?? 'housing'),
      distributionChannel: String(product.distribution_channel ?? 'all'),
      isActive: product.is_active !== false,
      organizationEnabled,
      liveInCalculator,
      publicationStatus,
      hasPublishedVersion,
      hasDraft: Boolean(draft),
      revision: Number(product.revision ?? 0),
      archivedAt: text(product.archived_at),
      createdAt: text(product.created_at),
      updatedAt: text(draft?.updated_at ?? product.updated_at),
      currentVersion: versionSummary(currentVersion),
      versions: productVersions.map(versionSummary).filter(Boolean),
      publishedChecklist,
      draft: draft
        ? {
            id: String(draft.id),
            revision: Number(draft.revision ?? 0),
            baseVersionId: text(draft.base_version_id),
            validationIssueCount: validationIssueCount(draft.validation_report),
            updatedAt: text(draft.updated_at),
            configuration: draftConfig,
          }
        : null,
      sourceCount: (sourcesByProduct.get(productId) ?? []).length,
      organizationOverride: productOverride
        ? {
            id: String(productOverride.id),
            revision: Number(productOverride.revision ?? 0),
            isEnabled: productOverride.is_enabled !== false,
            customName: text(productOverride.custom_name),
            notes: text(productOverride.notes),
            updatedAt: text(productOverride.updated_at),
          }
        : null,
    }
  })

  const currentVersions = offers.flatMap(offer => offer.currentVersion ? [offer.currentVersion] : [])
  const completenessValues = currentVersions
    .map(version => version.completenessScore)
    .filter((value): value is number => value !== null)
  const averageCompleteness = completenessValues.length
    ? Math.round(completenessValues.reduce((sum, value) => sum + value, 0) / completenessValues.length)
    : null
  const publishedChecklistCount = offers.reduce((sum, offer) => sum + offer.publishedChecklist.length, 0)
  const draftChecklistCount = offers.reduce(
    (sum, offer) => sum + (offer.draft?.configuration.checklist.length ?? 0),
    0,
  )

  const logoUrl = override?.logo_path
    ? session.supabase.storage.from(logoBucket).getPublicUrl(String(override.logo_path)).data.publicUrl
    : text(bank.logo_url)

  return {
    role: session.role,
    superAdmin: true,
    bank: {
      id: String(bank.id),
      slug: String(bank.slug),
      name: text(override?.custom_name) ?? String(bank.name),
      baseName: String(bank.name),
      websiteUrl: text(override?.custom_website_url) ?? text(bank.website_url),
      baseWebsiteUrl: text(bank.website_url),
      logoUrl,
      baseLogoUrl: text(bank.logo_url),
      logoBackground: override?.logo_path ? null : text(bank.logo_background_color),
      isEnabled: override?.is_enabled ?? true,
      notes: text(override?.notes),
      createdAt: text(bank.created_at),
      updatedAt: text(override?.updated_at ?? bank.updated_at),
      override: override
        ? {
            id: String(override.id),
            revision: Number(override.revision ?? 0),
            isEnabled: override.is_enabled !== false,
            customName: text(override.custom_name),
            customWebsiteUrl: text(override.custom_website_url),
            hasCustomLogo: Boolean(override.logo_path),
            notes: text(override.notes),
            createdAt: text(override.created_at),
            updatedAt: text(override.updated_at),
          }
        : null,
    },
    metrics: {
      offers: offers.length,
      publishedOffers: offers.filter(offer => offer.publicationStatus === 'published').length,
      liveOffers: offers.filter(offer => offer.liveInCalculator).length,
      draftOffers: offers.filter(offer => offer.hasDraft && offer.publicationStatus !== 'archived').length,
      archivedOffers: offers.filter(offer => offer.publicationStatus === 'archived').length,
      versions: versions.length,
      sourceDocuments: sources.length,
      reviewedSourceDocuments: sources.filter(source => source.extraction_status === 'reviewed').length,
      publishedChecklistItems: publishedChecklistCount,
      draftChecklistItems: draftChecklistCount,
      unknownFields: currentVersions.reduce((sum, version) => sum + version.unknownFields.length, 0),
      averageCompleteness,
    },
    offers,
    sources: sources.map((source) => ({
      id: String(source.id),
      productId: text(source.product_id),
      productName: text(productById.get(String(source.product_id ?? ''))?.name),
      title: String(source.title ?? 'Dokument źródłowy'),
      url: text(source.source_url),
      kind: String(source.source_kind ?? 'other'),
      mimeType: text(source.mime_type),
      sha256: text(source.sha256),
      retrievedAt: text(source.retrieved_at),
      publishedAt: text(source.published_at),
      retrievalStatus: String(source.retrieval_status ?? 'pending'),
      extractionStatus: String(source.extraction_status ?? 'pending'),
      errorMessage: text(source.error_message),
      links: (linksBySource.get(String(source.id)) ?? []).map((link) => {
        const version = versionById.get(String(link.product_version_id))
        const linkedProduct = version ? productById.get(String(version.product_id)) : undefined
        return {
          productVersionId: String(link.product_version_id),
          productId: version ? String(version.product_id) : null,
          productName: text(linkedProduct?.name),
          versionNumber: version ? Number(version.version_number ?? 0) : null,
          role: String(link.source_role ?? 'primary'),
        }
      }),
    })),
    history: revisions.map((revision) => {
      const actor = actorById.get(String(revision.changed_by))
      return {
        id: String(revision.id),
        revision: Number(revision.revision ?? 0),
        action: String(revision.action ?? 'updated'),
        isEnabled: revision.is_enabled !== false,
        customName: text(revision.custom_name),
        customWebsiteUrl: text(revision.custom_website_url),
        notes: text(revision.notes),
        createdAt: text(revision.created_at),
        actor: actor
          ? {
              id: String(actor.id),
              name: text(actor.full_name),
              email: text(actor.email),
            }
          : null,
      }
    }),
  }
})
