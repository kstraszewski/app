import { readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'
import {
  booleanValue,
  emailValue,
  limitedText,
  slugValue,
  timezoneValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const name = limitedText(body.name, 'name', 160, { required: true }) as string
  const countryCode = limitedText(body.countryCode ?? body.country_code ?? 'PL', 'countryCode', 2, { required: true }) as string
  if (!/^[A-Za-z]{2}$/.test(countryCode)) {
    throw createError({ statusCode: 400, statusMessage: 'countryCode must be a two-letter country code' })
  }

  const { data, error } = await session.supabase
    .from('facilities')
    .insert({
      organization_id: session.organizationId,
      name,
      slug: slugValue(body.slug, name),
      description: limitedText(body.description, 'description', 2_000, { nullable: true }) ?? null,
      timezone: timezoneValue(body.timezone ?? 'Europe/Warsaw'),
      address_line1: limitedText(body.addressLine1 ?? body.address_line1, 'addressLine1', 250, { nullable: true }) ?? null,
      address_line2: limitedText(body.addressLine2 ?? body.address_line2, 'addressLine2', 250, { nullable: true }) ?? null,
      postal_code: limitedText(body.postalCode ?? body.postal_code, 'postalCode', 30, { nullable: true }) ?? null,
      city: limitedText(body.city, 'city', 120, { nullable: true }) ?? null,
      country_code: countryCode.toUpperCase(),
      phone: limitedText(body.phone, 'phone', 50, { nullable: true }) ?? null,
      email: emailValue(body.email, 'email'),
      is_active: body.isActive === undefined && body.is_active === undefined
        ? true
        : booleanValue(body.isActive ?? body.is_active, 'isActive'),
    })
    .select('*')
    .single()

  throwDbError(error)
  return { data }
})
