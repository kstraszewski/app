import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readBody, setResponseStatus } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  assertDelegationFingerprint,
  delegatedTaskSelect,
  loadOrganizationProfiles,
  parseDelegatedTaskInput,
  taskDelegationFingerprint,
  withTaskParticipants,
} from '~~/server/utils/task-delegation'
import {
  assertFacilityBookableMemberIds,
  findConfiguredGenericMeetingService,
  requireFacilityPermission,
  throwBookingError,
} from '~~/server/utils/scheduling'
import { nudgeNotificationOutbox } from '~~/server/utils/notifications'

type Row = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const input = parseDelegatedTaskInput(await readBody(event))
  if (input.assigneeUserId === session.userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A delegated task must be assigned to another person',
    })
  }

  const fingerprint = taskDelegationFingerprint({
    organizationId: session.organizationId,
    caseId,
    delegatorUserId: session.userId,
    task: input,
  })
  const backendData = serverDataBackend(event) as any
  const existingResult = await session.dataApi
    .from('crm_tasks')
    .select('id, idempotency_fingerprint')
    .eq('organization_id', session.organizationId)
    .eq('delegator_user_id', session.userId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  throwDbError(existingResult.error)
  if (
    existingResult.data
    && assertDelegationFingerprint(
      existingResult.data.idempotency_fingerprint,
    ) !== fingerprint
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Idempotency key was already used for another task',
    })
  }

  // Mutable case and scheduling configuration is checked only for a new
  // creation. An exact retry must keep working if a service, assignment or
  // availability rule was disabled after the successful transaction.
  if (!existingResult.data) {
    const [caseResult, assigneeResult] = await Promise.all([
      session.dataApi
        .from('crm_cases')
        .select('id, client_id')
        .eq('organization_id', session.organizationId)
        .eq('id', caseId)
        .maybeSingle(),
      session.dataApi
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', session.organizationId)
        .eq('user_id', input.assigneeUserId)
        .maybeSingle(),
    ])
    throwDbError(caseResult.error)
    throwDbError(assigneeResult.error)
    if (!caseResult.data) {
      throw createError({ statusCode: 404, statusMessage: 'Case not found' })
    }
    if (!assigneeResult.data) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Assignee must belong to this organization',
      })
    }

    if (input.caseItemId) {
      const { data: caseItem, error } = await session.dataApi
        .from('crm_case_items')
        .select('id')
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .eq('id', input.caseItemId)
        .maybeSingle()
      throwDbError(error)
      if (!caseItem) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Case item does not belong to this case',
        })
      }
    }

    if (input.appointment) {
      if (!caseResult.data.client_id) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Link a client to the case before booking a meeting',
        })
      }
      await requireFacilityPermission(
        session,
        input.appointment.facilityId,
        'view',
      )
      await assertFacilityBookableMemberIds(
        session,
        input.appointment.facilityId,
        [input.assigneeUserId],
      )
      const genericService = await findConfiguredGenericMeetingService(
        event,
        session.organizationId,
        input.appointment.facilityId,
        input.assigneeUserId,
      )
      if (
        !genericService
        || String(genericService.id) !== input.appointment.serviceId
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: 'The selected service is not available for task meetings',
        })
      }

      if (input.appointment.clientPersonId) {
        const { data: person, error } = await backendData
          .from('crm_client_people')
          .select('id')
          .eq('organization_id', session.organizationId)
          .eq('client_id', caseResult.data.client_id)
          .eq('id', input.appointment.clientPersonId)
          .maybeSingle()
        throwDbError(error)
        if (!person) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Client person does not belong to the selected client',
          })
        }
      }
    }
  }

  const { data: creationResult, error: creationError } = await backendData.rpc(
    'create_delegated_crm_task',
    {
      p_request: {
      organization_id: session.organizationId,
      delegator_user_id: session.userId,
      assignee_user_id: input.assigneeUserId,
      case_id: caseId,
      case_item_id: input.caseItemId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      due_at: input.dueAt,
      data_access_scope: input.dataAccessScope,
      idempotency_key: input.idempotencyKey,
      idempotency_fingerprint: fingerprint,
      appointment: input.appointment
        ? {
            facility_id: input.appointment.facilityId,
            service_id: input.appointment.serviceId,
            starts_at: input.appointment.startsAt,
            client_person_id: input.appointment.clientPersonId,
            meeting_mode: input.appointment.meetingMode,
            meeting_url: input.appointment.meetingUrl,
            notes: input.appointment.notes,
          }
        : null,
      },
    },
  )
  if (creationError) {
    const message = String(creationError.message ?? '')
    if (/delegated_task_idempotency_key_reused/i.test(message)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Idempotency key was already used for another task',
      })
    }
    if (/invalid_delegated_task_replay_request/i.test(message)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'The original task creation result is no longer consistent',
      })
    }
    if (/crm_case_not_found/i.test(message)) {
      throw createError({ statusCode: 404, statusMessage: 'Case not found' })
    }
    if (/delegated_task_case_client_required/i.test(message)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Link a client to the case before booking a meeting',
      })
    }
    if (/delegated_task_meeting_service_not_configured/i.test(message)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The selected service is not available for task meetings',
      })
    }
    if (
      /invalid_delegated_task_(?:request|appointment)|delegated_task_(?:organization_membership_required|case_item_not_found|appointment_scope_required)/i
        .test(message)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The delegated task request is no longer valid',
      })
    }
    throwBookingError(creationError)
  }

  const result = creationResult as {
    taskId?: string
    appointmentId?: string | null
    created?: boolean
  } | null
  if (!result?.taskId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Task creation did not return a task',
    })
  }

  const [taskResult, appointmentResult] = await Promise.all([
    session.dataApi
      .from('crm_tasks')
      .select(delegatedTaskSelect)
      .eq('organization_id', session.organizationId)
      .eq('id', result.taskId)
      .single(),
    result.appointmentId
      ? session.dataApi
          .from('appointments')
          .select(`
            id,
            organization_id,
            facility_id,
            service_id,
            expert_user_id,
            client_id,
            client_person_id,
            crm_task_id,
            starts_at,
            ends_at,
            timezone,
            status,
            source,
            meeting_mode,
            meeting_url,
            customer_name,
            customer_email,
            customer_phone,
            notes,
            created_by_user_id,
            created_at,
            updated_at
          `)
          .eq('organization_id', session.organizationId)
          .eq('id', result.appointmentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  throwDbError(taskResult.error)
  throwDbError(appointmentResult.error)

  const task = taskResult.data as Row
  const profiles = await loadOrganizationProfiles(session, [
    task.delegator_user_id,
    task.assignee_user_id,
  ])
  const appointment = appointmentResult.data as Row | null
  const created = result.created === true
  if (created) setResponseStatus(event, 201)
  if (created) await nudgeNotificationOutbox(event)
  return {
    data: withTaskParticipants(task, profiles),
    appointment: appointment
      ? {
          id: appointment.id,
          organizationId: appointment.organization_id,
          facilityId: appointment.facility_id,
          serviceId: appointment.service_id,
          expertUserId: appointment.expert_user_id,
          clientId: appointment.client_id,
          clientPersonId: appointment.client_person_id,
          crmTaskId: appointment.crm_task_id,
          startsAt: appointment.starts_at,
          endsAt: appointment.ends_at,
          timezone: appointment.timezone,
          status: appointment.status,
          source: appointment.source,
          meetingMode: appointment.meeting_mode,
          meetingUrl: appointment.meeting_url,
          customerName: appointment.customer_name,
          customerEmail: appointment.customer_email,
          customerPhone: appointment.customer_phone,
          notes: appointment.notes,
          createdByUserId: appointment.created_by_user_id,
          createdAt: appointment.created_at,
          updatedAt: appointment.updated_at,
        }
      : null,
    created,
  }
})
