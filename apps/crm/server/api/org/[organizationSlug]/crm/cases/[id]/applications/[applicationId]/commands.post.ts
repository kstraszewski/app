import { createError, readBody } from 'h3'
import {
  loadCaseBankApplication,
  requireCaseBankApplicationManager,
} from '~~/server/utils/case-bank-applications'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import {
  executeMortgageApplicationCommand,
} from '~~/server/utils/mortgage-application-process'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
} from '~~/server/utils/crm'

const commandActivity: Record<string, { type: string, title: string }> = {
  deliver_artifact: {
    type: 'mortgage_artifact_delivered',
    title: 'Zarejestrowano przekazanie dokumentu hipotecznego',
  },
  submit_application: {
    type: 'mortgage_application_submitted',
    title: 'Zarejestrowano wysłanie wniosku do banku',
  },
  acknowledge_application: {
    type: 'mortgage_application_acknowledged',
    title: 'Bank potwierdził otrzymanie wniosku',
  },
  confirm_completeness: {
    type: 'mortgage_application_completeness_confirmed',
    title: 'Bank potwierdził kompletność wniosku',
  },
  request_additional_information: {
    type: 'mortgage_application_information_requested',
    title: 'Bank zgłosił braki we wniosku',
  },
  resume_review: {
    type: 'mortgage_application_review_resumed',
    title: 'Wznowiono analizę wniosku',
  },
  record_early_decision_consent: {
    type: 'mortgage_early_decision_consent_recorded',
    title: 'Zarejestrowano decyzję klienta o wcześniejszym przekazaniu decyzji',
  },
  complete_application: {
    type: 'mortgage_application_completed',
    title: 'Zakończono proces wniosku hipotecznego',
  },
  close_application: {
    type: 'mortgage_application_closed',
    title: 'Zamknięto proces wniosku hipotecznego',
  },
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const applicationId = getRequiredParam(event, 'applicationId')
  assertUuid(applicationId, 'application id')
  await requireCrmCase(session, caseId)

  const application = await loadCaseBankApplication(session, caseId, applicationId)
  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Bank application not found' })
  }
  await requireCaseBankApplicationManager(session, caseId, application)

  const body = asRecord(await readBody(event))
  const command = asRecord(body.command)
  const commandType = typeof command.type === 'string' ? command.type : ''
  if (commandType === 'attach_artifact') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Mortgage artifacts must be attached through the validated PDF upload endpoint',
    })
  }
  const result = await executeMortgageApplicationCommand(
    event,
    session,
    caseId,
    applicationId,
    body,
  )

  const activity = commandActivity[commandType]
  if (activity) {
    try {
      await recordCrmActivity(session, {
        case_id: caseId,
        submission_id: applicationId,
        activity_type: activity.type,
        title: activity.title,
        payload: {
          application_id: applicationId,
          command_id: body.commandId,
          command_type: commandType,
          revision: result.revision,
        },
      })
    }
    catch (error) {
      // The process command has already committed; activity is a secondary projection.
      console.error('[mortgage-commands] failed to record secondary CRM activity', error)
    }
  }

  return { data: result }
})
