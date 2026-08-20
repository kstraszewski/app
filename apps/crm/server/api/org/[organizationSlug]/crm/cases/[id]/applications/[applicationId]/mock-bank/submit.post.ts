import { createError, readBody } from 'h3'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import { asRecord, getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { assertOpenExpertMockBankRequestId } from '~~/server/utils/openexpert-mock-bank-documents'
import { emitOpenExpertMockBankEvent } from '~~/server/utils/openexpert-mock-bank-simulator'

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
  return emitOpenExpertMockBankEvent({
    event,
    session,
    caseId,
    applicationId,
    bankEvent: {
      type: 'application_submitted',
      requestId,
      expectedRevision,
      submittedAt,
    },
  })
})
