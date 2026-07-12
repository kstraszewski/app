import { getQuery } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { mergeMortgageVersion } from '~~/server/utils/mortgage-catalog'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const includeDisabled = getQuery(event).includeDisabled === '1' && session.role === 'admin'
  const { data: products, error: productError } = await session.supabase
    .from('mortgage_products')
    .select('id, slug, name, category, bank_id, mortgage_banks!inner(id, slug, name, website_url)')
    .eq('is_active', true)
    .order('name')
  throwDbError(productError)

  const productIds = (products ?? []).map((product: any) => product.id)
  if (!productIds.length) return { products: [], retrievedAt: null, role: session.role }

  const { data: versions, error: versionError } = await session.supabase
    .from('mortgage_product_versions')
    .select('*')
    .in('product_id', productIds)
    .order('retrieved_at', { ascending: false })
  throwDbError(versionError)

  const sourceIds = [...new Set((versions ?? [])
    .map((version: any) => version.source_document_id)
    .filter(Boolean))]
  const { data: sources, error: sourceError } = sourceIds.length
    ? await session.supabase
        .from('mortgage_source_documents')
        .select('id, title, source_url, source_kind, sha256, storage_path, retrieved_at, published_at, retrieval_status, extraction_status')
        .in('id', sourceIds)
    : { data: [], error: null }
  throwDbError(sourceError)

  const { data: overrides, error: overrideError } = await session.supabase
    .from('mortgage_product_overrides')
    .select('id, product_id, is_enabled, custom_name, parameters, notes, revision, created_at, updated_at, created_by, updated_by')
    .eq('organization_id', session.organizationId)
    .in('product_id', productIds)
  throwDbError(overrideError)

  const sourceById = new Map((sources ?? []).map((source: any) => [source.id, source]))
  const overrideByProduct = new Map((overrides ?? []).map((override: any) => [override.product_id, override]))
  const latestByProduct = new Map<string, any>()
  for (const version of versions ?? []) {
    if (!latestByProduct.has(version.product_id)) latestByProduct.set(version.product_id, version)
  }

  return {
    retrievedAt: versions?.[0]?.retrieved_at ?? null,
    role: session.role,
    products: (products ?? []).flatMap((product: any) => {
      const version = latestByProduct.get(product.id)
      if (!version) return []
      const override = overrideByProduct.get(product.id) as any
      if (override?.is_enabled === false && !includeDisabled) return []
      const rawBank = Array.isArray(product.mortgage_banks)
        ? product.mortgage_banks[0]
        : product.mortgage_banks
      const source = sourceById.get(version.source_document_id) ?? null
      const baseVersion = { ...version, source }
      return [{
        id: product.id,
        slug: product.slug,
        name: override?.custom_name ?? product.name,
        baseName: product.name,
        category: product.category,
        bank: rawBank,
        isEnabled: override?.is_enabled ?? true,
        version: mergeMortgageVersion(baseVersion, override?.parameters),
        baseVersion,
        override: override ?? null,
      }]
    }),
  }
})
