import {
  coBorrowerLabel,
  expertQuestions,
  goalLabel,
  incomeSourceLabels,
  meetingConcepts,
  stageLabel,
  visibleChecklistItems,
  type CoBorrowerPlan,
  type MeetingGoal,
  type MeetingIncomeSource,
  type MeetingPreparationProfile,
  type MeetingStage,
} from '~/data/meeting-preparation'

export interface MeetingPreparationState {
  version: 1
  activeStep: number
  profile: MeetingPreparationProfile
  readConceptIds: string[]
  checkedItemIds: string[]
  selectedQuestionIds: string[]
  customQuestion: string
  completedAt: string | null
  updatedAt: string | null
}

const goalValues = new Set<MeetingGoal>(['purchase', 'construction', 'refinance', 'exploring'])
const stageValues = new Set<MeetingStage>(['possibilities', 'searching', 'selected', 'deadline'])
const incomeSourceValues = new Set<MeetingIncomeSource>([
  'employment',
  'business',
  'civil_contract',
  'foreign',
  'retirement',
  'rental',
  'other',
])
const coBorrowerValues = new Set<CoBorrowerPlan>(['yes', 'no', 'unsure'])

function safeString(value: unknown, maxLength = 120): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function safeStringArray(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(item => typeof item === 'string' && allowed.has(item)))]
}

export function createMeetingPreparationState(): MeetingPreparationState {
  return {
    version: 1,
    activeStep: 0,
    profile: {
      goal: null,
      stage: null,
      incomeSources: [],
      coBorrower: null,
      propertyBudget: '',
      ownFunds: '',
      comfortablePayment: '',
    },
    readConceptIds: [],
    checkedItemIds: [],
    selectedQuestionIds: [],
    customQuestion: '',
    completedAt: null,
    updatedAt: null,
  }
}

export function meetingPreparationStorageKey(
  userId: string,
  appointmentId?: string | null,
): string {
  return `openexpert:meeting-preparation:v1:${userId || 'client'}:${appointmentId || 'general'}`
}

export function parseMeetingPreparationState(value: string | null): MeetingPreparationState {
  const fallback = createMeetingPreparationState()
  if (!value) return fallback

  try {
    const parsed = JSON.parse(value) as Record<string, any>
    const profile = parsed.profile && typeof parsed.profile === 'object'
      ? parsed.profile as Record<string, unknown>
      : {}
    const goal = goalValues.has(profile.goal as MeetingGoal) ? profile.goal as MeetingGoal : null
    const stage = stageValues.has(profile.stage as MeetingStage) ? profile.stage as MeetingStage : null
    const coBorrower = coBorrowerValues.has(profile.coBorrower as CoBorrowerPlan)
      ? profile.coBorrower as CoBorrowerPlan
      : null
    const conceptIds = new Set(meetingConcepts.map(concept => concept.id))
    const checklistIds = new Set(visibleChecklistItems({
      ...fallback.profile,
      goal,
      stage,
      incomeSources: safeStringArray(
        profile.incomeSources,
        incomeSourceValues,
      ) as MeetingIncomeSource[],
    }).map(item => item.id))
    const questionIds = new Set(expertQuestions.map(question => question.id))

    return {
      version: 1,
      activeStep: Math.max(0, Math.min(4, Number(parsed.activeStep) || 0)),
      profile: {
        goal,
        stage,
        incomeSources: safeStringArray(
          profile.incomeSources,
          incomeSourceValues,
        ) as MeetingIncomeSource[],
        coBorrower,
        propertyBudget: safeString(profile.propertyBudget),
        ownFunds: safeString(profile.ownFunds),
        comfortablePayment: safeString(profile.comfortablePayment),
      },
      readConceptIds: safeStringArray(parsed.readConceptIds, conceptIds),
      checkedItemIds: safeStringArray(parsed.checkedItemIds, checklistIds),
      selectedQuestionIds: safeStringArray(parsed.selectedQuestionIds, questionIds),
      customQuestion: safeString(parsed.customQuestion, 600),
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    }
  }
  catch {
    return fallback
  }
}

export function profileIsReady(profile: MeetingPreparationProfile): boolean {
  return Boolean(
    profile.goal
    && profile.stage
    && profile.incomeSources.length
    && profile.coBorrower,
  )
}

export function meetingPreparationProgress(state: MeetingPreparationState): number {
  const profileParts = [
    Boolean(state.profile.goal),
    Boolean(state.profile.stage),
    Boolean(state.profile.incomeSources.length),
    Boolean(state.profile.coBorrower),
    Boolean(
      state.profile.propertyBudget
      || state.profile.ownFunds
      || state.profile.comfortablePayment,
    ),
  ].filter(Boolean).length
  const profileProgress = (profileParts / 5) * 35
  const conceptProgress = Math.min(1, state.readConceptIds.length / meetingConcepts.length) * 20
  const checklist = visibleChecklistItems(state.profile)
  const visibleChecklistIds = new Set(checklist.map(item => item.id))
  const checked = state.checkedItemIds.filter(id => visibleChecklistIds.has(id)).length
  const checklistProgress = Math.min(1, checked / Math.max(1, checklist.length)) * 20
  const questionProgress = Math.min(1, state.selectedQuestionIds.length / 5) * 25

  return Math.round(profileProgress + conceptProgress + checklistProgress + questionProgress)
}

function optionalAmount(label: string, value: string): string | null {
  return value.trim() ? `${label}: ${value.trim()}` : null
}

export function buildMeetingPreparationSummary(state: MeetingPreparationState): string {
  const selectedQuestions = expertQuestions.filter(question => (
    state.selectedQuestionIds.includes(question.id)
  ))
  const checklist = visibleChecklistItems(state.profile)
  const checkedItems = checklist.filter(item => state.checkedItemIds.includes(item.id))
  const amounts = [
    optionalAmount('Budżet / wartość celu', state.profile.propertyBudget),
    optionalAmount('Środki własne', state.profile.ownFunds),
    optionalAmount('Komfortowa rata', state.profile.comfortablePayment),
  ].filter((item): item is string => Boolean(item))
  const lines = [
    'MOJE PRZYGOTOWANIE DO SPOTKANIA Z EKSPERTEM',
    '',
    'PUNKT STARTU',
    `Cel: ${goalLabel(state.profile.goal)}`,
    `Etap: ${stageLabel(state.profile.stage)}`,
    `Źródła dochodu: ${incomeSourceLabels(state.profile.incomeSources).join(', ') || 'Nie wybrano'}`,
    `Współkredytobiorca: ${coBorrowerLabel(state.profile.coBorrower)}`,
    ...amounts,
    '',
    `PRZYGOTOWANE INFORMACJE (${checkedItems.length} z ${checklist.length})`,
    ...(checkedItems.length
      ? checkedItems.map(item => `✓ ${item.label}`)
      : ['Jeszcze nic nie zaznaczono.']),
    '',
    'PYTANIA NA SPOTKANIE',
    ...(selectedQuestions.length
      ? selectedQuestions.map((question, index) => `${index + 1}. ${question.text}`)
      : ['Nie wybrano jeszcze pytań.']),
  ]

  if (state.customQuestion.trim()) {
    lines.push('', 'MOJE WŁASNE PYTANIE', state.customQuestion.trim())
  }

  lines.push(
    '',
    'To prywatna notatka przygotowawcza. Ostateczne warunki kredytu zależą od oceny banku i dokumentów.',
  )
  return lines.join('\n')
}
