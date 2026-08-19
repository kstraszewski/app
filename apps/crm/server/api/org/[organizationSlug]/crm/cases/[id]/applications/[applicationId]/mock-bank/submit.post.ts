import { createError, readBody } from 'h3'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import { asRecord, getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { dispatchOpenExpertMockBankDocument } from '~~/server/utils/openexpert-mock-bank-actions'
import { requireOpenExpertMockBankDeliveryConfigured } from '~~/server/utils/openexpert-mock-bank-delivery'
import {
  assertOpenExpertMockBankRequestId,
  deriveOpenExpertMockBankChildRequestId,
} from '~~/server/utils/openexpert-mock-bank-documents'
import {
  requireOpenExpertMockBankContext,
  requireOpenExpertMockBankRecipient,
} from '~~/server/utils/openexpert-mock-bank-service'
import { executeMortgageApplicationCommand } from '~~/server/utils/mortgage-application-process'

function requestIdValue(value: unknown): string {
  try {
    return assertOpenExpertMockBankRequestId(value)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Identyfikator złożenia wniosku jest nieprawidłowy.' })
  }
}

function expectedRevisionValue(value: unknown): number {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Rewizja procesu jest nieprawidłowa.' })
  }
  return revision
}

function submittedAtValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Data złożenia wniosku jest wymagana.' })
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw createError({ statusCode: 400, statusMessage: 'Data złożenia wniosku jest nieprawidłowa.' })
  }
  return new Date(timestamp).toISOString()
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const applicationId = getRequiredParam(event, 'applicationId')
  assertUuid(applicationId, 'application id')
  await requireCrmCase(session, caseId)

  const body = asRecord(await readBody(event))
  const unsupported = Object.keys(body)
    .filter(key => !['requestId', 'expectedRevision', 'submittedAt'].includes(key))
  if (unsupported.length) {
    throw createError({ statusCode: 400, statusMessage: `Nieobsługiwane pola: ${unsupported.join(', ')}` })
  }
  const requestId = requestIdValue(body.requestId)
  const expectedRevision = expectedRevisionValue(body.expectedRevision)
  const submittedAt = submittedAtValue(body.submittedAt)
  let context = await requireOpenExpertMockBankContext(
    event,
    session,
    caseId,
    applicationId,
  )
  if (!['pre_application', 'submitted', 'awaiting_completeness', 'under_review'].includes(context.process.stage)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wniosek nie znajduje się na etapie umożliwiającym mockowe złożenie.',
    })
  }

  // Validate all external prerequisites before committing the first lifecycle
  // transition. A later provider failure remains safely retryable through the
  // durable dispatch ledger and the canonical command event log.
  requireOpenExpertMockBankDeliveryConfigured(event, session.organizationId)
  const recipient = await requireOpenExpertMockBankRecipient(event, session)

  let stage = context.process.stage
  let revision = context.process.revision
  if (stage === 'pre_application') {
    const result = await executeMortgageApplicationCommand(event, session, caseId, applicationId, {
      commandId: requestId,
      expectedRevision,
      command: { type: 'submit_application', submittedAt },
    })
    stage = result.stage
    revision = result.revision
  }
  if (stage === 'submitted') {
    const result = await executeMortgageApplicationCommand(event, session, caseId, applicationId, {
      commandId: deriveOpenExpertMockBankChildRequestId(requestId, 'acknowledge-application'),
      expectedRevision: revision,
      command: { type: 'acknowledge_application', acknowledgedAt: submittedAt },
    })
    stage = result.stage
    revision = result.revision
  }
  if (stage === 'awaiting_completeness') {
    const result = await executeMortgageApplicationCommand(event, session, caseId, applicationId, {
      commandId: deriveOpenExpertMockBankChildRequestId(requestId, 'confirm-completeness'),
      expectedRevision: revision,
      command: { type: 'confirm_completeness', confirmedAt: submittedAt },
    })
    stage = result.stage
    revision = result.revision
  }
  if (stage !== 'under_review') {
    throw createError({ statusCode: 409, statusMessage: 'Bank nie potwierdził kompletności wniosku.' })
  }

  context = await requireOpenExpertMockBankContext(event, session, caseId, applicationId)
  const delivery = await dispatchOpenExpertMockBankDocument({
    event,
    session,
    caseId,
    context,
    kind: 'credit_decision',
    requestId: deriveOpenExpertMockBankChildRequestId(requestId, 'credit-decision-email'),
    recipient,
  })
  return {
    ...delivery,
    process: { stage, revision },
  }
})
