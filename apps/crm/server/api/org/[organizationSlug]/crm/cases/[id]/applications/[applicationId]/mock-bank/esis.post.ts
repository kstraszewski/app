import { createError, readBody } from 'h3'
import { dispatchOpenExpertMockBankDocument } from '~~/server/utils/openexpert-mock-bank-actions'
import { requireOpenExpertMockBankDeliveryConfigured } from '~~/server/utils/openexpert-mock-bank-delivery'
import { assertOpenExpertMockBankRequestId } from '~~/server/utils/openexpert-mock-bank-documents'
import {
  requireOpenExpertMockBankContext,
  requireOpenExpertMockBankRecipient,
} from '~~/server/utils/openexpert-mock-bank-service'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import { asRecord, getRequiredParam, requireCrmSession } from '~~/server/utils/crm'

function requestIdValue(value: unknown): string {
  try {
    return assertOpenExpertMockBankRequestId(value)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Identyfikator wysyłki jest nieprawidłowy.' })
  }
}

function forceResendValue(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Flaga ponownej wysyłki musi być wartością logiczną.' })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const applicationId = getRequiredParam(event, 'applicationId')
  assertUuid(applicationId, 'application id')
  await requireCrmCase(session, caseId)

  const body = asRecord(await readBody(event))
  const unsupported = Object.keys(body).filter(key => !['requestId', 'forceResend'].includes(key))
  if (unsupported.length) {
    throw createError({ statusCode: 400, statusMessage: `Nieobsługiwane pola: ${unsupported.join(', ')}` })
  }
  const requestId = requestIdValue(body.requestId)
  const forceResend = forceResendValue(body.forceResend)
  const context = await requireOpenExpertMockBankContext(
    event,
    session,
    caseId,
    applicationId,
  )
  if (context.process.stage !== 'pre_application') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Formularz ESIS można zamówić tylko przed złożeniem wniosku.',
    })
  }
  requireOpenExpertMockBankDeliveryConfigured(event, session.organizationId)
  const recipient = await requireOpenExpertMockBankRecipient(event, session)
  return dispatchOpenExpertMockBankDocument({
    event,
    session,
    caseId,
    context,
    kind: 'esis',
    requestId,
    recipient,
    forceResend,
  })
})
