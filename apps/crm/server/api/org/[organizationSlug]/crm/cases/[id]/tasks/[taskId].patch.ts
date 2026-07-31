import { createError, readBody } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  canUpdateDelegatedTaskStatus,
  delegatedTaskSelect,
  loadOrganizationProfiles,
  parseDelegatedTaskStatus,
  withTaskParticipants,
} from '~~/server/utils/task-delegation'

type Row = Record<string, any> & {
  assignee_user_id: string | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const taskId = getRequiredParam(event, 'taskId')
  if (!caseUuidPattern.test(caseId) || !caseUuidPattern.test(taskId)) {
    throw createError({ statusCode: 404, statusMessage: 'Task not found' })
  }
  const statusCode = parseDelegatedTaskStatus(await readBody(event))

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
  if (!canUpdateDelegatedTaskStatus(session, task)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the assignee can update this task',
    })
  }
  if (task.delegation_status !== 'accepted') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Task must be accepted before work can start',
    })
  }

  if (task.status_code === statusCode) {
    const profiles = await loadOrganizationProfiles(session, [
      task.delegator_user_id,
      task.assignee_user_id,
    ])
    return {
      data: withTaskParticipants(task, profiles),
      changed: false,
    }
  }

  const { data, error } = await session.dataApi
    .from('crm_tasks')
    .update({ status_code: statusCode })
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', taskId)
    .eq('delegation_status', 'accepted')
    .eq('status_code', task.status_code)
    .select(delegatedTaskSelect)
    .maybeSingle()
  throwDbError(error)

  const updated = data ? data as Row : await loadTask()
  if (!data && updated.status_code !== statusCode) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Task status changed in another request',
    })
  }

  const profiles = await loadOrganizationProfiles(session, [
    updated.delegator_user_id,
    updated.assignee_user_id,
  ])
  return {
    data: withTaskParticipants(updated, profiles),
    changed: Boolean(data),
  }
})
