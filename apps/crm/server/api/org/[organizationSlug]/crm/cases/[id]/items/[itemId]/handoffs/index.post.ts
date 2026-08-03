import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readBody, setResponseStatus } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  assertProcessHandoffFingerprint,
  canHandoffProcess,
  loadProcessHandoffProfiles,
  parseProcessHandoffRequest,
  processHandoffFingerprint,
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
  if (!caseUuidPattern.test(caseId) || !caseUuidPattern.test(caseItemId)) {
    throw createError({ statusCode: 404, statusMessage: 'Process not found' })
  }

  const input = parseProcessHandoffRequest(await readBody(event))
  const fingerprint = processHandoffFingerprint({
    organizationId: session.organizationId,
    caseId,
    caseItemId,
    requestedByUserId: session.userId,
    proposedOwnerUserId: input.proposedOwnerUserId,
    requestNote: input.requestNote,
  })

  const existingResult = await session.dataApi
    .from('crm_case_item_handoffs')
    .select('id, idempotency_fingerprint')
    .eq('organization_id', session.organizationId)
    .eq('requested_by_user_id', session.userId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  throwDbError(existingResult.error)
  if (
    existingResult.data
    && assertProcessHandoffFingerprint(
      existingResult.data.idempotency_fingerprint,
    ) !== fingerprint
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Idempotency key was already used for another process handoff',
    })
  }

  if (!existingResult.data) {
    const [caseResult, itemResult, membershipResult] = await Promise.all([
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
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', session.organizationId)
        .eq('user_id', input.proposedOwnerUserId)
        .maybeSingle(),
    ])
    throwDbError(caseResult.error)
    throwDbError(itemResult.error)
    throwDbError(membershipResult.error)

    if (!caseResult.data || !itemResult.data) {
      throw createError({ statusCode: 404, statusMessage: 'Process not found' })
    }
    if (!membershipResult.data) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Proposed owner must belong to this organization',
      })
    }
    if (!canHandoffProcess(session, caseResult.data, itemResult.data)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only the process owner or case owner can hand off this process',
      })
    }
    if (itemResult.data.owner_user_id === input.proposedOwnerUserId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'The proposed owner already owns this process',
      })
    }
  }

  const backendData = serverDataBackend(event) as any
  const { data: rpcResult, error: rpcError } = await backendData.rpc(
    'request_crm_case_item_handoff',
    {
      p_request: {
        organization_id: session.organizationId,
        case_id: caseId,
        case_item_id: caseItemId,
        requested_by_user_id: session.userId,
        proposed_owner_user_id: input.proposedOwnerUserId,
        request_note: input.requestNote,
        idempotency_key: input.idempotencyKey,
        idempotency_fingerprint: fingerprint,
      },
    },
  )
  if (rpcError) throwProcessHandoffRpcError(rpcError)

  const result = (rpcResult ?? {}) as Row
  const handoffId = typeof result.handoffId === 'string'
    ? result.handoffId
    : null
  if (!handoffId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Process handoff request did not return a handoff',
    })
  }

  const handoffResult = await session.dataApi
    .from('crm_case_item_handoffs')
    .select(processHandoffSelect)
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('case_item_id', caseItemId)
    .eq('id', handoffId)
    .single()
  throwDbError(handoffResult.error)

  const handoff = handoffResult.data as Row
  const profiles = await loadProcessHandoffProfiles(session, [
    handoff.previous_owner_user_id,
    handoff.proposed_owner_user_id,
    handoff.requested_by_user_id,
    handoff.resolved_by_user_id,
  ])
  const created = result.created === true
  if (created) setResponseStatus(event, 201)
  if (created) await nudgeNotificationOutbox(event)

  return {
    data: withProcessHandoffProfiles(handoff, profiles),
    created,
  }
})
