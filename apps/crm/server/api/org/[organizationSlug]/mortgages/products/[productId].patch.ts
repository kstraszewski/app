import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import { sanitizeMortgageOverrideParameters } from '~~/server/utils/mortgage-catalog'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const productId = getRequiredParam(event, 'productId')
  const body = asRecord(await readBody(event))

  const { data: product, error: productError } = await session.supabase
    .from('mortgage_products')
    .select('id, current_published_version_id')
    .eq('id', productId)
    .maybeSingle()
  throwDbError(productError)
  if (!product) {
    throw createError({ statusCode: 404, statusMessage: 'Mortgage product not found' })
  }
  if ('parameters' in body && product.current_published_version_id) {
    const { data: currentVersion, error: versionError } = await session.supabase
      .from('mortgage_product_versions')
      .select('calculator_schema_version')
      .eq('id', product.current_published_version_id)
      .maybeSingle()
    throwDbError(versionError)
    if (Number(currentVersion?.calculator_schema_version ?? 1) >= 2 && Object.keys(asRecord(body.parameters)).length) {
      throw createError({
        statusCode: 409,
        statusMessage: 'V2 pricing must be changed through the versioned mortgage-offer backoffice, not an organization flat-field override.',
      })
    }
  }

  const { data: existing, error: existingError } = await session.supabase
    .from('mortgage_product_overrides')
    .select('is_enabled, custom_name, parameters, notes')
    .eq('organization_id', session.organizationId)
    .eq('product_id', productId)
    .maybeSingle()
  throwDbError(existingError)

  const isEnabled = 'is_enabled' in body ? body.is_enabled : (existing?.is_enabled ?? true)
  if (typeof isEnabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'is_enabled must be boolean' })
  }

  const customName = 'custom_name' in body
    ? textValue(body.custom_name) ?? null
    : existing?.custom_name ?? null
  if (customName && customName.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'custom_name is too long' })
  }

  const notes = 'notes' in body ? textValue(body.notes) ?? null : existing?.notes ?? null
  if (notes && notes.length > 4_000) {
    throw createError({ statusCode: 400, statusMessage: 'notes are too long' })
  }

  const parameters = 'parameters' in body
    ? sanitizeMortgageOverrideParameters(body.parameters)
    : existing?.parameters ?? {}

  const values = {
    is_enabled: isEnabled,
    custom_name: customName,
    parameters,
    notes,
  }
  const { data, error } = existing
    ? await session.supabase
        .from('mortgage_product_overrides')
        .update(values)
        .eq('organization_id', session.organizationId)
        .eq('product_id', productId)
        .select('*')
        .single()
    : await session.supabase
        .from('mortgage_product_overrides')
        .insert({
          organization_id: session.organizationId,
          product_id: productId,
          ...values,
        })
        .select('*')
        .single()

  throwDbError(error)
  return { data }
})
