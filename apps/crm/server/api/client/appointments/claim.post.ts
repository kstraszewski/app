import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readBody, setHeader } from 'h3'
import {
  confirmedClientEmail,
  hasMatchingVerifiedClientEmail,
} from '~~/server/utils/client-identity'
import { asRecord, requireAuthIdentity, throwDbError } from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const identity = await requireAuthIdentity(event)
  const body = asRecord(await readBody(event))
  const appointmentId = uuidValue(body.appointmentId, 'appointmentId')
  const backendData = serverDataBackend(event) as any

  const appointmentResult = await backendData
    .from('appointments')
    .select(`
      id,
      organization_id,
      client_id,
      client_person_id,
      customer_email
    `)
    .eq('id', appointmentId)
    .maybeSingle()
  throwDbError(appointmentResult.error)

  const appointment = appointmentResult.data
  if (!identity.emailVerified || !appointment?.client_id || !appointment.client_person_id) {
    throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  }

  const personResult = await backendData
    .from('crm_client_people')
    .select('email_normalized')
    .eq('organization_id', appointment.organization_id)
    .eq('client_id', appointment.client_id)
    .eq('id', appointment.client_person_id)
    .maybeSingle()
  throwDbError(personResult.error)

  if (!hasMatchingVerifiedClientEmail({
    authEmail: identity.email,
    emailConfirmedAt: identity.emailConfirmedAt,
    appointmentEmail: appointment.customer_email,
    personEmailNormalized: personResult.data?.email_normalized,
  })) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Appointment not found',
    })
  }
  const verifiedContactNormalized = confirmedClientEmail(
    identity.email,
    identity.emailConfirmedAt,
  )

  const organizationId = String(appointment.organization_id)
  const clientId = String(appointment.client_id)
  const clientPersonId = String(appointment.client_person_id)
  const verificationMethod = 'email'

  const activeLinkResult = await backendData
    .from('client_account_links')
    .select('auth_user_id')
    .eq('organization_id', organizationId)
    .eq('client_person_id', clientPersonId)
    .is('revoked_at', null)
    .maybeSingle()
  throwDbError(activeLinkResult.error)

  if (
    activeLinkResult.data
    && String(activeLinkResult.data.auth_user_id) !== identity.userId
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This customer profile is already linked to another account',
    })
  }

  const existingOwnLinkResult = await backendData
    .from('client_account_links')
    .select('auth_user_id, revoked_at')
    .eq('auth_user_id', identity.userId)
    .eq('organization_id', organizationId)
    .eq('client_person_id', clientPersonId)
    .maybeSingle()
  throwDbError(existingOwnLinkResult.error)

  const linkValues = {
    source_appointment_id: appointmentId,
    verification_method: verificationMethod,
    verified_contact_normalized: verifiedContactNormalized,
    verified_at: new Date().toISOString(),
    revoked_at: null,
  }
  const linkResult = existingOwnLinkResult.data
    ? await backendData
        .from('client_account_links')
        .update(linkValues)
        .eq('auth_user_id', identity.userId)
        .eq('organization_id', organizationId)
        .eq('client_person_id', clientPersonId)
    : await backendData
        .from('client_account_links')
        .insert({
          auth_user_id: identity.userId,
          organization_id: organizationId,
          client_id: clientId,
          client_person_id: clientPersonId,
          ...linkValues,
        })

  if (linkResult.error?.code === '23505') {
    const concurrentLinkResult = await backendData
      .from('client_account_links')
      .select('auth_user_id, verified_contact_normalized')
      .eq('organization_id', organizationId)
      .eq('client_person_id', clientPersonId)
      .is('revoked_at', null)
      .maybeSingle()
    throwDbError(concurrentLinkResult.error)

    if (
      String(concurrentLinkResult.data?.auth_user_id ?? '') !== identity.userId
      || String(concurrentLinkResult.data?.verified_contact_normalized ?? '')
        !== verifiedContactNormalized
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This customer profile is already linked to another account',
      })
    }
  } else {
    throwDbError(linkResult.error)
  }

  return {
    linked: true,
    appointmentId,
    verificationMethod,
  }
})
