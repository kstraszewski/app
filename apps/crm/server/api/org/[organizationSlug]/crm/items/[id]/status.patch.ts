import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const statusCode = requiredText(body.status_code, 'status_code')
  const expectedUpdatedAt = textValue(body.expected_updated_at)

  const itemResult = await session.dataApi
    .from('crm_case_items')
    .select('id, case_id, product_type_id, owner_user_id, status_code, updated_at')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle()
  throwDbError(itemResult.error)
  if (!itemResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Process not found' })
  }

  const [caseResult, productTypeResult] = await Promise.all([
    session.dataApi
      .from('crm_cases')
      .select('id, client_id, owner_user_id')
      .eq('organization_id', session.organizationId)
      .eq('id', itemResult.data.case_id)
      .maybeSingle(),
    session.dataApi
      .from('crm_product_types')
      .select('id, domain')
      .eq('id', itemResult.data.product_type_id)
      .maybeSingle(),
  ])
  throwDbError(caseResult.error)
  throwDbError(productTypeResult.error)
  if (!caseResult.data || !productTypeResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Process not found' })
  }

  const canChangeStatus = session.role === 'admin'
    || String(caseResult.data.owner_user_id ?? '') === session.userId
    || String(itemResult.data.owner_user_id ?? '') === session.userId
  if (!canChangeStatus) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the case owner or process owner can change this stage',
    })
  }

  const workflowsResult = await session.dataApi
    .from('crm_workflows')
    .select('id, organization_id, code')
    .eq('scope', 'case_item')
    .eq('domain', productTypeResult.data.domain)
    .eq('is_default', true)
    .or(`organization_id.is.null,organization_id.eq.${session.organizationId}`)
  throwDbError(workflowsResult.error)
  const workflows = (workflowsResult.data ?? []) as Array<{
    id: string
    organization_id: string | null
    code: string
  }>
  const workflow = workflows.find(row => row.organization_id === session.organizationId)
    ?? workflows.find(row => row.organization_id == null)
  if (!workflow) {
    throw createError({
      statusCode: 409,
      statusMessage: 'No workflow is configured for this process type',
    })
  }

  const stageResult = await session.dataApi
    .from('crm_workflow_statuses')
    .select('code, label, is_terminal')
    .eq('workflow_id', workflow.id)
    .eq('code', statusCode)
    .maybeSingle()
  throwDbError(stageResult.error)
  if (!stageResult.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The selected stage does not belong to this process workflow',
    })
  }

  const now = new Date().toISOString()
  const isLostStage = /(?:utracon|odrzucon|wycofan)/i.test(statusCode)
  const patch: Record<string, unknown> = {
    status_code: statusCode,
    won_at: stageResult.data.is_terminal && !isLostStage ? now : null,
    lost_at: stageResult.data.is_terminal && isLostStage ? now : null,
  }

  let updateQuery = session.dataApi
    .from('crm_case_items')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt ?? itemResult.data.updated_at)
  updateQuery = updateQuery.select('*')
  const { data, error } = await updateQuery.maybeSingle()

  throwDbError(error)
  if (!data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The process changed in the meantime; refresh and try again',
    })
  }

  await recordCrmActivity(session, {
    client_id: caseResult.data.client_id,
    case_id: data.case_id,
    case_item_id: id,
    activity_type: 'status_changed',
    title: 'Zmieniono etap procesu',
    body: textValue(body.note),
    payload: {
      workflow_id: workflow.id,
      workflow_code: workflow.code,
      previous_status_code: itemResult.data.status_code,
      status_code: statusCode,
    },
  })

  return { data }
})
