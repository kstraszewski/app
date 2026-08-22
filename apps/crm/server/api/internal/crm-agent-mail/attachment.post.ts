import type { CrmAgentMailAttachmentReadResponse } from '../../../../shared/types/agent-mail.ts'
import { readMailAgentAttachment } from '~~/server/utils/mail-agent-attachment'
import { assertCrmAgentMailRateLimit } from '~~/server/utils/mail-agent-rate-limit'
import {
  readCrmAgentMailRequest,
  requireCrmAgentMailSession,
} from '~~/server/utils/mail-agent-service'

function invalidRequest(): never {
  throw createError({ statusCode: 400, statusMessage: 'Parametry odczytu załącznika są nieprawidłowe.' })
}

function requiredReference(value: unknown): string {
  if (typeof value !== 'string') return invalidRequest()
  const reference = value.trim()
  if (!reference) return invalidRequest()
  return reference
}

function optionalQuestion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return invalidRequest()
  const question = value.trim()
  if (
    question.length < 2
    || question.length > 500
    || /[\u0000-\u001F\u007F]/u.test(question)
  ) return invalidRequest()
  return question
}

export default defineEventHandler(async (event): Promise<CrmAgentMailAttachmentReadResponse> => {
  const session = await requireCrmAgentMailSession(event)
  await assertCrmAgentMailRateLimit(event, session.userId, 'attachment')
  const body = await readCrmAgentMailRequest(event)
  const allowedFields = new Set(['reference', 'question'])
  if (Object.keys(body).some(key => !allowedFields.has(key))) invalidRequest()

  return readMailAgentAttachment(
    event,
    session,
    requiredReference(body.reference),
    optionalQuestion(body.question),
  )
})
