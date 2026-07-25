import { serverSupabaseServiceRole } from '#supabase/server'
import { getQuery, setHeader } from 'h3'
import { appointmentMatchesVerifiedContact } from '~~/server/utils/client-identity'
import {
  getRequiredParam,
  requireAuthIdentity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  crmMeetingAppointmentSelect,
  crmMeetingOfferSelect,
  isCrmMeetingUuid,
  normalizeClientMeetingOffer,
  parseExpertMeetingPreviewOrganizationSlug,
  parseCrmMeetingContext,
} from '~~/server/utils/crm-meetings'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const previewOrganizationSlug = parseExpertMeetingPreviewOrganizationSlug(
    getQuery(event) as Record<string, unknown>,
  )
  const previewSession = previewOrganizationSlug
    ? await requireCrmSession(event, previewOrganizationSlug)
    : null
  const identity = previewSession ? null : await requireAuthIdentity(event)
  const appointmentId = getRequiredParam(event, 'appointmentId')
  if (!isCrmMeetingUuid(appointmentId)) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  let appointmentQuery = serviceRole
    .from('appointments')
    .select(crmMeetingAppointmentSelect)
    .eq('id', appointmentId)
    .contains('booking_context', { crmMeeting: { version: 1 } })
  if (previewSession) {
    appointmentQuery = appointmentQuery.eq(
      'organization_id',
      previewSession.organizationId,
    )
  }
  const appointmentResult = await appointmentQuery.maybeSingle()
  throwDbError(appointmentResult.error)
  const appointment = appointmentResult.data
  const context = parseCrmMeetingContext(appointment?.booking_context)
  if (
    !appointment
    || !context
    || !appointment.client_id
    || !appointment.client_person_id
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  if (previewSession) {
    await requireFacilityPermission(
      previewSession,
      String(appointment.facility_id),
      'view',
    )
  } else {
    const linkResult = await serviceRole
      .from('client_account_links')
      .select('verification_method, verified_contact_normalized')
      .eq('auth_user_id', identity!.userId)
      .eq('organization_id', appointment.organization_id)
      .eq('client_id', appointment.client_id)
      .eq('client_person_id', appointment.client_person_id)
      .is('revoked_at', null)
      .maybeSingle()
    throwDbError(linkResult.error)
    const link = linkResult.data
    if (
      !link
      || link.verification_method !== 'email'
      || !appointmentMatchesVerifiedContact(
        link.verified_contact_normalized,
        appointment.customer_email,
      )
    ) {
      throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
    }
  }

  const [organizationResult, serviceResult, expertResult, offersResult] = await Promise.all([
    serviceRole
      .from('organizations')
      .select('id, name, slug')
      .eq('id', appointment.organization_id)
      .maybeSingle(),
    serviceRole
      .from('booking_services')
      .select('id, name')
      .eq('organization_id', appointment.organization_id)
      .eq('id', appointment.service_id)
      .maybeSingle(),
    serviceRole
      .from('users')
      .select('id, full_name')
      .eq('id', appointment.expert_user_id)
      .maybeSingle(),
    context.shared.kind === 'mortgage-offers' && context.shared.offerIds.length
      ? serviceRole
          .from('crm_case_offer_snapshots')
          .select(crmMeetingOfferSelect)
          .eq('organization_id', appointment.organization_id)
          .eq('case_id', context.caseId)
          .in('id', context.shared.offerIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(organizationResult.error)
  throwDbError(serviceResult.error)
  throwDbError(expertResult.error)
  throwDbError(offersResult.error)

  const offerById = new Map(
    (offersResult.data ?? []).map((offer: any) => [String(offer.id), offer]),
  )
  const offers = context.shared.offerIds.flatMap((offerId) => {
    const offer = offerById.get(offerId)
    return offer ? [normalizeClientMeetingOffer(offer)] : []
  })
  const organization = organizationResult.data
  const service = serviceResult.data
  const expert = expertResult.data

  return {
    data: {
      id: String(appointment.id),
      status: appointment.status === 'cancelled' ? 'ended' : context.status,
      startsAt: String(appointment.starts_at),
      endsAt: String(appointment.ends_at),
      timezone: String(appointment.timezone),
      organization: organization
        ? {
            id: String(organization.id),
            name: String(organization.name),
            slug: String(organization.slug),
          }
        : null,
      service: service
        ? {
            id: String(service.id),
            name: String(service.name),
          }
        : null,
      expert: expert
        ? {
            id: String(expert.id),
            name: String(expert.full_name || 'Ekspert OpenExpert'),
          }
        : null,
      shared: {
        kind: context.shared.kind,
        processStepId: context.shared.processStepId,
        updatedAt: context.shared.updatedAt,
        offers,
      },
    },
  }
})
