import { getQuery } from 'h3'
import { requireCrmSession, textValue, throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const scope = textValue(getQuery(event).scope)

  let workflowRequest = session.supabase
    .from('crm_workflows')
    .select('*')
    .order('scope')
    .order('name')

  if (scope) workflowRequest = workflowRequest.eq('scope', scope)

  const [{ data: workflows, error: workflowsError }, { data: statuses, error: statusesError }] = await Promise.all([
    workflowRequest,
    session.supabase
      .from('crm_workflow_statuses')
      .select('*')
      .order('sort_order'),
  ])

  throwDbError(workflowsError)
  throwDbError(statusesError)

  const statusesByWorkflow = new Map<string, unknown[]>()
  for (const status of (statuses ?? []) as Row[]) {
    const workflowId = String(status.workflow_id)
    statusesByWorkflow.set(workflowId, [...(statusesByWorkflow.get(workflowId) ?? []), status])
  }

  return {
    data: ((workflows ?? []) as Row[]).map((workflow: Row) => ({
      ...workflow,
      statuses: statusesByWorkflow.get(String(workflow.id)) ?? [],
    })),
  }
})
