import { createError } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  delegatedTaskSelect,
  loadOrganizationProfiles,
  withTaskParticipants,
} from '~~/server/utils/task-delegation'

type Row = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const caseResult = await session.supabase
    .from('crm_cases')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()
  throwDbError(caseResult.error)
  if (!caseResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const tasksResult = await session.supabase
    .from('crm_tasks')
    .select(delegatedTaskSelect)
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .neq('delegation_status', 'not_delegated')
    .order('due_at', { ascending: true })
    .order('created_at', { ascending: false })
  throwDbError(tasksResult.error)

  const tasks = (tasksResult.data ?? []) as Row[]
  if (!tasks.length) {
    return {
      data: [],
      current_user_id: session.userId,
    }
  }

  const taskIds = tasks.map(task => String(task.id))
  const [activitiesResult, meetingsResult] = await Promise.all([
    session.supabase
      .from('crm_activities')
      .select(`
        id,
        task_id,
        actor_user_id,
        activity_type,
        title,
        body,
        payload,
        created_at
      `)
      .eq('organization_id', session.organizationId)
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    session.supabase
      .from('appointments')
      .select(`
        id,
        crm_task_id,
        expert_user_id,
        facility_id,
        service_id,
        starts_at,
        ends_at,
        timezone,
        status,
        meeting_mode,
        meeting_url,
        customer_name,
        notes,
        source,
        created_at,
        updated_at
      `)
      .eq('organization_id', session.organizationId)
      .in('crm_task_id', taskIds)
      .order('starts_at', { ascending: false }),
  ])
  throwDbError(activitiesResult.error)
  throwDbError(meetingsResult.error)

  const activities = (activitiesResult.data ?? []) as Row[]
  const meetings = (meetingsResult.data ?? []) as Row[]
  const profileById = await loadOrganizationProfiles(session, [
    ...tasks.flatMap(task => [
      task.delegator_user_id ? String(task.delegator_user_id) : null,
      task.assignee_user_id ? String(task.assignee_user_id) : null,
    ]),
    ...activities.map(activity => (
      activity.actor_user_id ? String(activity.actor_user_id) : null
    )),
    ...meetings.map(meeting => (
      meeting.expert_user_id ? String(meeting.expert_user_id) : null
    )),
  ])

  const historyByTaskId = new Map<string, Row[]>()
  for (const activity of activities) {
    if (!activity.task_id) continue
    const taskId = String(activity.task_id)
    const history = historyByTaskId.get(taskId) ?? []
    const actorId = activity.actor_user_id
      ? String(activity.actor_user_id)
      : null
    history.push({
      ...activity,
      actor: actorId ? profileById.get(actorId) ?? null : null,
    })
    historyByTaskId.set(taskId, history)
  }

  const meetingsByTaskId = new Map<string, Row[]>()
  for (const meeting of meetings) {
    if (!meeting.crm_task_id) continue
    const taskId = String(meeting.crm_task_id)
    const taskMeetings = meetingsByTaskId.get(taskId) ?? []
    const expertId = meeting.expert_user_id
      ? String(meeting.expert_user_id)
      : null
    taskMeetings.push({
      ...meeting,
      expert: expertId ? profileById.get(expertId) ?? null : null,
    })
    meetingsByTaskId.set(taskId, taskMeetings)
  }

  return {
    data: tasks.map(task => ({
      ...withTaskParticipants(task, profileById),
      history: historyByTaskId.get(String(task.id)) ?? [],
      meetings: meetingsByTaskId.get(String(task.id)) ?? [],
    })),
    current_user_id: session.userId,
  }
})
