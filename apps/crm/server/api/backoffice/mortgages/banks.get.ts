import { mortgageOfferValidity, requireMortgageBackoffice, throwMortgageBackofficeDbError } from '~~/server/utils/mortgage-backoffice'

export default defineEventHandler(async (event) => {
  const { serviceRole } = await requireMortgageBackoffice(event)

  const [banksResult, productsResult, draftsResult] = await Promise.all([
    serviceRole
      .from('mortgage_banks')
      .select('id, slug, name, logo_url, logo_background_color')
      .order('name'),
    serviceRole
      .from('mortgage_products')
      .select('id, bank_id, slug, name, category, distribution_channel, is_active, current_published_version_id, revision, archived_at, updated_at')
      .order('name'),
    serviceRole
      .from('mortgage_product_drafts')
      .select('id, product_id, revision, draft_data, updated_at, updated_by_user_id'),
  ])
  throwMortgageBackofficeDbError(banksResult.error)
  throwMortgageBackofficeDbError(productsResult.error)
  throwMortgageBackofficeDbError(draftsResult.error)

  const products = productsResult.data ?? []
  const currentVersionIds = products
    .map((product: any) => product.current_published_version_id)
    .filter(Boolean)
  const { data: currentVersions, error: versionError } = currentVersionIds.length
    ? await serviceRole
        .from('mortgage_product_versions')
        .select('id, version_number, effective_from, effective_to, published_at')
        .in('id', currentVersionIds)
    : { data: [], error: null }
  throwMortgageBackofficeDbError(versionError)

  const draftByProduct = new Map((draftsResult.data ?? []).map((draft: any) => [draft.product_id, draft]))
  const versionById = new Map((currentVersions ?? []).map((version: any) => [version.id, version]))
  const productsByBank = new Map<string, any[]>()

  for (const product of products) {
    const draft = draftByProduct.get(product.id) as any
    const version = versionById.get(product.current_published_version_id) as any
    const hasDraft = Boolean(draft)
    const hasPublishedVersion = Boolean(product.current_published_version_id && version)
    const publicationStatus = product.archived_at
      ? 'archived'
      : hasPublishedVersion
        ? 'published'
        : 'draft'
    // Keep the legacy single status for older clients. New clients use the two
    // independent flags because a live product may also have a pending draft.
    const status = publicationStatus
    const validity = hasPublishedVersion
      ? { validFrom: version?.effective_from ?? null, validTo: version?.effective_to ?? null }
      : draft
        ? mortgageOfferValidity(draft.draft_data)
        : { validFrom: null, validTo: null }
    const offer = {
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
      draftRevision: Number(draft?.revision ?? 0),
      publishedRevision: version?.version_number == null ? null : Number(version.version_number),
      validFrom: validity.validFrom,
      validTo: validity.validTo,
      updatedAt: draft?.updated_at ?? product.updated_at ?? version?.published_at ?? null,
      updatedBy: draft?.updated_by_user_id ?? null,
    }
    productsByBank.set(product.bank_id, [...(productsByBank.get(product.bank_id) ?? []), offer])
  }

  return {
    data: (banksResult.data ?? []).map((bank: any) => ({
      id: bank.id,
      slug: bank.slug,
      name: bank.name,
      logoUrl: bank.logo_url ?? null,
      logoBackground: bank.logo_background_color ?? null,
      isEnabled: true,
      offers: productsByBank.get(bank.id) ?? [],
    })),
  }
})
