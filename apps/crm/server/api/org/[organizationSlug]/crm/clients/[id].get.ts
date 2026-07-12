import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, getQuery, setHeader } from 'h3'
import {
  getRequiredParam,
  numberValue,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import { listAccessibleFacilityIds } from '~~/server/utils/scheduling'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function paginationValue(
  input: unknown,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (input === undefined) return fallback
  const value = numberValue(input)
  if (value === undefined || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an integer between ${minimum} and ${maximum}`,
    })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const id = getRequiredParam(event, 'id')
  if (!uuidPattern.test(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }

  const query = getQuery(event)
  const appointmentLimit = paginationValue(query.appointment_limit, 'appointment_limit', 20, 1, 100)
  const appointmentOffset = paginationValue(query.appointment_offset, 'appointment_offset', 0, 0, 100_000)
  const consentHistoryLimit = paginationValue(
    query.consent_history_limit,
    'consent_history_limit',
    100,
    1,
    250,
  )
  const consentHistoryOffset = paginationValue(
    query.consent_history_offset,
    'consent_history_offset',
    0,
    0,
    100_000,
  )

  const { data: client, error } = await session.supabase
    .from('crm_clients')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle()

  if (error) throwDbError(error)
  if (!client) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  const accessibleFacilityIds = await listAccessibleFacilityIds(session)
  let appointmentsRequest: any = serviceRole
    .from('appointments')
    .select(
      'id, client_id, facility_id, service_id, expert_user_id, starts_at, ends_at, timezone, status, confirmed_at, cancelled_at, cancellation_reason, customer_name, customer_email, customer_phone, notes, source, created_at, updated_at',
      { count: 'exact' },
    )
    .eq('organization_id', session.organizationId)
    .eq('client_id', id)
    .order('starts_at', { ascending: false })
    .range(appointmentOffset, appointmentOffset + appointmentLimit - 1)
  if (accessibleFacilityIds) {
    appointmentsRequest = accessibleFacilityIds.length
      ? appointmentsRequest.in('facility_id', accessibleFacilityIds)
      : Promise.resolve({ data: [], error: null, count: 0 })
  }

  const ownerRequest = client.owner_user_id
    ? session.supabase
        .from('users')
        .select('id, email, full_name')
        .eq('id', client.owner_user_id)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const [
    peopleResult,
    casesResult,
    activitiesResult,
    consentEventsResult,
    consentDefinitionsResult,
    ownerResult,
    appointmentsResult,
  ] = await Promise.all([
    session.supabase
      .from('crm_client_people')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('client_id', id)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true }),
    session.supabase
      .from('crm_cases')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('client_id', id)
      .order('updated_at', { ascending: false }),
    session.supabase
      .from('crm_activities')
      .select('*', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    session.supabase
      .from('crm_client_consent_events')
      .select('*', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .eq('client_id', id)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false }),
    session.supabase
      .from('crm_consent_definitions')
      .select('id, code, context, current_version_id, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .order('created_at', { ascending: true }),
    ownerRequest,
    appointmentsRequest,
  ])

  throwDbError(peopleResult.error)
  throwDbError(casesResult.error)
  throwDbError(activitiesResult.error)
  throwDbError(consentEventsResult.error)
  throwDbError(consentDefinitionsResult.error)
  throwDbError(ownerResult.error)
  throwDbError(appointmentsResult.error)

  const people = peopleResult.data ?? []
  const cases = casesResult.data ?? []
  const consentEvents = consentEventsResult.data ?? []
  const consentHistory = consentEvents.slice(
    consentHistoryOffset,
    consentHistoryOffset + consentHistoryLimit,
  )
  const consentDefinitions = consentDefinitionsResult.data ?? []
  const appointments = appointmentsResult.data ?? []
  const caseIds = cases
    .map((item: any) => String(item.id))
    .filter((uuid: string) => uuidPattern.test(uuid))
  const relatedEntityFilter = caseIds.length
    ? `client_id.eq.${id},case_id.in.(${caseIds.join(',')})`
    : `client_id.eq.${id}`

  const [tasksResult, openTasksResult, documentsResult] = await Promise.all([
    session.supabase
      .from('crm_tasks')
      .select('*', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(100),
    session.supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .neq('status_code', 'done'),
    session.supabase
      .from('crm_documents')
      .select('*', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  throwDbError(tasksResult.error)
  throwDbError(openTasksResult.error)
  throwDbError(documentsResult.error)

  const latestConsentByDefinitionId = new Map<string, any>()
  for (const consentEvent of consentEvents) {
    const definitionId = String(consentEvent.definition_id)
    if (!latestConsentByDefinitionId.has(definitionId)) {
      latestConsentByDefinitionId.set(definitionId, consentEvent)
    }
  }
  const latestConsentEvents = [...latestConsentByDefinitionId.values()]
  const consentVersionIds = [...new Set([
    ...consentDefinitions.map((definition: any) => String(definition.current_version_id)),
    ...consentHistory.map((item: any) => String(item.definition_version_id)),
    ...latestConsentEvents.map((item: any) => String(item.definition_version_id)),
  ].filter((uuid: string) => uuidPattern.test(uuid)))]

  const appointmentFacilityIds = [...new Set(appointments.map((item: any) => String(item.facility_id)))]
  const appointmentServiceIds = [...new Set(appointments.map((item: any) => String(item.service_id)))]
  const appointmentExpertIds = [...new Set(appointments.map((item: any) => String(item.expert_user_id)))]

  const [consentVersionsResult, facilitiesResult, servicesResult, expertsResult] = await Promise.all([
    consentVersionIds.length
      ? session.supabase
          .from('crm_consent_definition_versions')
          .select('*')
          .eq('organization_id', session.organizationId)
          .in('id', consentVersionIds)
      : Promise.resolve({ data: [], error: null }),
    appointmentFacilityIds.length
      ? serviceRole
          .from('facilities')
          .select('id, name, timezone')
          .eq('organization_id', session.organizationId)
          .in('id', appointmentFacilityIds)
      : Promise.resolve({ data: [], error: null }),
    appointmentServiceIds.length
      ? serviceRole
          .from('booking_services')
          .select('id, name, duration_minutes')
          .eq('organization_id', session.organizationId)
          .in('id', appointmentServiceIds)
      : Promise.resolve({ data: [], error: null }),
    appointmentExpertIds.length
      ? serviceRole
          .from('users')
          .select('id, full_name, email')
          .in('id', appointmentExpertIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  throwDbError(consentVersionsResult.error)
  throwDbError(facilitiesResult.error)
  throwDbError(servicesResult.error)
  throwDbError(expertsResult.error)

  const consentVersionById = new Map(
    (consentVersionsResult.data ?? []).map((version: any) => [String(version.id), version]),
  )
  const consentStates = consentDefinitions.map((definition: any) => {
    const consentEvent: any = latestConsentByDefinitionId.get(String(definition.id)) ?? null
    return consentEvent
      ? {
          ...consentEvent,
          definition,
          version: consentVersionById.get(String(consentEvent.definition_version_id)) ?? null,
        }
      : {
          id: null,
          client_id: id,
          definition_id: definition.id,
          definition_version_id: definition.current_version_id,
          decision: 'missing',
          occurred_at: null,
          source: null,
          contact_value: null,
          definition,
          version: consentVersionById.get(String(definition.current_version_id)) ?? null,
        }
  }).sort((left: any, right: any) => (
    Number(left.version?.sort_order ?? 0) - Number(right.version?.sort_order ?? 0)
    || String(left.version?.display_title ?? '').localeCompare(String(right.version?.display_title ?? ''), 'pl')
  ))
  // Keep `consents` backward-compatible: it only contains recorded decisions.
  // `consent_states` additionally exposes definitions for which no decision
  // has been recorded yet.
  const consents = consentStates.filter((consent: any) => consent.id !== null)

  const facilitiesById = new Map(
    (facilitiesResult.data ?? []).map((item: any) => [String(item.id), item]),
  )
  const servicesById = new Map(
    (servicesResult.data ?? []).map((item: any) => [String(item.id), item]),
  )
  const expertsById = new Map(
    (expertsResult.data ?? []).map((item: any) => [String(item.id), item]),
  )
  const appointmentRows = appointments.map((appointment: any) => {
    const facility: any = facilitiesById.get(String(appointment.facility_id)) ?? null
    const service: any = servicesById.get(String(appointment.service_id)) ?? null
    const expert: any = expertsById.get(String(appointment.expert_user_id)) ?? null
    return {
      ...appointment,
      facility,
      service,
      expert,
      facilityName: facility?.name ?? '',
      serviceName: service?.name ?? '',
      expertName: expert?.full_name || expert?.email || '',
    }
  })

  const appointmentCount = appointmentsResult.count ?? 0
  return {
    data: client,
    owner: ownerResult.data,
    primary_person: people.find((person: any) => person.role === 'primary') ?? people[0] ?? null,
    people,
    cases,
    tasks: tasksResult.data ?? [],
    documents: documentsResult.data ?? [],
    activities: activitiesResult.data ?? [],
    activity_count: activitiesResult.count ?? 0,
    consents,
    consent_states: consentStates,
    consent_definitions: consentDefinitions.map((definition: any) => ({
      ...definition,
      current_version: consentVersionById.get(String(definition.current_version_id)) ?? null,
    })),
    consent_events: consentHistory,
    consent_history: consentHistory.map((consentEvent: any) => ({
      ...consentEvent,
      version: consentVersionById.get(String(consentEvent.definition_version_id)) ?? null,
    })),
    consent_history_count: consentEventsResult.count ?? 0,
    consent_history_page_info: {
      offset: consentHistoryOffset,
      limit: consentHistoryLimit,
      has_more: consentHistoryOffset + consentHistory.length < (consentEventsResult.count ?? 0),
    },
    appointments: appointmentRows,
    appointment_count: appointmentCount,
    appointments_page_info: {
      offset: appointmentOffset,
      limit: appointmentLimit,
      has_more: appointmentOffset + appointmentRows.length < appointmentCount,
    },
    summary: {
      people_count: people.length,
      cases_count: cases.length,
      open_cases_count: cases.filter((item: any) => !item.closed_at).length,
      task_count: tasksResult.count ?? 0,
      open_tasks_count: openTasksResult.count ?? 0,
      documents_count: documentsResult.count ?? 0,
      activity_count: activitiesResult.count ?? 0,
      consent_definition_count: consentDefinitions.length,
      granted_consent_count: consentStates.filter((item: any) => item.decision === 'granted').length,
      appointment_count: appointmentCount,
    },
  }
})
