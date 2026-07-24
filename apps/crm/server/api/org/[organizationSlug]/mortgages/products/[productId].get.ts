import { createError } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const productId = getRequiredParam(event, 'productId')

  const { data: product, error: productError } = await session.supabase
    .from('mortgage_products')
    .select('id, bank_id, name, is_active, current_published_version_id')
    .eq('id', productId)
    .maybeSingle()
  throwDbError(productError)
  if (!product) {
    throw createError({ statusCode: 404, statusMessage: 'Mortgage product not found' })
  }

  const [
    { data: override, error: overrideError },
    { data: bankOverride, error: bankOverrideError },
    { data: currentVersion, error: currentVersionError },
  ] = await Promise.all([
    session.supabase
      .from('mortgage_product_overrides')
      .select('id, is_enabled, custom_name, notes, revision, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .eq('product_id', productId)
      .maybeSingle(),
    session.supabase
      .from('mortgage_bank_overrides')
      .select('is_enabled')
      .eq('organization_id', session.organizationId)
      .eq('bank_id', product.bank_id)
      .maybeSingle(),
    product.current_published_version_id
      ? session.supabase
          .from('mortgage_product_versions')
          .select('lifecycle_status, effective_from, effective_to')
          .eq('id', product.current_published_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  throwDbError(overrideError)
  throwDbError(bankOverrideError)
  throwDbError(currentVersionError)

  const today = new Date().toISOString().slice(0, 10)
  const productEnabled = override?.is_enabled ?? true
  const bankEnabled = bankOverride?.is_enabled ?? true
  const versionIsCurrent = Boolean(
    currentVersion?.lifecycle_status === 'published'
    && (!currentVersion.effective_from || currentVersion.effective_from <= today)
    && (!currentVersion.effective_to || currentVersion.effective_to >= today),
  )

  return {
    data: {
      id: product.id,
      baseName: product.name,
      isEnabled: productEnabled,
      customName: override?.custom_name ?? null,
      notes: override?.notes ?? null,
      revision: override?.revision ?? 0,
      isCustomized: Boolean(override),
      bankEnabled,
      hasPublishedVersion: Boolean(product.current_published_version_id),
      liveInCalculator: Boolean(product.is_active && productEnabled && bankEnabled && versionIsCurrent),
      createdAt: override?.created_at ?? null,
      updatedAt: override?.updated_at ?? null,
    },
  }
})
