import { createError } from 'h3'
import {
  mortgageBackofficeUuid,
  requireMortgageBackoffice,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import { getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const { serviceRole } = await requireMortgageBackoffice(event)
  const offerId = mortgageBackofficeUuid(getRequiredParam(event, 'offerId'), 'offerId')

  const { data: product, error: productError } = await serviceRole
    .from('mortgage_products')
    .select('id, bank_id, slug, name, category, distribution_channel, is_active, current_published_version_id, archived_at, created_at, updated_at, mortgage_banks!inner(id, slug, name, logo_url)')
    .eq('id', offerId)
    .maybeSingle()
  throwMortgageBackofficeDbError(productError)
  if (!product) throw createError({ statusCode: 404, statusMessage: 'Mortgage offer not found' })

  const [{ data: draft, error: draftError }, { data: versions, error: versionsError }] = await Promise.all([
    serviceRole
      .from('mortgage_product_drafts')
      .select('id, revision, draft_data, validation_report, updated_at, updated_by_user_id')
      .eq('product_id', offerId)
      .maybeSingle(),
    serviceRole
      .from('mortgage_product_versions')
      .select('id, version_number, lifecycle_status, effective_from, effective_to, published_at')
      .eq('product_id', offerId)
      .order('version_number', { ascending: false }),
  ])
  throwMortgageBackofficeDbError(draftError)
  throwMortgageBackofficeDbError(versionsError)

  let resolvedDraftData = draft?.draft_data ?? null
  if (!resolvedDraftData && product.current_published_version_id) {
    const { data: variant, error: variantError } = await serviceRole
      .from('mortgage_product_version_variants')
      .select('pricing_config')
      .eq('product_version_id', product.current_published_version_id)
      .eq('is_default', true)
      .maybeSingle()
    throwMortgageBackofficeDbError(variantError)
    resolvedDraftData = variant?.pricing_config ?? null
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
      },
      versions: (versions ?? []).map((version: any) => ({
        id: version.id,
        revision: Number(version.version_number ?? 0),
        status: version.lifecycle_status,
        publishedAt: version.published_at,
        validFrom: version.effective_from,
        validTo: version.effective_to,
      })),
    },
  }
})
