import { createError, readBody, setHeader } from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  asRecord,
  normalizeClientEmail,
  requireAvailablePortalIdentity,
  requiredUuid,
  throwPortalAccountArchived,
  throwPortalDbError,
} from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const identity = await requireAvailablePortalIdentity(event)
  const body = asRecord(await readBody(event))
  const appointmentId = requiredUuid(body.appointmentId, 'appointmentId')
  const backend = serverDataBackend(event) as any

  const appointmentResult = await backend
    .from('appointments')
    .select('id, organization_id, client_id, client_person_id, customer_email')
    .eq('id', appointmentId)
    .maybeSingle()
  throwPortalDbError(appointmentResult.error, 'could not load appointment claim')
  const appointment = appointmentResult.data
  if (!appointment?.client_id || !appointment.client_person_id) {
    throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  }

  const personResult = await backend
    .from('crm_client_people')
    .select('email_normalized')
    .eq('organization_id', appointment.organization_id)
    .eq('client_id', appointment.client_id)
    .eq('id', appointment.client_person_id)
    .maybeSingle()
  throwPortalDbError(personResult.error, 'could not validate appointment person')

  const appointmentEmail = normalizeClientEmail(appointment.customer_email)
  const personEmail = normalizeClientEmail(personResult.data?.email_normalized)
  if (
    !identity.email
    || identity.email !== appointmentEmail
    || identity.email !== personEmail
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  }

  const organizationId = String(appointment.organization_id)
  const clientId = String(appointment.client_id)
  const clientPersonId = String(appointment.client_person_id)
  const activeLinkResult = await backend
    .from('client_account_links')
    .select('auth_user_id')
    .eq('organization_id', organizationId)
    .eq('client_person_id', clientPersonId)
    .is('revoked_at', null)
    .maybeSingle()
  throwPortalDbError(activeLinkResult.error, 'could not inspect active appointment link')
  if (
    activeLinkResult.data
    && String(activeLinkResult.data.auth_user_id) !== identity.userId
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This customer profile is already linked to another account',
    })
  }

  const ownLinkResult = await backend
    .from('client_account_links')
    .select('auth_user_id')
    .eq('auth_user_id', identity.userId)
    .eq('organization_id', organizationId)
    .eq('client_person_id', clientPersonId)
    .maybeSingle()
  throwPortalDbError(ownLinkResult.error, 'could not inspect own appointment link')

  const values = {
    source_appointment_id: appointmentId,
    verification_method: 'email',
    verified_contact_normalized: identity.email,
    verified_at: new Date().toISOString(),
    revoked_at: null,
  }
  const linkResult = ownLinkResult.data
    ? await backend
        .from('client_account_links')
        .update(values)
        .eq('auth_user_id', identity.userId)
        .eq('organization_id', organizationId)
        .eq('client_person_id', clientPersonId)
    : await backend.from('client_account_links').insert({
        auth_user_id: identity.userId,
        organization_id: organizationId,
        client_id: clientId,
        client_person_id: clientPersonId,
        ...values,
      })

  if (linkResult.error?.code === '23505') {
    throw createError({
      statusCode: 409,
      statusMessage: 'This customer profile is already linked to another account',
    })
  }
  if (
    linkResult.error?.code === '55000'
    && String(linkResult.error.message ?? '').includes('client_portal_account_is_archived')
  ) {
    throwPortalAccountArchived()
  }
  throwPortalDbError(linkResult.error, 'could not claim appointment')

  return { linked: true, appointmentId, verificationMethod: 'email' }
})
