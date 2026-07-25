import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const appBaseUrl = process.env.CRM_TEST_BASE_URL ?? 'http://127.0.0.1:3027'
const envText = await readFile(new URL('../.env', import.meta.url), 'utf8')
const localEnv = Object.fromEntries(
  envText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }),
)

const supabaseUrl = localEnv.NUXT_PUBLIC_SUPABASE_URL
const publicKey = localEnv.NUXT_PUBLIC_SUPABASE_KEY
const secretKey = localEnv.NUXT_SUPABASE_SECRET_KEY
assert.ok(supabaseUrl && publicKey && secretKey, 'Local Supabase env is incomplete')

const serviceClient = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function sessionCookie(session) {
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  const name = 'openexpert-local-auth'
  if (encoded.length <= 3_180) return `${name}=${encoded}`

  const chunks = []
  for (let offset = 0; offset < encoded.length; offset += 3_180) {
    chunks.push(`${name}.${chunks.length}=${encoded.slice(offset, offset + 3_180)}`)
  }
  return chunks.join('; ')
}

async function loginCookie(email, password) {
  const client = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  assert.ifError(error)
  assert.ok(data.session, `No session returned for ${email}`)
  return sessionCookie(data.session)
}

async function loginClient(email, password) {
  const client = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  assert.ifError(error)
  assert.ok(data.session, `No direct session returned for ${email}`)
  return client
}

async function api(cookie, path, init = {}) {
  const response = await fetch(`${appBaseUrl}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  }
  catch {
    body = text
  }
  return { response, body }
}

function warsawDate(daysFromToday = 0) {
  const date = new Date(Date.now() + daysFromToday * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const adminCookie = await loginCookie(
  'admin@openexpert.local',
  'OpenExpert123!',
)
const annaCookie = await loginCookie(
  'anna.nowak@openexpert.local',
  'OpenExpert123!',
)
const piotrCookie = await loginCookie(
  'piotr.zielinski@openexpert.local',
  'OpenExpert123!',
)
const piotrClient = await loginClient(
  'piotr.zielinski@openexpert.local',
  'OpenExpert123!',
)

const linkedMeetingResult = await serviceClient
  .from('appointments')
  .select('crm_task_id')
  .not('crm_task_id', 'is', null)
  .limit(1)
  .single()
assert.ifError(linkedMeetingResult.error)
const linkedTaskResult = await serviceClient
  .from('crm_tasks')
  .select('case_id')
  .eq('id', linkedMeetingResult.data.crm_task_id)
  .single()
assert.ifError(linkedTaskResult.error)

const organizationSlug = 'openexpert-local'
const caseId = linkedTaskResult.data.case_id
const casePath = `/api/org/${organizationSlug}/crm/cases/${caseId}/tasks`
const temporaryTaskIds = []
const temporaryAppointmentIds = []

try {
  const assignees = await api(adminCookie, `${casePath}/assignees`)
  assert.equal(assignees.response.status, 200)
  assert.ok(assignees.body?.data?.members?.length >= 3)
  assert.ok(assignees.body?.data?.recent?.length >= 3)
  const anna = assignees.body.data.members.find(
    member => member.email === 'anna.nowak@openexpert.local',
  )
  assert.ok(anna, 'Anna is missing from task assignees')
  const piotr = assignees.body.data.members.find(
    member => member.email === 'piotr.zielinski@openexpert.local',
  )
  assert.ok(piotr, 'Piotr is missing from task assignees')
  assert.equal(typeof anna.open_task_count, 'number')
  assert.ok(anna.team_name)

  const seededTasks = await api(adminCookie, casePath)
  assert.equal(seededTasks.response.status, 200)
  const taskWithMeeting = seededTasks.body?.data?.find(
    task => task.id === linkedMeetingResult.data.crm_task_id,
  )
  assert.ok(taskWithMeeting, 'Linked seeded task is missing from the API')
  assert.ok(taskWithMeeting.history.length > 0)
  assert.ok(taskWithMeeting.meetings.length > 0)

  const optionsPath = `${casePath}/appointment-options?${new URLSearchParams({
    assignee_user_id: anna.user_id,
    date: warsawDate(1),
    days: '7',
  })}`
  const appointmentOptions = await api(adminCookie, optionsPath)
  assert.equal(appointmentOptions.response.status, 200)
  assert.equal(appointmentOptions.body?.days, 7)
  assert.equal(appointmentOptions.body?.assigneeUserId, anna.user_id)
  const appointmentContext = appointmentOptions.body?.contexts?.find(
    context => context.slots?.length >= 4,
  )
  assert.ok(appointmentContext, 'No four free delegated-task slots were returned')
  assert.ok(appointmentContext.timezone)
  const nonOverlappingSlots = []
  for (const slot of appointmentContext.slots) {
    const previous = nonOverlappingSlots.at(-1)
    if (
      !previous
      || new Date(slot.startsAt).valueOf()
        >= new Date(previous.endsAt).valueOf()
    ) {
      nonOverlappingSlots.push(slot)
    }
  }
  assert.ok(
    nonOverlappingSlots.length >= 4,
    'No four non-overlapping delegated-task slots were returned',
  )
  const [cancelSlot, rejectSlot, reassignSlot, revokedAccessSlot]
    = nonOverlappingSlots

  const idempotencyKey = randomUUID()
  const requestBody = {
    title: 'Test API delegacji — spotkanie i anulowanie',
    description: 'Automatyczny test atomowego zadania ze spotkaniem.',
    assignee_user_id: anna.user_id,
    priority: 'high',
    data_access_scope: [
      'case_summary',
      'client_contact',
      'client_identity',
      'documents',
    ],
    idempotency_key: idempotencyKey,
    appointment: {
      facility_id: appointmentContext.facilityId,
      service_id: appointmentContext.serviceId,
      starts_at: cancelSlot.startsAt,
      meeting_mode: 'office',
      notes: 'Spotkanie utworzone przez smoke test delegacji.',
    },
  }

  const created = await api(adminCookie, casePath, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body?.created, true)
  assert.equal(created.body?.data?.delegation_status, 'pending')
  assert.equal(
    new Date(created.body?.data?.due_at).toISOString(),
    new Date(cancelSlot.startsAt).toISOString(),
  )
  assert.equal(created.body?.appointment?.expertUserId, anna.user_id)
  assert.equal(created.body?.appointment?.status, 'confirmed')
  assert.equal(created.body?.appointment?.meetingMode, 'office')
  assert.equal(created.body?.appointment?.meetingUrl, null)
  const cancelledTaskId = created.body.data.id
  const cancelledAppointmentId = created.body.appointment.id
  temporaryTaskIds.push(cancelledTaskId)
  temporaryAppointmentIds.push(cancelledAppointmentId)
  assert.equal(created.body.appointment.crmTaskId, cancelledTaskId)

  const replay = await api(adminCookie, casePath, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  })
  assert.equal(replay.response.status, 200)
  assert.equal(replay.body?.created, false)
  assert.equal(replay.body?.data?.id, cancelledTaskId)
  assert.equal(replay.body?.appointment?.id, cancelledAppointmentId)

  const disableAssignment = await serviceClient
    .from('facility_service_experts')
    .update({ is_active: false })
    .eq('organization_id', created.body.appointment.organizationId)
    .eq('facility_id', appointmentContext.facilityId)
    .eq('service_id', appointmentContext.serviceId)
    .eq('user_id', anna.user_id)
  assert.ifError(disableAssignment.error)
  try {
    const replayAfterConfigurationChange = await api(adminCookie, casePath, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })
    assert.equal(replayAfterConfigurationChange.response.status, 200)
    assert.equal(replayAfterConfigurationChange.body?.created, false)
    assert.equal(
      replayAfterConfigurationChange.body?.appointment?.id,
      cancelledAppointmentId,
    )
  }
  finally {
    const restoreAssignment = await serviceClient
      .from('facility_service_experts')
      .update({ is_active: true })
      .eq('organization_id', created.body.appointment.organizationId)
      .eq('facility_id', appointmentContext.facilityId)
      .eq('service_id', appointmentContext.serviceId)
      .eq('user_id', anna.user_id)
    assert.ifError(restoreAssignment.error)
  }

  const conflictIdempotencyKey = randomUUID()
  const conflict = await api(adminCookie, casePath, {
    method: 'POST',
    body: JSON.stringify({
      ...requestBody,
      title: 'Test atomowego rollbacku zajętego terminu',
      idempotency_key: conflictIdempotencyKey,
    }),
  })
  assert.equal(conflict.response.status, 409)
  const rolledBackTask = await serviceClient
    .from('crm_tasks')
    .select('id')
    .eq('idempotency_key', conflictIdempotencyKey)
    .maybeSingle()
  assert.ifError(rolledBackTask.error)
  assert.equal(rolledBackTask.data, null)

  const rejectionRequest = {
    ...requestBody,
    title: 'Test API delegacji — spotkanie i odrzucenie',
    idempotency_key: randomUUID(),
    appointment: {
      ...requestBody.appointment,
      starts_at: rejectSlot.startsAt,
      notes: 'Spotkanie do testu odrzucenia delegacji.',
    },
  }
  const createdForRejection = await api(adminCookie, casePath, {
    method: 'POST',
    body: JSON.stringify(rejectionRequest),
  })
  assert.equal(createdForRejection.response.status, 201)
  assert.equal(createdForRejection.body?.created, true)
  const rejectedTaskId = createdForRejection.body.data.id
  const rejectedAppointmentId = createdForRejection.body.appointment.id
  temporaryTaskIds.push(rejectedTaskId)
  temporaryAppointmentIds.push(rejectedAppointmentId)

  const reassignmentRequest = {
    ...requestBody,
    title: 'Test API delegacji — zmiana wykonawcy',
    idempotency_key: randomUUID(),
    appointment: {
      ...requestBody.appointment,
      starts_at: reassignSlot.startsAt,
      notes: 'Spotkanie do testu zmiany wykonawcy.',
    },
  }
  const createdForReassignment = await api(adminCookie, casePath, {
    method: 'POST',
    body: JSON.stringify(reassignmentRequest),
  })
  assert.equal(createdForReassignment.response.status, 201)
  const reassignedTaskId = createdForReassignment.body.data.id
  const reassignedAppointmentId = createdForReassignment.body.appointment.id
  temporaryTaskIds.push(reassignedTaskId)
  temporaryAppointmentIds.push(reassignedAppointmentId)

  const accepted = await api(
    annaCookie,
    `${casePath}/${cancelledTaskId}/response`,
    {
      method: 'PATCH',
      body: JSON.stringify({ action: 'accept' }),
    },
  )
  assert.equal(accepted.response.status, 200)
  assert.equal(accepted.body?.changed, true)
  assert.equal(accepted.body?.data?.delegation_status, 'accepted')
  const acceptedAt = accepted.body?.data?.accepted_at
  assert.ok(acceptedAt)

  const started = await api(annaCookie, `${casePath}/${cancelledTaskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status_code: 'in_progress' }),
  })
  assert.equal(started.response.status, 200)
  assert.equal(started.body?.changed, true)
  assert.equal(started.body?.data?.status_code, 'in_progress')

  const cancelled = await api(
    adminCookie,
    `${casePath}/${cancelledTaskId}/response`,
    {
      method: 'PATCH',
      body: JSON.stringify({ action: 'cancel' }),
    },
  )
  assert.equal(cancelled.response.status, 200)
  assert.equal(cancelled.body?.changed, true)
  assert.equal(cancelled.body?.data?.delegation_status, 'cancelled')
  assert.equal(cancelled.body?.data?.accepted_at, acceptedAt)

  const rejected = await api(
    annaCookie,
    `${casePath}/${rejectedTaskId}/response`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'reject',
        reason: 'Automatyczny test odrzucenia delegacji.',
      }),
    },
  )
  assert.equal(rejected.response.status, 200)
  assert.equal(rejected.body?.changed, true)
  assert.equal(rejected.body?.data?.delegation_status, 'rejected')

  const reassigned = await serviceClient
    .from('crm_tasks')
    .update({ assignee_user_id: piotr.user_id })
    .eq('id', reassignedTaskId)
    .select('id, assignee_user_id, delegation_status')
    .single()
  assert.ifError(reassigned.error)
  assert.equal(reassigned.data.assignee_user_id, piotr.user_id)
  assert.equal(reassigned.data.delegation_status, 'pending')

  const appointmentStates = await serviceClient
    .from('appointments')
    .select('id, status, cancellation_reason, crm_task_id')
    .in('id', temporaryAppointmentIds)
  assert.ifError(appointmentStates.error)
  assert.equal(appointmentStates.data.length, 3)
  for (const appointment of appointmentStates.data) {
    assert.equal(appointment.status, 'cancelled')
  }
  const appointmentStateById = new Map(
    appointmentStates.data.map(appointment => [appointment.id, appointment]),
  )
  assert.equal(
    appointmentStateById.get(cancelledAppointmentId)?.cancellation_reason,
    'delegated_task_cancelled',
  )
  assert.equal(
    appointmentStateById.get(rejectedAppointmentId)?.cancellation_reason,
    'delegated_task_rejected',
  )
  assert.equal(
    appointmentStateById.get(reassignedAppointmentId)?.cancellation_reason,
    'delegated_task_reassigned',
  )

  const finalTasks = await api(adminCookie, casePath)
  assert.equal(finalTasks.response.status, 200)
  const cancelledTask = finalTasks.body?.data?.find(
    task => task.id === cancelledTaskId,
  )
  const rejectedTask = finalTasks.body?.data?.find(
    task => task.id === rejectedTaskId,
  )
  const reassignedTask = finalTasks.body?.data?.find(
    task => task.id === reassignedTaskId,
  )
  assert.ok(cancelledTask, 'Cancelled delegated task disappeared from history')
  assert.ok(rejectedTask, 'Rejected delegated task disappeared from history')
  assert.ok(reassignedTask, 'Reassigned delegated task disappeared from history')

  const cancelledActivityTypes = new Set(
    cancelledTask.history.map(activity => activity.activity_type),
  )
  for (const expectedType of [
    'task_delegated',
    'task_delegation_accepted',
    'task_status_changed',
    'task_delegation_cancelled',
    'task_appointment_cancelled',
  ]) {
    assert.ok(
      cancelledActivityTypes.has(expectedType),
      `Missing ${expectedType} audit event`,
    )
  }
  const rejectedActivityTypes = new Set(
    rejectedTask.history.map(activity => activity.activity_type),
  )
  for (const expectedType of [
    'task_delegated',
    'task_delegation_rejected',
    'task_appointment_cancelled',
  ]) {
    assert.ok(
      rejectedActivityTypes.has(expectedType),
      `Missing ${expectedType} rejection audit event`,
    )
  }
  const reassignedActivityTypes = new Set(
    reassignedTask.history.map(activity => activity.activity_type),
  )
  for (const expectedType of [
    'task_delegated',
    'task_reassigned',
    'task_appointment_cancelled',
  ]) {
    assert.ok(
      reassignedActivityTypes.has(expectedType),
      `Missing ${expectedType} reassignment audit event`,
    )
  }
  for (const task of [cancelledTask, rejectedTask, reassignedTask]) {
    assert.equal(task.meetings.length, 1)
    assert.equal(task.meetings[0].status, 'cancelled')
    assert.equal(task.meetings[0].meeting_mode, 'office')
    assert.equal(task.meetings[0].meeting_url, null)
  }

  const releasedOptions = await api(adminCookie, optionsPath)
  assert.equal(releasedOptions.response.status, 200)
  const releasedStarts = new Set(
    releasedOptions.body.contexts.flatMap(
      context => context.slots.map(slot => slot.startsAt),
    ),
  )
  assert.ok(releasedStarts.has(cancelSlot.startsAt))
  assert.ok(releasedStarts.has(rejectSlot.startsAt))
  assert.ok(releasedStarts.has(reassignSlot.startsAt))

  const revokedAccessRequest = {
    ...requestBody,
    title: 'Test bezpiecznego replay po cofnięciu dostępu',
    idempotency_key: randomUUID(),
    appointment: {
      ...requestBody.appointment,
      starts_at: revokedAccessSlot.startsAt,
      notes: 'Spotkanie do testu widoczności PII przy replay.',
    },
  }
  const createdBeforeAccessRevocation = await api(piotrCookie, casePath, {
    method: 'POST',
    body: JSON.stringify(revokedAccessRequest),
  })
  assert.equal(createdBeforeAccessRevocation.response.status, 201)
  assert.ok(createdBeforeAccessRevocation.body?.appointment)
  const revokedAccessTaskId = createdBeforeAccessRevocation.body.data.id
  const revokedAccessAppointmentId
    = createdBeforeAccessRevocation.body.appointment.id
  temporaryTaskIds.push(revokedAccessTaskId)
  temporaryAppointmentIds.push(revokedAccessAppointmentId)

  const acceptedRevokedAccessTask = await api(
    annaCookie,
    `${casePath}/${revokedAccessTaskId}/response`,
    {
      method: 'PATCH',
      body: JSON.stringify({ action: 'accept' }),
    },
  )
  assert.equal(acceptedRevokedAccessTask.response.status, 200)
  const forbiddenDelegatorStatusUpdate = await piotrClient
    .from('crm_tasks')
    .update({ status_code: 'done' })
    .eq('id', revokedAccessTaskId)
    .select('id')
  assert.equal(forbiddenDelegatorStatusUpdate.error?.code, '42501')
  assert.match(
    forbiddenDelegatorStatusUpdate.error?.message ?? '',
    /task_status_update_requires_assignee/,
  )

  const organizationId
    = createdBeforeAccessRevocation.body.appointment.organizationId
  const [
    facilityMembership,
    teamMemberships,
    serviceAssignments,
    availabilityRules,
    availabilityOverrides,
  ] = await Promise.all([
    serviceClient
      .from('facility_memberships')
      .select(`
        organization_id,
        facility_id,
        user_id,
        role,
        is_bookable,
        booking_priority
      `)
      .eq('organization_id', organizationId)
      .eq('facility_id', appointmentContext.facilityId)
      .eq('user_id', piotr.user_id)
      .single(),
    serviceClient
      .from('team_memberships')
      .select('organization_id, team_id, user_id, role')
      .eq('organization_id', organizationId)
      .eq('user_id', piotr.user_id),
    serviceClient
      .from('facility_service_experts')
      .select('organization_id, facility_id, service_id, user_id, is_active')
      .eq('organization_id', organizationId)
      .eq('facility_id', appointmentContext.facilityId)
      .eq('user_id', piotr.user_id),
    serviceClient
      .from('expert_availability_rules')
      .select(`
        id,
        organization_id,
        facility_id,
        user_id,
        weekday,
        starts_at,
        ends_at,
        valid_from,
        valid_until,
        is_active
      `)
      .eq('organization_id', organizationId)
      .eq('facility_id', appointmentContext.facilityId)
      .eq('user_id', piotr.user_id),
    serviceClient
      .from('expert_availability_overrides')
      .select(`
        id,
        organization_id,
        facility_id,
        user_id,
        local_date,
        is_unavailable,
        starts_at,
        ends_at
      `)
      .eq('organization_id', organizationId)
      .eq('facility_id', appointmentContext.facilityId)
      .eq('user_id', piotr.user_id),
  ])
  for (const configurationResult of [
    facilityMembership,
    teamMemberships,
    serviceAssignments,
    availabilityRules,
    availabilityOverrides,
  ]) {
    assert.ifError(configurationResult.error)
  }

  const deleteTeams = await serviceClient
    .from('team_memberships')
    .delete()
    .eq('organization_id', organizationId)
    .eq('user_id', piotr.user_id)
  assert.ifError(deleteTeams.error)
  const deleteFacilityMembership = await serviceClient
    .from('facility_memberships')
    .delete()
    .eq('organization_id', organizationId)
    .eq('facility_id', appointmentContext.facilityId)
    .eq('user_id', piotr.user_id)
  assert.ifError(deleteFacilityMembership.error)

  try {
    const replayWithoutFacilityAccess = await api(piotrCookie, casePath, {
      method: 'POST',
      body: JSON.stringify(revokedAccessRequest),
    })
    assert.equal(replayWithoutFacilityAccess.response.status, 200)
    assert.equal(replayWithoutFacilityAccess.body?.created, false)
    assert.equal(replayWithoutFacilityAccess.body?.data?.id, revokedAccessTaskId)
    assert.equal(replayWithoutFacilityAccess.body?.appointment, null)
  }
  finally {
    const restoreFacilityMembership = await serviceClient
      .from('facility_memberships')
      .upsert(facilityMembership.data, {
        onConflict: 'organization_id,facility_id,user_id',
      })
    assert.ifError(restoreFacilityMembership.error)
    if (teamMemberships.data.length) {
      const restoreTeams = await serviceClient
        .from('team_memberships')
        .upsert(teamMemberships.data, {
          onConflict: 'organization_id,team_id,user_id',
        })
      assert.ifError(restoreTeams.error)
    }
    if (serviceAssignments.data.length) {
      const restoreServices = await serviceClient
        .from('facility_service_experts')
        .upsert(serviceAssignments.data, {
          onConflict: 'organization_id,facility_id,service_id,user_id',
        })
      assert.ifError(restoreServices.error)
    }
    if (availabilityRules.data.length) {
      const restoreRules = await serviceClient
        .from('expert_availability_rules')
        .upsert(availabilityRules.data, { onConflict: 'id' })
      assert.ifError(restoreRules.error)
    }
    if (availabilityOverrides.data.length) {
      const restoreOverrides = await serviceClient
        .from('expert_availability_overrides')
        .upsert(availabilityOverrides.data, { onConflict: 'id' })
      assert.ifError(restoreOverrides.error)
    }
  }

  console.log(
    'Task delegation appointment smoke passed: seven-day options, atomic '
    + 'create/rollback, replay after config change, cancel/reject/reassign, '
    + 'audit, slot release and RLS-safe replay.',
  )
}
finally {
  if (temporaryAppointmentIds.length) {
    const outboxCleanup = await serviceClient
      .from('booking_outbox')
      .delete()
      .in('aggregate_id', temporaryAppointmentIds)
    assert.ifError(outboxCleanup.error)
    const appointmentCleanup = await serviceClient
      .from('appointments')
      .delete()
      .in('id', temporaryAppointmentIds)
    assert.ifError(appointmentCleanup.error)
  }
  if (temporaryTaskIds.length) {
    const auditCleanup = await serviceClient
      .from('crm_activities')
      .delete()
      .in('task_id', temporaryTaskIds)
    assert.ifError(auditCleanup.error)
    const taskCleanup = await serviceClient
      .from('crm_tasks')
      .delete()
      .in('id', temporaryTaskIds)
    assert.ifError(taskCleanup.error)
  }
  await piotrClient.auth.signOut({ scope: 'local' })
}
