import {
  CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH,
  type CrmAgentMailThreadReadResponse,
} from '../../../../shared/types/agent-mail.ts'
import { assertCrmAgentMailRateLimit } from '~~/server/utils/mail-agent-rate-limit'
import {
  readCrmAgentMailRequest,
  requireCrmAgentMailSession,
} from '~~/server/utils/mail-agent-service'
import { readMailAgentThreads } from '~~/server/utils/mail-agent-thread'

function invalidRequest(): never {
  throw createError({ statusCode: 400, statusMessage: 'Parametry odczytu wątków są nieprawidłowe.' })
}

function requiredReferences(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return invalidRequest()
  const references = value.map((item) => {
    if (typeof item !== 'string') return invalidRequest()
    const reference = item.trim()
    if (
      !reference
      || reference.length > CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH
      || !/^[A-Za-z0-9_-]+$/u.test(reference)
    ) return invalidRequest()
    return reference
  })
  if (new Set(references).size !== references.length) return invalidRequest()
  return references
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

export default defineEventHandler(async (event): Promise<CrmAgentMailThreadReadResponse> => {
  const session = await requireCrmAgentMailSession(event)
  await assertCrmAgentMailRateLimit(event, session.userId, 'thread')
  const body = await readCrmAgentMailRequest(event)
  if (Object.keys(body).some(key => !['references', 'question'].includes(key))) invalidRequest()
  return readMailAgentThreads(
    event,
    session,
    requiredReferences(body.references),
    optionalQuestion(body.question),
  )
})
