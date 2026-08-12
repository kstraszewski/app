import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, getQuery, setHeader } from 'h3'
import {
  getRequiredParam,
  hasAdministrativePermission,
  numberValue,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import { canCreateClientAnonymizationRequest } from '~~/server/utils/client-anonymization-requests'
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

  const { data: client, error } = await session.dataApi
    .from('crm_clients')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle()

  if (error) throwDbError(error)
  if (!client) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }

  const isClientOwner = String(client.owner_user_id ?? '') === session.userId
  const [
    hasPrivacyReadPermission,
    hasPrivacyCreatePermission,
    hasConsentManagePermission,
  ] = await Promise.all([
    hasAdministrativePermission(session, 'privacy.requests.read'),
    hasAdministrativePermission(session, 'privacy.requests.create'),
    hasAdministrativePermission(session, 'compliance.consents.definitions.manage'),
  ])
  const canCreatePrivacyRequestByAccess =
    canCreateClientAnonymizationRequest({
      currentUserId: session.userId,
      ownerUserId: client.owner_user_id
        ? String(client.owner_user_id)
        : null,
      hasCreatePermission: hasPrivacyCreatePermission,
      clientStatus: String(client.status_code),
    })
  const canViewPrivacyRequests = (
    isClientOwner
    || hasPrivacyReadPermission
    || hasPrivacyCreatePermission
  )
  const backendData = serverDataBackend(event) as any
  const canRequestConsent = isClientOwner || hasConsentManagePermission
  const accessibleFacilityIds = await listAccessibleFacilityIds(session)
  const portalAccountsRequest = backendData
    .from('client_portal_accounts')
    .select('auth_user_id, organization_id, client_id, client_person_id, status, archived_at, archive_reason, revision, created_at, updated_at')
    .eq('organization_id', session.organizationId)
    .eq('client_id', id)
    .order('created_at', { ascending: false })
  const portalAccountLinksRequest = backendData
    .from('client_account_links')
    .select('auth_user_id, organization_id, client_id, client_person_id')
    .eq('organization_id', session.organizationId)
    .eq('client_id', id)
    .is('revoked_at', null)
  let appointmentsRequest: any = backendData
    .from('appointments')
    .select(
      'id, client_id, facility_id, service_id, expert_user_id, starts_at, ends_at, timezone, status, meeting_mode, meeting_url, confirmed_at, cancelled_at, cancellation_reason, customer_name, customer_email, customer_phone, notes, source, created_at, updated_at',
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
    ? session.dataApi
        .from('users')
        .select('id, email, full_name')
        .eq('id', client.owner_user_id)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const anonymizationRequestsRequest = canViewPrivacyRequests
    ? session.dataApi
        .from('crm_client_anonymization_requests')
        .select(
          'id, organization_id, client_id, subject_person_id, request_number, status, request_channel, legal_basis, requested_at, identity_verified_at, identity_verified_by_user_id, approved_at, approved_by_user_id, due_at, justification, review_note, completed_at, completed_by_user_id, created_by_user_id, created_at, updated_at',
        )
        .eq('organization_id', session.organizationId)
        .eq('client_id', id)
        .order('requested_at', { ascending: false })
    : Promise.resolve({ data: [], error: null })

  const { data: caseLinks, error: caseLinksError } = await session.dataApi
    .from('crm_case_clients')
    .select('case_id')
    .eq('organization_id', session.organizationId)
    .eq('client_id', id)
  throwDbError(caseLinksError)
  const clientCaseIds = [...new Set((caseLinks ?? []).map((link: any) => String(link.case_id)))]
  const casesRequest = clientCaseIds.length
    ? session.dataApi
        .from('crm_cases')
        .select('id, title, closed_at, created_at, updated_at')
        .eq('organization_id', session.organizationId)
        .in('id', clientCaseIds)
        .order('updated_at', { ascending: false })
    : Promise.resolve({ data: [], error: null })

  const [
    peopleResult,
    casesResult,
    consentEventsResult,
    consentDefinitionsResult,
    ownerResult,
    appointmentsResult,
    anonymizationRequestsResult,
    consentCaptureRequestsResult,
    portalAccountsResult,
    portalAccountLinksResult,
  ] = await Promise.all([
    session.dataApi
      .from('crm_client_people')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('client_id', id)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true }),
    casesRequest,
    session.dataApi
      .from('crm_client_consent_events')
      .select('*', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .eq('client_id', id)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false }),
    session.dataApi
      .from('crm_consent_definitions')
      .select('id, code, context, current_version_id, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .order('created_at', { ascending: true }),
    ownerRequest,
    appointmentsRequest,
    anonymizationRequestsRequest,
    backendData
      .from('crm_consent_capture_requests')
      .select('id, client_id, subject_person_id, definition_id, definition_version_id, intent, status, delivery_status, phone_e164, expires_at, sent_at, delivered_at, verified_at, decided_at, decision, created_at')
      .eq('organization_id', session.organizationId)
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(250),
    portalAccountsRequest,
    portalAccountLinksRequest,
  ])

  throwDbError(peopleResult.error)
  throwDbError(casesResult.error)
  throwDbError(consentEventsResult.error)
  throwDbError(consentDefinitionsResult.error)
  throwDbError(ownerResult.error)
  throwDbError(appointmentsResult.error)
  throwDbError(anonymizationRequestsResult.error)
  throwDbError(consentCaptureRequestsResult.error)
  throwDbError(portalAccountsResult.error)
  throwDbError(portalAccountLinksResult.error)

  const people = peopleResult.data ?? []
  const caseRows = casesResult.data ?? []
  const caseIds = caseRows.map((crmCase: any) => String(crmCase.id))
  const { data: caseOffers, error: caseOffersError } = caseIds.length
    ? await session.dataApi
        .from('crm_case_offer_snapshots')
        .select('case_id')
        .eq('organization_id', session.organizationId)
        .in('case_id', caseIds)
    : { data: [], error: null }
  throwDbError(caseOffersError)
  const offerCountByCase = new Map<string, number>()
  for (const offer of caseOffers ?? []) {
    const caseId = String(offer.case_id)
    offerCountByCase.set(caseId, (offerCountByCase.get(caseId) ?? 0) + 1)
  }
  const cases = caseRows.map((crmCase: any) => ({
    ...crmCase,
    offer_count: offerCountByCase.get(String(crmCase.id)) ?? 0,
  }))
  const consentEvents = consentEventsResult.data ?? []
  const consentHistory = consentEvents.slice(
    consentHistoryOffset,
    consentHistoryOffset + consentHistoryLimit,
  )
  const consentDefinitions = consentDefinitionsResult.data ?? []
  const appointments = appointmentsResult.data ?? []
  const rawAnonymizationRequests = anonymizationRequestsResult.data ?? []
  const executableRequestIds = rawAnonymizationRequests
    .filter((request: any) => request.status === 'approved')
    .map((request: any) => String(request.id))
  const executionGrantResult = executableRequestIds.length
    ? await session.dataApi
        .from('crm_client_anonymization_execution_grants')
        .select('id, request_id, revision, status, expires_at, approved_at')
        .eq('organization_id', session.organizationId)
        .eq('grantee_user_id', session.userId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .in('request_id', executableRequestIds)
        .order('approved_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null }
  throwDbError(executionGrantResult.error)
  const executionGrant = executionGrantResult.data
  const relatedCaseIds = cases
    .map((item: any) => String(item.id))
    .filter((uuid: string) => uuidPattern.test(uuid))
  const relatedEntityFilter = relatedCaseIds.length
    ? `client_id.eq.${id},case_id.in.(${relatedCaseIds.join(',')})`
    : `client_id.eq.${id}`

  const [tasksResult, openTasksResult, documentsResult, activitiesResult] = await Promise.all([
    session.dataApi
      .from('crm_tasks')
      .select('accepted_at, assignee_user_id, cancelled_at, case_id, case_item_id, client_id, completed_at, created_at, data_access_scope, delegated_at, delegation_status, delegator_user_id, description, due_at, id, idempotency_fingerprint, idempotency_key, metadata, organization_id, priority, rejected_at, rejection_reason, responded_at, status_code, title, updated_at', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(100),
    session.dataApi
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .neq('status_code', 'done'),
    session.dataApi
      .from('crm_documents')
      .select('case_id, case_item_id, client_id, created_at, document_type, id, metadata, mime_type, name, organization_id, received_at, sha256, size_bytes, status_code, storage_bucket, storage_path, submission_id, updated_at, uploaded_by_user_id, verified_at', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('created_at', { ascending: false })
      .limit(100),
    session.dataApi
      .from('crm_activities')
      .select('*', { count: 'exact' })
      .eq('organization_id', session.organizationId)
      .or(relatedEntityFilter)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  throwDbError(tasksResult.error)
  throwDbError(openTasksResult.error)
  throwDbError(documentsResult.error)
  throwDbError(activitiesResult.error)

  const activityRows = activitiesResult.data ?? []
  const activityActorIds = [...new Set(activityRows
    .map((activity: any) => activity.actor_user_id ? String(activity.actor_user_id) : null)
    .filter((actorId: string | null): actorId is string => Boolean(actorId)))]
  const activityActorsResult = activityActorIds.length
    ? await session.dataApi
        .from('organization_memberships')
        .select('user_id, user:users!organization_memberships_user_id_fkey!inner(id, email, full_name)')
        .eq('organization_id', session.organizationId)
        .in('user_id', activityActorIds)
    : { data: [], error: null }
  throwDbError(activityActorsResult.error)

  const activityActorById = new Map(
    (activityActorsResult.data ?? []).flatMap((membership: any) => {
      const user = Array.isArray(membership.user) ? membership.user[0] : membership.user
      return user ? [[String(membership.user_id), user] as const] : []
    }),
  )
  const activities = activityRows.map((activity: any) => ({
    ...activity,
    actor: activity.actor_user_id
      ? activityActorById.get(String(activity.actor_user_id)) ?? null
      : null,
  }))

  const latestConsentByPersonAndDefinition = new Map<string, any>()
  for (const consentEvent of consentEvents) {
    const key = `${String(consentEvent.subject_person_id)}:${String(consentEvent.definition_id)}`
    if (!latestConsentByPersonAndDefinition.has(key)) {
      latestConsentByPersonAndDefinition.set(key, consentEvent)
    }
  }
  const latestConsentEvents = [...latestConsentByPersonAndDefinition.values()]
  const consentVersionIds = [...new Set([
    ...consentDefinitions.map((definition: any) => String(definition.current_version_id)),
    ...consentHistory.map((item: any) => String(item.definition_version_id)),
    ...latestConsentEvents.map((item: any) => String(item.definition_version_id)),
  ].filter((uuid: string) => uuidPattern.test(uuid)))]

  const appointmentFacilityIds = [...new Set(appointments.map((item: any) => String(item.facility_id)))]
  const appointmentServiceIds = [...new Set(appointments.map((item: any) => String(item.service_id)))]
  const appointmentExpertIds = [...new Set(appointments.map((item: any) => String(item.expert_user_id)))]
  const anonymizationActorIds = [...new Set(rawAnonymizationRequests.flatMap((request: any) => [
    request.identity_verified_by_user_id,
    request.approved_by_user_id,
    request.completed_by_user_id,
    request.created_by_user_id,
  ]).filter((actorId: unknown): actorId is string => (
    typeof actorId === 'string' && uuidPattern.test(actorId)
  )))]

  const [
    consentVersionsResult,
    facilitiesResult,
    servicesResult,
    expertsResult,
    anonymizationActorsResult,
  ] = await Promise.all([
    consentVersionIds.length
      ? session.dataApi
          .from('crm_consent_definition_versions')
          .select('*')
          .eq('organization_id', session.organizationId)
          .in('id', consentVersionIds)
      : Promise.resolve({ data: [], error: null }),
    appointmentFacilityIds.length
      ? backendData
          .from('facilities')
          .select('id, name, timezone')
          .eq('organization_id', session.organizationId)
          .in('id', appointmentFacilityIds)
      : Promise.resolve({ data: [], error: null }),
    appointmentServiceIds.length
      ? backendData
          .from('booking_services')
          .select('id, name, duration_minutes')
          .eq('organization_id', session.organizationId)
          .in('id', appointmentServiceIds)
      : Promise.resolve({ data: [], error: null }),
    appointmentExpertIds.length
      ? backendData
          .from('users')
          .select('id, full_name, email')
          .in('id', appointmentExpertIds)
      : Promise.resolve({ data: [], error: null }),
    anonymizationActorIds.length
      ? session.dataApi
          .from('users')
          .select('id, full_name, email')
          .in('id', anonymizationActorIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  throwDbError(consentVersionsResult.error)
  throwDbError(facilitiesResult.error)
  throwDbError(servicesResult.error)
  throwDbError(expertsResult.error)
  throwDbError(anonymizationActorsResult.error)

  const consentVersionById = new Map(
    (consentVersionsResult.data ?? []).map((version: any) => [String(version.id), version]),
  )
  const consentStates = people.flatMap((person: any) => consentDefinitions.map((definition: any) => {
    const consentEvent: any = latestConsentByPersonAndDefinition.get(`${String(person.id)}:${String(definition.id)}`) ?? null
    const base = consentEvent
      ? {
          ...consentEvent,
          definition,
          version: consentVersionById.get(String(consentEvent.definition_version_id)) ?? null,
        }
      : {
          id: null,
          client_id: id,
          subject_person_id: person.id,
          definition_id: definition.id,
          definition_version_id: definition.current_version_id,
          decision: 'missing',
          occurred_at: null,
          source: null,
          contact_value: null,
          definition,
          version: consentVersionById.get(String(definition.current_version_id)) ?? null,
        }
    return {
      ...base,
      subject_person: {
        id: String(person.id),
        display_name: String(person.display_name || 'Osoba bez nazwy'),
        role: String(person.role || 'other'),
        phone: person.phone ? String(person.phone) : null,
      },
    }
  })).sort((left: any, right: any) => (
    Number(left.version?.sort_order ?? 0) - Number(right.version?.sort_order ?? 0)
    || String(left.version?.display_title ?? '').localeCompare(String(right.version?.display_title ?? ''), 'pl')
    || String(left.subject_person?.display_name ?? '').localeCompare(String(right.subject_person?.display_name ?? ''), 'pl')
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
  const anonymizationActorsById = new Map(
    (anonymizationActorsResult.data ?? []).map((item: any) => [String(item.id), item]),
  )
  const anonymizationRequests = rawAnonymizationRequests.map((request: any) => ({
    ...request,
    identity_verified_by: request.identity_verified_by_user_id
      ? anonymizationActorsById.get(String(request.identity_verified_by_user_id)) ?? null
      : null,
    approved_by: request.approved_by_user_id
      ? anonymizationActorsById.get(String(request.approved_by_user_id)) ?? null
      : null,
    completed_by: request.completed_by_user_id
      ? anonymizationActorsById.get(String(request.completed_by_user_id)) ?? null
      : null,
    created_by: request.created_by_user_id
      ? anonymizationActorsById.get(String(request.created_by_user_id)) ?? null
      : null,
  }))
  const activeAnonymizationRequest = anonymizationRequests.find(
    (request: any) => !['completed', 'rejected', 'cancelled'].includes(
      String(request.status),
    ),
  ) ?? null
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

  const activePortalAccountScopes = new Set(
    (portalAccountLinksResult.data ?? []).map((link: any) => JSON.stringify([
      String(link.auth_user_id),
      String(link.organization_id),
      String(link.client_id),
      String(link.client_person_id),
    ])),
  )
  // A verified e-mail change can transfer the active link to another Auth
  // identity while retaining the previous lifecycle as audit history. Only an
  // exact current link may make that historical row look active in the CRM.
  const portalAccounts = (portalAccountsResult.data ?? []).filter((account: any) => (
    account.status !== 'active'
    || activePortalAccountScopes.has(JSON.stringify([
      String(account.auth_user_id),
      String(account.organization_id),
      String(account.client_id),
      String(account.client_person_id),
    ]))
  ))

  const appointmentCount = appointmentsResult.count ?? 0
  return {
    data: client,
    owner: ownerResult.data,
    primary_person: people.find((person: any) => person.role === 'primary') ?? people[0] ?? null,
    people,
    portal_accounts: portalAccounts,
    cases,
    tasks: tasksResult.data ?? [],
    documents: documentsResult.data ?? [],
    activities,
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
    consent_capture_requests: (consentCaptureRequestsResult.data ?? []).map((request: any) => ({
      id: String(request.id),
      client_id: String(request.client_id),
      subject_person_id: String(request.subject_person_id),
      definition_id: String(request.definition_id),
      definition_version_id: String(request.definition_version_id),
      intent: request.intent === 'withdraw' ? 'withdraw' : 'collect',
      status: String(request.status),
      delivery_status: request.delivery_status ? String(request.delivery_status) : null,
      phone_masked: request.phone_e164
        ? String(request.phone_e164).replace(/.(?=.{4})/g, '•')
        : '—',
      expires_at: String(request.expires_at),
      sent_at: request.sent_at ? String(request.sent_at) : null,
      delivered_at: request.delivered_at ? String(request.delivered_at) : null,
      verified_at: request.verified_at ? String(request.verified_at) : null,
      decided_at: request.decided_at ? String(request.decided_at) : null,
      decision: request.decision ? String(request.decision) : null,
      created_at: String(request.created_at),
    })),
    consent_access: {
      can_request: canRequestConsent,
      can_manage: hasConsentManagePermission,
    },
    consent_history_page_info: {
      offset: consentHistoryOffset,
      limit: consentHistoryLimit,
      has_more: consentHistoryOffset + consentHistory.length < (consentEventsResult.count ?? 0),
    },
    anonymization_requests: anonymizationRequests,
    current_anonymization_request:
      activeAnonymizationRequest ?? anonymizationRequests[0] ?? null,
    privacy_access: {
      can_view_requests: canViewPrivacyRequests,
      can_create_request: (
        canCreatePrivacyRequestByAccess
        && !activeAnonymizationRequest
      ),
      create_permission_key: 'privacy.requests.create',
      can_execute_anonymization: Boolean(executionGrant),
      execute_permission_key: 'clients.anonymization.execute',
      execution_requires_temporary_grant: true,
      execution_grant: executionGrant
        ? {
            id: String(executionGrant.id),
            revision: Number(executionGrant.revision),
            status: 'active',
            expires_at: String(executionGrant.expires_at),
            approved_at: String(executionGrant.approved_at),
          }
        : null,
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
