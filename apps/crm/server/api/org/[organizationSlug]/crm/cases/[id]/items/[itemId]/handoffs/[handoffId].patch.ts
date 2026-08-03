import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readBody } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  canRespondToProcessHandoff,
  loadProcessHandoffProfiles,
  parseProcessHandoffResponse,
  processHandoffSelect,
  throwProcessHandoffRpcError,
  withProcessHandoffProfiles,
} from '~~/server/utils/process-handoff'
import { nudgeNotificationOutbox } from '~~/server/utils/notifications'

type Row = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const caseItemId = getRequiredParam(event, 'itemId')
  const handoffId = getRequiredParam(event, 'handoffId')
  if (
    !caseUuidPattern.test(caseId)
    || !caseUuidPattern.test(caseItemId)
    || !caseUuidPattern.test(handoffId)
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Process handoff not found' })
  }

  const input = parseProcessHandoffResponse(await readBody(event))
  const [caseResult, itemResult, handoffResult] = await Promise.all([
    session.dataApi
      .from('crm_cases')
      .select('id, owner_user_id')
      .eq('organization_id', session.organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    session.dataApi
      .from('crm_case_items')
      .select('id, owner_user_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('id', caseItemId)
      .maybeSingle(),
    session.dataApi
      .from('crm_case_item_handoffs')
      .select(processHandoffSelect)
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('case_item_id', caseItemId)
      .eq('id', handoffId)
      .maybeSingle(),
  ])
  throwDbError(caseResult.error)
  throwDbError(itemResult.error)
  throwDbError(handoffResult.error)

  if (!caseResult.data || !itemResult.data || !handoffResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Process handoff not found' })
  }
  if (!canRespondToProcessHandoff(
    session,
    handoffResult.data,
    input.action,
    caseResult.data,
    itemResult.data,
  )) {
    throw createError({
      statusCode: 403,
      statusMessage: input.action === 'cancel'
        ? 'You cannot cancel this process handoff'
        : 'Only the proposed owner can respond to this process handoff',
    })
  }

  const backendData = serverDataBackend(event) as any
  const { data: rpcResult, error: rpcError } = await backendData.rpc(
    'respond_crm_case_item_handoff',
    {
      p_handoff_id: handoffId,
      p_actor_user_id: session.userId,
      p_action: input.action,
      p_response_note: input.responseNote,
    },
  )
  if (rpcError) throwProcessHandoffRpcError(rpcError)

  const result = (rpcResult ?? {}) as Row
  const resolvedHandoffId = typeof result.handoffId === 'string'
    ? result.handoffId
    : null
  if (resolvedHandoffId !== handoffId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Process handoff response did not return the expected handoff',
    })
  }

  const updatedResult = await session.dataApi
    .from('crm_case_item_handoffs')
    .select(processHandoffSelect)
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('case_item_id', caseItemId)
    .eq('id', handoffId)
    .single()
  throwDbError(updatedResult.error)

  const handoff = updatedResult.data as Row
  const profiles = await loadProcessHandoffProfiles(session, [
    handoff.previous_owner_user_id,
    handoff.proposed_owner_user_id,
    handoff.requested_by_user_id,
    handoff.resolved_by_user_id,
  ])
  const changed = result.replayed !== true
  if (changed) await nudgeNotificationOutbox(event)

  return {
    data: withProcessHandoffProfiles(handoff, profiles),
    changed,
  }
})
