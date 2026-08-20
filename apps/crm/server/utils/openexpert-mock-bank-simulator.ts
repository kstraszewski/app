import { createError, type H3Event } from 'h3'
import type { CrmSession } from './crm.ts'
import { dispatchOpenExpertMockBankDocument } from './openexpert-mock-bank-actions.ts'
import { requireOpenExpertMockBankDeliveryConfigured } from './openexpert-mock-bank-delivery.ts'
import { deriveOpenExpertMockBankChildRequestId } from './openexpert-mock-bank-documents.ts'
import {
  requireOpenExpertMockBankContext,
  requireOpenExpertMockBankRecipient,
} from './openexpert-mock-bank-service.ts'
import { executeMortgageApplicationCommand } from './mortgage-application-process.ts'

export type OpenExpertMockBankEvent =
  | {
      type: 'esis_requested'
      requestId: string
      forceResend: boolean
    }
  | {
      type: 'credit_decision_requested'
      requestId: string
      forceResend: boolean
    }
  | {
      type: 'application_submitted'
      requestId: string
      expectedRevision: number
      submittedAt: string
    }

interface OpenExpertMockBankEventContext {
  event: H3Event
  session: CrmSession
  caseId: string
  applicationId: string
  bankEvent: OpenExpertMockBankEvent
}

async function deliveryPrerequisites(input: OpenExpertMockBankEventContext) {
  requireOpenExpertMockBankDeliveryConfigured(input.event, input.session.organizationId)
  return requireOpenExpertMockBankRecipient(input.event, input.session)
}

async function emitEsisRequested(input: OpenExpertMockBankEventContext) {
  const bankEvent = input.bankEvent
  if (bankEvent.type !== 'esis_requested') throw new TypeError('Nieprawidłowe zdarzenie ESIS.')
  const context = await requireOpenExpertMockBankContext(
    input.event,
    input.session,
    input.caseId,
    input.applicationId,
  )
  if (context.process.stage !== 'pre_application') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Formularz ESIS można zamówić tylko przed złożeniem wniosku.',
    })
  }
  const recipient = await deliveryPrerequisites(input)
  return dispatchOpenExpertMockBankDocument({
    event: input.event,
    session: input.session,
    caseId: input.caseId,
    context,
    kind: 'esis',
    requestId: bankEvent.requestId,
    recipient,
    forceResend: bankEvent.forceResend,
  })
}

async function emitCreditDecisionRequested(input: OpenExpertMockBankEventContext) {
  const bankEvent = input.bankEvent
  if (bankEvent.type !== 'credit_decision_requested') {
    throw new TypeError('Nieprawidłowe zdarzenie decyzji kredytowej.')
  }
  const context = await requireOpenExpertMockBankContext(
    input.event,
    input.session,
    input.caseId,
    input.applicationId,
  )
  if (context.process.stage !== 'under_review') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Decyzję można wysłać dopiero po potwierdzeniu kompletności wniosku.',
    })
  }
  const recipient = await deliveryPrerequisites(input)
  return dispatchOpenExpertMockBankDocument({
    event: input.event,
    session: input.session,
    caseId: input.caseId,
    context,
    kind: 'credit_decision',
    requestId: bankEvent.requestId,
    recipient,
    forceResend: bankEvent.forceResend,
  })
}

async function emitApplicationSubmitted(input: OpenExpertMockBankEventContext) {
  const bankEvent = input.bankEvent
  if (bankEvent.type !== 'application_submitted') {
    throw new TypeError('Nieprawidłowe zdarzenie złożenia wniosku.')
  }
  let context = await requireOpenExpertMockBankContext(
    input.event,
    input.session,
    input.caseId,
    input.applicationId,
  )
  if (!['pre_application', 'submitted', 'awaiting_completeness', 'under_review']
    .includes(context.process.stage)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wniosek nie znajduje się na etapie umożliwiającym mockowe złożenie.',
    })
  }

  // Resolve the external transport before the first canonical lifecycle
  // transition. Provider failures remain retryable through the durable outbox.
  const recipient = await deliveryPrerequisites(input)
  let stage = context.process.stage
  let revision = context.process.revision
  if (stage === 'pre_application') {
    const result = await executeMortgageApplicationCommand(
      input.event,
      input.session,
      input.caseId,
      input.applicationId,
      {
        commandId: bankEvent.requestId,
        expectedRevision: bankEvent.expectedRevision,
        command: { type: 'submit_application', submittedAt: bankEvent.submittedAt },
      },
    )
    stage = result.stage
    revision = result.revision
  }
  if (stage === 'submitted') {
    const result = await executeMortgageApplicationCommand(
      input.event,
      input.session,
      input.caseId,
      input.applicationId,
      {
        commandId: deriveOpenExpertMockBankChildRequestId(
          bankEvent.requestId,
          'acknowledge-application',
        ),
        expectedRevision: revision,
        command: { type: 'acknowledge_application', acknowledgedAt: bankEvent.submittedAt },
      },
    )
    stage = result.stage
    revision = result.revision
  }
  if (stage === 'awaiting_completeness') {
    const result = await executeMortgageApplicationCommand(
      input.event,
      input.session,
      input.caseId,
      input.applicationId,
      {
        commandId: deriveOpenExpertMockBankChildRequestId(
          bankEvent.requestId,
          'confirm-completeness',
        ),
        expectedRevision: revision,
        command: { type: 'confirm_completeness', confirmedAt: bankEvent.submittedAt },
      },
    )
    stage = result.stage
    revision = result.revision
  }
  if (stage !== 'under_review') {
    throw createError({ statusCode: 409, statusMessage: 'Bank nie potwierdził kompletności wniosku.' })
  }

  context = await requireOpenExpertMockBankContext(
    input.event,
    input.session,
    input.caseId,
    input.applicationId,
  )
  const delivery = await dispatchOpenExpertMockBankDocument({
    event: input.event,
    session: input.session,
    caseId: input.caseId,
    context,
    kind: 'credit_decision',
    requestId: deriveOpenExpertMockBankChildRequestId(
      bankEvent.requestId,
      'credit-decision-email',
    ),
    recipient,
  })
  return { ...delivery, process: { stage, revision } }
}

export async function emitOpenExpertMockBankEvent(input: OpenExpertMockBankEventContext) {
  switch (input.bankEvent.type) {
    case 'esis_requested':
      return emitEsisRequested(input)
    case 'credit_decision_requested':
      return emitCreditDecisionRequested(input)
    case 'application_submitted':
      return emitApplicationSubmitted(input)
  }
}
