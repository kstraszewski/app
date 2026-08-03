import { createError, type H3Event } from 'h3'
import {
  coBorrowerPlans,
  comfortablePaymentChoices,
  emptyMeetingPreparationProfile,
  loanAmountChoices,
  loanTermChoices,
  meetingGoals,
  meetingIncomeSources,
  meetingStages,
  monthlyNetIncomeChoices,
  monthlyObligationChoices,
  ownFundsChoices,
  propertyBudgetChoices,
  type MeetingPreparationAnswers,
  type PortalMeetingPreparation,
  type SaveMeetingPreparationBody,
} from '../../shared/types/meeting-preparation'
import { serverDataBackend } from './data-api'
import {
  loadClientPortalSession,
  normalizeClientEmail,
  requiredUuid,
  throwPortalDbError,
} from './portal-auth'

type Row = Record<string, any>

const meetingUuidPattern
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const preparationProfileKeys = [
  'goal',
  'stage',
  'incomeSources',
  'coBorrower',
  'propertyBudget',
  'ownFunds',
  'loanAmount',
  'loanTerm',
  'monthlyNetIncome',
  'monthlyObligations',
  'comfortablePayment',
] as const

const preparationAnswerKeys = [
  'version',
  'activeStep',
  'profile',
  'readConceptIds',
  'checkedItemIds',
  'selectedQuestionIds',
] as const

const meetingConceptIds = new Set([
  'capacity-vs-budget',
  'interest-rate',
  'rrso-total-cost',
  'installments',
  'additional-products',
  'early-repayment',
])

const preparationChecklistIds = new Set([
  'goal-budget',
  'comfortable-payment',
  'liabilities',
  'household',
  'own-funds',
  'employment-details',
  'business-details',
  'civil-contract-details',
  'foreign-income-details',
  'other-income-details',
  'property-details',
  'agreement-deadlines',
  'construction-details',
  'current-loan',
  'property-direction',
])

const expertQuestionIds = new Set([
  'safe-budget',
  'personal-risks',
  'property-risks',
  'refinance-threshold',
  'rate-scenarios',
  'total-cost',
  'cross-sell',
  'early-repayment',
  'offer-scope',
  'compensation',
  'timeline',
  'plan-b',
])

const preparationSelect = [
  'organization_id',
  'case_id',
  'appointment_id',
  'client_id',
  'client_person_id',
  'answers',
  'revision',
  'completed_at',
  'updated_at',
].join(', ')

interface PortalMeetingPreparationScope {
  organizationId: string
  caseId: string
  appointmentId: string
  clientId: string
  clientPersonId: string
  authUserId: string
}

function invalidPreparation(message = 'Invalid meeting preparation'): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidPreparation(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  label = 'value',
): void {
  const allowed = new Set([...required, ...optional])
  if (
    required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !allowed.has(key))
  ) {
    invalidPreparation(`${label} has unsupported or missing fields`)
  }
}

function nullableChoice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  label: string,
): T[number] | null {
  if (value === null) return null
  if (
    typeof value === 'string'
    && (choices as readonly string[]).includes(value)
  ) return value as T[number]
  return invalidPreparation(`${label} is invalid`)
}

function uniqueChoiceArray<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  label: string,
): T[number][] {
  if (!Array.isArray(value) || value.length > choices.length) {
    return invalidPreparation(`${label} is invalid`)
  }
  if (value.some(item => (
    typeof item !== 'string'
    || !(choices as readonly string[]).includes(item)
  ))) return invalidPreparation(`${label} is invalid`)
  if (new Set(value).size !== value.length) {
    return invalidPreparation(`${label} contains duplicates`)
  }
  return value as T[number][]
}

function uniqueIdArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string[] {
  if (!Array.isArray(value) || value.length > allowed.size) {
    return invalidPreparation(`${label} is invalid`)
  }
  if (value.some(item => typeof item !== 'string' || !allowed.has(item))) {
    return invalidPreparation(`${label} is invalid`)
  }
  if (new Set(value).size !== value.length) {
    return invalidPreparation(`${label} contains duplicates`)
  }
  return value as string[]
}

export function emptyMeetingPreparationAnswers(): MeetingPreparationAnswers {
  return {
    version: 2,
    activeStep: 0,
    profile: emptyMeetingPreparationProfile(),
    readConceptIds: [],
    checkedItemIds: [],
    selectedQuestionIds: [],
  }
}

export function parseMeetingPreparationAnswers(
  value: unknown,
): MeetingPreparationAnswers {
  const answers = recordValue(value, 'answers')
  exactKeys(answers, preparationAnswerKeys, [], 'answers')
  if (answers.version !== 2) invalidPreparation('answers.version is invalid')
  if (
    !Number.isInteger(answers.activeStep)
    || Number(answers.activeStep) < 0
    || Number(answers.activeStep) > 4
  ) invalidPreparation('answers.activeStep is invalid')

  const profile = recordValue(answers.profile, 'answers.profile')
  exactKeys(profile, preparationProfileKeys, [], 'answers.profile')

  const normalized: MeetingPreparationAnswers = {
    version: 2,
    activeStep: Number(answers.activeStep),
    profile: {
      goal: nullableChoice(profile.goal, meetingGoals, 'answers.profile.goal'),
      stage: nullableChoice(profile.stage, meetingStages, 'answers.profile.stage'),
      incomeSources: uniqueChoiceArray(
        profile.incomeSources,
        meetingIncomeSources,
        'answers.profile.incomeSources',
      ),
      coBorrower: nullableChoice(
        profile.coBorrower,
        coBorrowerPlans,
        'answers.profile.coBorrower',
      ),
      propertyBudget: nullableChoice(
        profile.propertyBudget,
        propertyBudgetChoices,
        'answers.profile.propertyBudget',
      ),
      ownFunds: nullableChoice(
        profile.ownFunds,
        ownFundsChoices,
        'answers.profile.ownFunds',
      ),
      loanAmount: nullableChoice(
        profile.loanAmount,
        loanAmountChoices,
        'answers.profile.loanAmount',
      ),
      loanTerm: nullableChoice(
        profile.loanTerm,
        loanTermChoices,
        'answers.profile.loanTerm',
      ),
      monthlyNetIncome: nullableChoice(
        profile.monthlyNetIncome,
        monthlyNetIncomeChoices,
        'answers.profile.monthlyNetIncome',
      ),
      monthlyObligations: nullableChoice(
        profile.monthlyObligations,
        monthlyObligationChoices,
        'answers.profile.monthlyObligations',
      ),
      comfortablePayment: nullableChoice(
        profile.comfortablePayment,
        comfortablePaymentChoices,
        'answers.profile.comfortablePayment',
      ),
    },
    readConceptIds: uniqueIdArray(
      answers.readConceptIds,
      meetingConceptIds,
      'answers.readConceptIds',
    ),
    checkedItemIds: uniqueIdArray(
      answers.checkedItemIds,
      preparationChecklistIds,
      'answers.checkedItemIds',
    ),
    selectedQuestionIds: uniqueIdArray(
      answers.selectedQuestionIds,
      expertQuestionIds,
      'answers.selectedQuestionIds',
    ),
  }

  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 32 * 1024) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Meeting preparation is too large',
    })
  }
  return normalized
}

export function parseMeetingPreparationSaveBody(
  value: unknown,
): SaveMeetingPreparationBody {
  const body = recordValue(value, 'body')
  exactKeys(body, ['answers', 'revision'], ['completed'], 'body')
  if (
    !Number.isSafeInteger(body.revision)
    || Number(body.revision) < 0
  ) invalidPreparation('revision is invalid')
  if (
    Object.hasOwn(body, 'completed')
    && typeof body.completed !== 'boolean'
  ) invalidPreparation('completed must be a boolean')
  const completed = typeof body.completed === 'boolean'
    ? body.completed
    : undefined

  return {
    answers: parseMeetingPreparationAnswers(body.answers),
    revision: Number(body.revision),
    ...(completed === undefined ? {} : { completed }),
  }
}

export function meetingPreparationCaseId(
  bookingContext: unknown,
): string | null {
  if (
    !bookingContext
    || typeof bookingContext !== 'object'
    || Array.isArray(bookingContext)
  ) return null
  const meeting = (bookingContext as Record<string, unknown>).crmMeeting
  if (!meeting || typeof meeting !== 'object' || Array.isArray(meeting)) return null
  const context = meeting as Record<string, unknown>
  if (
    context.version !== 1
    || context.relationship !== 'first'
    || typeof context.caseId !== 'string'
    || !meetingUuidPattern.test(context.caseId)
  ) return null
  return context.caseId.toLowerCase()
}

function inaccessibleAppointment(): never {
  throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
}

async function requirePortalMeetingPreparationScope(
  event: H3Event,
  appointmentIdInput: unknown,
): Promise<PortalMeetingPreparationScope> {
  const appointmentId = requiredUuid(appointmentIdInput, 'appointmentId')
  const session = await loadClientPortalSession(event)
  if (!session.links.length) return inaccessibleAppointment()

  const backend = serverDataBackend(event) as any
  const appointmentResult = await backend
    .from('appointments')
    .select(`
      id,
      organization_id,
      client_id,
      client_person_id,
      customer_email,
      status,
      booking_context
    `)
    .eq('id', appointmentId)
    .maybeSingle()
  throwPortalDbError(
    appointmentResult.error,
    'could not load meeting preparation appointment',
  )
  const appointment = appointmentResult.data as Row | null
  if (!appointment || appointment.status !== 'confirmed') {
    return inaccessibleAppointment()
  }

  const organizationId = String(appointment.organization_id)
  const clientId = String(appointment.client_id)
  const clientPersonId = String(appointment.client_person_id)
  const link = session.links.find(candidate => (
    candidate.organizationId === organizationId
    && candidate.clientId === clientId
    && candidate.clientPersonId === clientPersonId
    && candidate.verifiedEmail === normalizeClientEmail(appointment.customer_email)
  ))
  if (!link) return inaccessibleAppointment()

  const caseId = meetingPreparationCaseId(appointment.booking_context)
  if (!caseId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Appointment is not linked to a first-meeting case',
    })
  }

  const caseClientResult = await backend
    .from('crm_case_clients')
    .select('organization_id, case_id, client_id')
    .eq('organization_id', organizationId)
    .eq('case_id', caseId)
    .eq('client_id', clientId)
    .maybeSingle()
  throwPortalDbError(
    caseClientResult.error,
    'could not validate meeting preparation case',
  )
  if (!caseClientResult.data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Appointment case does not match its client',
    })
  }

  return {
    organizationId,
    caseId,
    appointmentId,
    clientId,
    clientPersonId,
    authUserId: session.identity.userId,
  }
}

function publicPreparation(
  scope: PortalMeetingPreparationScope,
  row: Row | null,
): PortalMeetingPreparation {
  return {
    caseId: scope.caseId,
    appointmentId: scope.appointmentId,
    answers: row
      ? parseMeetingPreparationAnswers(row.answers)
      : emptyMeetingPreparationAnswers(),
    revision: Number(row?.revision ?? 0),
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
    completedAt: row?.completed_at ? String(row.completed_at) : null,
  }
}

async function loadPreparationRow(
  backend: any,
  scope: PortalMeetingPreparationScope,
): Promise<Row | null> {
  const result = await backend
    .from('crm_case_meeting_preparations')
    .select(preparationSelect)
    .eq('organization_id', scope.organizationId)
    .eq('case_id', scope.caseId)
    .eq('appointment_id', scope.appointmentId)
    .maybeSingle()
  throwPortalDbError(result.error, 'could not load meeting preparation')
  return result.data as Row | null
}

export async function loadPortalMeetingPreparation(
  event: H3Event,
  appointmentIdInput: unknown,
): Promise<PortalMeetingPreparation> {
  const scope = await requirePortalMeetingPreparationScope(
    event,
    appointmentIdInput,
  )
  const backend = serverDataBackend(event) as any
  return publicPreparation(scope, await loadPreparationRow(backend, scope))
}

function revisionConflict(currentRevision: number): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Meeting preparation changed; reload it and try again',
    data: { currentRevision },
  })
}

export async function savePortalMeetingPreparation(
  event: H3Event,
  appointmentIdInput: unknown,
  bodyInput: unknown,
): Promise<PortalMeetingPreparation> {
  const scope = await requirePortalMeetingPreparationScope(
    event,
    appointmentIdInput,
  )
  const body = parseMeetingPreparationSaveBody(bodyInput)
  const backend = serverDataBackend(event) as any
  const current = await loadPreparationRow(backend, scope)
  const currentRevision = Number(current?.revision ?? 0)
  if (body.revision !== currentRevision) return revisionConflict(currentRevision)

  const completedAt = current?.completed_at
    ? String(current.completed_at)
    : body.completed === true
      ? new Date().toISOString()
      : null
  const values = {
    answers: body.answers,
    completed_at: completedAt,
    updated_by_client_person_id: scope.clientPersonId,
    updated_by_auth_user_id: scope.authUserId,
  }

  const saveResult = current
    ? await backend
        .from('crm_case_meeting_preparations')
        .update({ ...values, revision: currentRevision + 1 })
        .eq('organization_id', scope.organizationId)
        .eq('case_id', scope.caseId)
        .eq('appointment_id', scope.appointmentId)
        .eq('revision', currentRevision)
        .select(preparationSelect)
        .maybeSingle()
    : await backend
        .from('crm_case_meeting_preparations')
        .insert({
          organization_id: scope.organizationId,
          case_id: scope.caseId,
          appointment_id: scope.appointmentId,
          client_id: scope.clientId,
          client_person_id: scope.clientPersonId,
          revision: 1,
          ...values,
        })
        .select(preparationSelect)
        .single()

  if (saveResult.error?.code === '23505') {
    const concurrent = await loadPreparationRow(backend, scope)
    return revisionConflict(Number(concurrent?.revision ?? 0))
  }
  throwPortalDbError(saveResult.error, 'could not save meeting preparation')
  if (current && !saveResult.data) {
    const concurrent = await loadPreparationRow(backend, scope)
    return revisionConflict(Number(concurrent?.revision ?? 0))
  }
  return publicPreparation(scope, saveResult.data as Row)
}
