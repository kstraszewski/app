import { serverSupabaseServiceRole } from '#supabase/server'
import { setHeader } from 'h3'
import { appointmentMatchesVerifiedContact } from '~~/server/utils/client-identity'
import { requireAuthIdentity, throwDbError } from '~~/server/utils/crm'

type ClientLinkRow = {
  organization_id: string
  client_person_id: string
  verification_method: string
  verified_contact_normalized: string
}

type ClientLinkGroup = {
  organizationId: string
  verifiedContactNormalized: string
  clientPersonIds: Set<string>
}

function indexById(rows: Array<Record<string, any>>): Map<string, Record<string, any>> {
  return new Map(rows.map(row => [String(row.id), row]))
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const identity = await requireAuthIdentity(event)
  const serviceRole = serverSupabaseServiceRole(event) as any

  const linksResult = await serviceRole
    .from('client_account_links')
    .select(`
      organization_id,
      client_person_id,
      verification_method,
      verified_contact_normalized
    `)
    .eq('auth_user_id', identity.userId)
    .is('revoked_at', null)
  throwDbError(linksResult.error)

  const links = (linksResult.data ?? []) as ClientLinkRow[]
  if (!links.length) return { data: [] }

  const linkGroups = new Map<string, ClientLinkGroup>()
  for (const link of links) {
    const organizationId = String(link.organization_id)
    const verifiedContactNormalized = String(link.verified_contact_normalized ?? '')
    if (
      link.verification_method !== 'email'
      || !appointmentMatchesVerifiedContact(
        verifiedContactNormalized,
        verifiedContactNormalized,
      )
    ) continue

    const groupKey = JSON.stringify([organizationId, verifiedContactNormalized])
    const group = linkGroups.get(groupKey) ?? {
      organizationId,
      verifiedContactNormalized,
      clientPersonIds: new Set<string>(),
    }
    group.clientPersonIds.add(String(link.client_person_id))
    linkGroups.set(groupKey, group)
  }

  const appointmentResults = await Promise.all(
    [...linkGroups.values()].map(async group => ({
      verifiedContactNormalized: group.verifiedContactNormalized,
      result: await serviceRole
        .from('appointments')
        .select(`
          id,
          organization_id,
          facility_id,
          service_id,
          expert_user_id,
          starts_at,
          ends_at,
          timezone,
          status,
          meeting_mode,
          meeting_url,
          customer_email
        `)
        .eq('organization_id', group.organizationId)
        .in('client_person_id', [...group.clientPersonIds])
        .eq('customer_email', group.verifiedContactNormalized)
        .order('starts_at', { ascending: false })
        .limit(200),
    })),
  )

  for (const { result } of appointmentResults) throwDbError(result.error)
  const appointments = appointmentResults.flatMap(({
    result,
    verifiedContactNormalized,
  }) => (result.data ?? [])
    .filter((appointment: Record<string, unknown>) => (
      appointmentMatchesVerifiedContact(
        verifiedContactNormalized,
        appointment.customer_email,
      )
    ))
    .map((appointment: Record<string, any>) => {
      const { customer_email: _customerEmail, ...safeAppointment } = appointment
      return safeAppointment
    }))
  if (!appointments.length) return { data: [] }

  const organizationIds = [...new Set(appointments.map(row => String(row.organization_id)))]
  const facilityIds = [...new Set(appointments.map(row => String(row.facility_id)))]
  const serviceIds = [...new Set(appointments.map(row => String(row.service_id)))]
  const expertIds = [...new Set(appointments.map(row => String(row.expert_user_id)))]

  const [organizationsResult, facilitiesResult, servicesResult, expertsResult] = await Promise.all([
    serviceRole
      .from('organizations')
      .select('id, name, slug')
      .in('id', organizationIds),
    serviceRole
      .from('facilities')
      .select('id, name, city, address_line1, address_line2, postal_code')
      .in('id', facilityIds),
    serviceRole
      .from('booking_services')
      .select('id, name, duration_minutes')
      .in('id', serviceIds),
    serviceRole
      .from('users')
      .select('id, full_name')
      .in('id', expertIds),
  ])

  throwDbError(organizationsResult.error)
  throwDbError(facilitiesResult.error)
  throwDbError(servicesResult.error)
  throwDbError(expertsResult.error)

  const organizations = indexById(organizationsResult.data ?? [])
  const facilities = indexById(facilitiesResult.data ?? [])
  const services = indexById(servicesResult.data ?? [])
  const experts = indexById(expertsResult.data ?? [])

  return {
    data: appointments
      .map((appointment) => {
        const organization = organizations.get(String(appointment.organization_id))
        const facility = facilities.get(String(appointment.facility_id))
        const service = services.get(String(appointment.service_id))
        const expert = experts.get(String(appointment.expert_user_id))

        return {
          id: String(appointment.id),
          status: String(appointment.status),
          startsAt: String(appointment.starts_at),
          endsAt: String(appointment.ends_at),
          timezone: String(appointment.timezone),
          meetingMode: appointment.meeting_mode === 'online' ? 'online' : 'office',
          meetingUrl: appointment.meeting_url ? String(appointment.meeting_url) : null,
          organization: organization
            ? {
                id: String(organization.id),
                name: String(organization.name),
                slug: String(organization.slug),
              }
            : null,
          facility: facility
            ? {
                id: String(facility.id),
                name: String(facility.name),
                city: facility.city ? String(facility.city) : null,
                addressLine1: facility.address_line1 ? String(facility.address_line1) : null,
                addressLine2: facility.address_line2 ? String(facility.address_line2) : null,
                postalCode: facility.postal_code ? String(facility.postal_code) : null,
              }
            : null,
          service: service
            ? {
                id: String(service.id),
                name: String(service.name),
                durationMinutes: Number(service.duration_minutes),
              }
            : null,
          expert: expert
            ? {
                id: String(expert.id),
                name: String(expert.full_name),
              }
            : null,
        }
      })
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt)),
  }
})
