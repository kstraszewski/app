import { createError, readBody } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  canRespondToDelegation,
  delegatedTaskSelect,
  expectedDelegationStatus,
  loadOrganizationProfiles,
  parseTaskDelegationResponse,
  withTaskParticipants,
} from '~~/server/utils/task-delegation'
import { nudgeNotificationOutbox } from '~~/server/utils/notifications'

type Row = Record<string, any> & {
  delegator_user_id: string | null
  assignee_user_id: string | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const taskId = getRequiredParam(event, 'taskId')
  if (!caseUuidPattern.test(caseId) || !caseUuidPattern.test(taskId)) {
    throw createError({ statusCode: 404, statusMessage: 'Task not found' })
  }
  const input = parseTaskDelegationResponse(await readBody(event))

  async function loadTask(): Promise<Row> {
    const { data, error } = await session.dataApi
      .from('crm_tasks')
      .select(delegatedTaskSelect)
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('id', taskId)
      .neq('delegation_status', 'not_delegated')
      .maybeSingle()
    throwDbError(error)
    if (!data) {
      throw createError({ statusCode: 404, statusMessage: 'Task not found' })
    }
    return data as Row
  }

  const task = await loadTask()
  if (!canRespondToDelegation(session, task, input.action)) {
    throw createError({
      statusCode: 403,
      statusMessage: input.action === 'cancel'
        ? 'Only the delegator can cancel this task'
        : 'Only the assignee can respond to this task',
    })
  }

  const targetStatus = expectedDelegationStatus(input.action)
  if (task.delegation_status === targetStatus) {
    if (
      targetStatus === 'rejected'
      && String(task.rejection_reason ?? '') !== input.reason
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Task was already rejected with another reason',
      })
    }
    const profiles = await loadOrganizationProfiles(session, [
      task.delegator_user_id,
      task.assignee_user_id,
    ])
    return {
      data: withTaskParticipants(task, profiles),
      changed: false,
    }
  }

  const transitionAllowed = input.action === 'cancel'
    ? ['pending', 'accepted'].includes(String(task.delegation_status))
    : task.delegation_status === 'pending'
  if (!transitionAllowed) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Task delegation has already been resolved',
    })
  }

  const patch = input.action === 'reject'
    ? {
        delegation_status: targetStatus,
        rejection_reason: input.reason,
      }
    : { delegation_status: targetStatus }

  const { data, error } = await session.dataApi
    .from('crm_tasks')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', taskId)
    .eq('delegation_status', task.delegation_status)
    .select(delegatedTaskSelect)
    .maybeSingle()
  throwDbError(error)

  const updated = data ? data as Row : await loadTask()
  if (!data && updated.delegation_status !== targetStatus) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Task delegation changed in another request',
    })
  }

  const profiles = await loadOrganizationProfiles(session, [
    updated.delegator_user_id,
    updated.assignee_user_id,
  ])
  if (data) await nudgeNotificationOutbox(event)
  return {
    data: withTaskParticipants(updated, profiles),
    changed: Boolean(data),
  }
})
