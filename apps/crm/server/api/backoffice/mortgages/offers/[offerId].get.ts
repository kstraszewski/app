import { createError } from 'h3'
import {
  mortgageBackofficeUuid,
  requireMortgageBackoffice,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import { mortgageLegacyVersionToDraft } from '~~/server/utils/mortgage-legacy-offer-draft'
import { getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const { backendData } = await requireMortgageBackoffice(event)
  const offerId = mortgageBackofficeUuid(getRequiredParam(event, 'offerId'), 'offerId')

  const { data: product, error: productError } = await backendData
    .from('mortgage_products')
    .select('id, bank_id, slug, name, product_kind, category, distribution_channel, is_active, current_published_version_id, archived_at, created_at, updated_at, mortgage_banks!inner(id, slug, name, logo_url)')
    .eq('id', offerId)
    .maybeSingle()
  throwMortgageBackofficeDbError(productError)
  if (!product) throw createError({ statusCode: 404, statusMessage: 'Mortgage offer not found' })

  const [
    { data: draft, error: draftError },
    { data: versions, error: versionsError },
    { data: templates, error: templatesError },
  ] = await Promise.all([
    backendData
      .from('mortgage_product_drafts')
      .select('id, revision, draft_data, validation_report, updated_at, updated_by_user_id')
      .eq('product_id', offerId)
      .maybeSingle(),
    backendData
      .from('mortgage_product_versions')
      .select('id, version_number, lifecycle_status, effective_from, effective_to, published_at')
      .eq('product_id', offerId)
      .order('version_number', { ascending: false }),
    backendData
      .from('mortgage_document_templates')
      .select('template_key, label, active_revision, source_file_id, source_file_version_id')
      .eq('bank_id', product.bank_id)
      .gt('active_revision', 0)
      .not('source_file_version_id', 'is', null)
      .order('label'),
  ])
  throwMortgageBackofficeDbError(draftError)
  throwMortgageBackofficeDbError(versionsError)
  throwMortgageBackofficeDbError(templatesError)

  let resolvedDraftData = draft?.draft_data ?? null
  let seededFromLegacy = false
  let seedWarnings: string[] = []
  if (!resolvedDraftData && product.current_published_version_id) {
    const { data: variant, error: variantError } = await backendData
      .from('mortgage_product_version_variants')
      .select('pricing_config')
      .eq('product_version_id', product.current_published_version_id)
      .eq('is_default', true)
      .maybeSingle()
    throwMortgageBackofficeDbError(variantError)
    const pricingConfig = variant?.pricing_config
    const isV2PricingConfig = pricingConfig
      && typeof pricingConfig === 'object'
      && !Array.isArray(pricingConfig)
      && pricingConfig.schemaVersion === 'openexpert.mortgage-offer/2.0'
    if (isV2PricingConfig) resolvedDraftData = pricingConfig
  }

  // Offers published before the V2 editor contain the flat calculator shape.
  // Convert it only for the editor preview; the immutable publication remains
  // unchanged until a SuperAdmin explicitly saves and publishes the V2 draft.
  if (!resolvedDraftData && product.current_published_version_id) {
    const { data: legacyVersion, error: legacyVersionError } = await backendData
      .from('mortgage_product_versions')
      .select('id, version_key, source_document_id, effective_from, effective_to, retrieved_at, calculation_date, interest_type, fixed_rate_pct, fixed_period_months, margin_pct, reference_rate_code, reference_rate_pct, reference_rate_as_of, min_amount, max_amount, min_term_months, max_term_months, max_ltv_pct, cost_rules, requirements, document_requirements, assumptions, unknown_fields, calculator_schema_version, calculator_engine_version')
      .eq('id', product.current_published_version_id)
      .maybeSingle()
    throwMortgageBackofficeDbError(legacyVersionError)

    if (legacyVersion && Number(legacyVersion.calculator_schema_version ?? 1) < 2) {
      let sourceDocument = null
      if (legacyVersion.source_document_id) {
        const { data: source, error: sourceError } = await backendData
          .from('mortgage_source_documents')
          .select('id, title, source_url, source_kind, sha256, retrieved_at, published_at')
          .eq('id', legacyVersion.source_document_id)
          .maybeSingle()
        throwMortgageBackofficeDbError(sourceError)
        sourceDocument = source
      }

      const seeded = mortgageLegacyVersionToDraft(legacyVersion, sourceDocument)
      resolvedDraftData = seeded.draftData
      seededFromLegacy = true
      seedWarnings = seeded.warnings
    }
  }

  const rawBank = Array.isArray(product.mortgage_banks)
    ? product.mortgage_banks[0]
    : product.mortgage_banks
  const hasDraft = Boolean(draft)
  const hasPublishedVersion = Boolean(product.current_published_version_id)
  const publicationStatus = product.archived_at
    ? 'archived'
    : hasPublishedVersion
      ? 'published'
      : 'draft'
  const status = publicationStatus

  return {
    data: {
      product: {
        id: product.id,
        bankId: product.bank_id,
        code: product.slug,
        name: product.name,
        slug: product.slug,
        productKind: product.product_kind,
        category: product.category,
        productType: product.category,
        currency: 'PLN',
        status,
        publicationStatus,
        hasPublishedVersion,
        hasDraft,
        createdAt: product.created_at,
        updatedAt: product.updated_at,
      },
      bank: rawBank
        ? { id: rawBank.id, slug: rawBank.slug, name: rawBank.name, logoUrl: rawBank.logo_url ?? null }
        : null,
      draft: {
        id: draft?.id ?? '',
        revision: Number(draft?.revision ?? 0),
        status: hasDraft ? 'draft' : status,
        draftData: resolvedDraftData ?? {},
        validationReport: draft?.validation_report ?? {},
        updatedAt: draft?.updated_at ?? null,
        updatedBy: draft?.updated_by_user_id ?? null,
        seededFromLegacy,
        seedWarnings,
      },
      versions: (versions ?? []).map((version: any) => ({
        id: version.id,
        revision: Number(version.version_number ?? 0),
        status: version.lifecycle_status,
        publishedAt: version.published_at,
        validFrom: version.effective_from,
        validTo: version.effective_to,
      })),
      templates: (templates ?? []).map((template: any) => ({
        id: String(template.template_key),
        label: String(template.label),
        revision: Number(template.active_revision ?? 0),
        sourceFileId: String(template.source_file_id),
        sourceFileVersionId: String(template.source_file_version_id),
      })),
    },
  }
})
