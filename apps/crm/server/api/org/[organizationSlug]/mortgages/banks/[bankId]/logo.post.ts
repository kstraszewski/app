import { randomUUID } from 'node:crypto'
import { createError, readMultipartFormData } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
  throwDbError,
} from '~~/server/utils/crm'

const logoBucket = 'mortgage-bank-logos'
const maxLogoBytes = 2 * 1024 * 1024
const imageTypes = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const

function hasValidSignature(type: keyof typeof imageTypes, data: Buffer): boolean {
  if (type === 'image/png') {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (type === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  return data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = getRequiredParam(event, 'bankId')

  const { data: bank, error: bankError } = await session.dataApi
    .from('mortgage_banks')
    .select('id')
    .eq('id', bankId)
    .maybeSingle()
  throwDbError(bankError)
  if (!bank) throw createError({ statusCode: 404, statusMessage: 'Financial institution not found' })

  const parts = await readMultipartFormData(event)
  const logo = parts?.find(part => part.name === 'logo' && part.filename)
  if (!logo?.data?.length) throw createError({ statusCode: 400, statusMessage: 'Logo file is required' })
  if (logo.data.length > maxLogoBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Logo must not exceed 2 MB' })
  }
  if (!logo.type || !(logo.type in imageTypes)) {
    throw createError({ statusCode: 415, statusMessage: 'Logo must be a PNG, JPEG or WebP image' })
  }

  const contentType = logo.type as keyof typeof imageTypes
  if (!hasValidSignature(contentType, logo.data)) {
    throw createError({ statusCode: 415, statusMessage: 'File contents do not match the selected image format' })
  }

  const { data: existing, error: existingError } = await session.dataApi
    .from('mortgage_bank_overrides')
    .select('logo_path')
    .eq('organization_id', session.organizationId)
    .eq('bank_id', bankId)
    .maybeSingle()
  throwDbError(existingError)

  const extension = imageTypes[contentType]
  const logoPath = `${session.organizationId}/${bankId}/${randomUUID()}.${extension}`
  const { error: uploadError } = await session.dataApi.storage
    .from(logoBucket)
    .upload(logoPath, logo.data, {
      cacheControl: '31536000',
      contentType,
      upsert: false,
    })
  if (uploadError) {
    throw createError({ statusCode: 500, statusMessage: uploadError.message || 'Logo upload failed' })
  }

  const result = existing
    ? await session.dataApi
        .from('mortgage_bank_overrides')
        .update({ logo_path: logoPath })
        .eq('organization_id', session.organizationId)
        .eq('bank_id', bankId)
        .select('*')
        .single()
    : await session.dataApi
        .from('mortgage_bank_overrides')
        .insert({ organization_id: session.organizationId, bank_id: bankId, logo_path: logoPath })
        .select('*')
        .single()

  if (result.error) {
    await session.dataApi.storage.from(logoBucket).remove([logoPath])
    throwDbError(result.error)
  }

  if (existing?.logo_path && existing.logo_path !== logoPath) {
    const { error: removeError } = await session.dataApi.storage.from(logoBucket).remove([existing.logo_path])
    if (removeError) console.warn('[mortgages] failed to remove replaced bank logo', removeError.message)
  }

  return {
    data: result.data,
    logoUrl: session.dataApi.storage.from(logoBucket).getPublicUrl(logoPath).data.publicUrl,
  }
})
