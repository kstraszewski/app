import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  booleanValue,
  emailValue,
  limitedText,
  requireFacilityPermission,
  slugValue,
  timezoneValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const facilityId = getRouterParam(event, 'facilityId')
  const access = await requireFacilityPermission(session, facilityId, 'manage')
  const body = asRecord(await readBody(event))
  const patch: Record<string, unknown> = {}

  if ('name' in body) patch.name = limitedText(body.name, 'name', 160, { required: true })
  if ('slug' in body) patch.slug = slugValue(body.slug, access.facility.name)
  if ('description' in body) patch.description = limitedText(body.description, 'description', 2_000, { nullable: true }) ?? null
  if ('timezone' in body) patch.timezone = timezoneValue(body.timezone)
  if ('addressLine1' in body || 'address_line1' in body) patch.address_line1 = limitedText(body.addressLine1 ?? body.address_line1, 'addressLine1', 250, { nullable: true }) ?? null
  if ('addressLine2' in body || 'address_line2' in body) patch.address_line2 = limitedText(body.addressLine2 ?? body.address_line2, 'addressLine2', 250, { nullable: true }) ?? null
  if ('postalCode' in body || 'postal_code' in body) patch.postal_code = limitedText(body.postalCode ?? body.postal_code, 'postalCode', 30, { nullable: true }) ?? null
  if ('city' in body) patch.city = limitedText(body.city, 'city', 120, { nullable: true }) ?? null
  if ('countryCode' in body || 'country_code' in body) {
    const countryCode = limitedText(body.countryCode ?? body.country_code, 'countryCode', 2, { required: true }) as string
    if (!/^[A-Za-z]{2}$/.test(countryCode)) {
      throw createError({ statusCode: 400, statusMessage: 'countryCode must be a two-letter country code' })
    }
    patch.country_code = countryCode.toUpperCase()
  }
  if ('phone' in body) patch.phone = limitedText(body.phone, 'phone', 50, { nullable: true }) ?? null
  if ('email' in body) patch.email = emailValue(body.email, 'email')
  if ('isActive' in body || 'is_active' in body) patch.is_active = booleanValue(body.isActive ?? body.is_active, 'isActive')

  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, statusMessage: 'No supported facility fields provided' })
  }

  const { data, error } = await session.dataApi
    .from('facilities')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('id', access.facility.id)
    .select('*')
    .single()
  throwDbError(error, 404)
  return { data }
})
