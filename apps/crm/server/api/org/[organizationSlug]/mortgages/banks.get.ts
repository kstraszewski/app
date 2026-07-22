import { hasSuperAdminRole, requireCrmSession, throwDbError } from '~~/server/utils/crm'

const logoBucket = 'mortgage-bank-logos'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const superAdmin = await hasSuperAdminRole(session)
  const { data: banks, error: banksError } = await session.supabase
    .from('mortgage_banks')
    .select('id, slug, name, website_url, logo_url, logo_background_color, updated_at')
    .order('name')
  throwDbError(banksError)

  const bankIds = (banks ?? []).map((bank: any) => bank.id)
  if (!bankIds.length) return { banks: [], role: session.role, superAdmin }

  const [{ data: products, error: productsError }, { data: overrides, error: overridesError }] = await Promise.all([
    session.supabase
      .from('mortgage_products')
      .select('bank_id')
      .in('bank_id', bankIds)
      .eq('is_active', true),
    session.supabase
      .from('mortgage_bank_overrides')
      .select('id, bank_id, is_enabled, custom_name, custom_website_url, logo_path, notes, revision, created_at, updated_at, created_by, updated_by')
      .eq('organization_id', session.organizationId)
      .in('bank_id', bankIds),
  ])
  throwDbError(productsError)
  throwDbError(overridesError)

  const productCountByBank = new Map<string, number>()
  for (const product of products ?? []) {
    productCountByBank.set(product.bank_id, (productCountByBank.get(product.bank_id) ?? 0) + 1)
  }
  const overrideByBank = new Map((overrides ?? []).map((override: any) => [override.bank_id, override]))

  return {
    role: session.role,
    superAdmin,
    banks: (banks ?? []).map((bank: any) => {
      const override = overrideByBank.get(bank.id) as any
      const logoUrl = override?.logo_path
        ? session.supabase.storage.from(logoBucket).getPublicUrl(override.logo_path).data.publicUrl
        : bank.logo_url
      return {
        id: bank.id,
        slug: bank.slug,
        name: override?.custom_name ?? bank.name,
        baseName: bank.name,
        websiteUrl: override?.custom_website_url ?? bank.website_url,
        baseWebsiteUrl: bank.website_url,
        baseLogoUrl: bank.logo_url,
        logoBackground: override?.logo_path ? null : bank.logo_background_color,
        isEnabled: override?.is_enabled ?? true,
        logoUrl,
        productCount: productCountByBank.get(bank.id) ?? 0,
        override: override ?? null,
      }
    }),
  }
})
