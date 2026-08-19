import {
  coBorrowerLabel,
  comfortablePaymentLabel,
  expertQuestions,
  goalLabel,
  incomeSourceLabels,
  loanAmountLabel,
  loanTermLabel,
  meetingConcepts,
  monthlyNetIncomeLabel,
  monthlyObligationsLabel,
  ownFundsLabel,
  propertyBudgetLabel,
  stageLabel,
  visibleChecklistItems,
  type MeetingPreparationProfile,
} from '../data/meeting-preparation.ts'
import {
  emptyMeetingPreparationProfile,
  inferredMeetingPreparationChecklistItemIds,
  normalizeMeetingPreparationProfile,
  type MeetingPreparationAnswers,
} from '#shared/types/meeting-preparation.ts'

export type MeetingPreparationState = MeetingPreparationAnswers

function safeStringArray(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return []

  return [...new Set(value.filter(item => (
    typeof item === 'string' && allowed.has(item)
  )))]
}

function parseValue(value: string | unknown): Record<string, unknown> | null {
  if (!value) return null

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  }
  catch {
    return null
  }
}

export function createMeetingPreparationState(): MeetingPreparationState {
  return {
    version: 2,
    activeStep: 0,
    profile: emptyMeetingPreparationProfile(),
    readConceptIds: [],
    checkedItemIds: [],
    selectedQuestionIds: [],
  }
}

export function parseMeetingPreparationState(
  value: unknown,
): MeetingPreparationState {
  const fallback = createMeetingPreparationState()
  const parsed = parseValue(value)
  if (!parsed) return fallback

  const profile = normalizeMeetingPreparationProfile(parsed.profile)
  const conceptIds = new Set(meetingConcepts.map(concept => concept.id))
  const checklistIds = new Set(visibleChecklistItems(profile).map(item => item.id))
  const questionIds = new Set(expertQuestions.map(question => question.id))
  const activeStep = Number(parsed.activeStep)

  return {
    version: 2,
    activeStep: Number.isFinite(activeStep)
      ? Math.max(0, Math.min(4, Math.trunc(activeStep)))
      : 0,
    profile,
    readConceptIds: safeStringArray(parsed.readConceptIds, conceptIds),
    checkedItemIds: safeStringArray(parsed.checkedItemIds, checklistIds),
    selectedQuestionIds: safeStringArray(parsed.selectedQuestionIds, questionIds),
  }
}

export function profileIsReady(profile: MeetingPreparationProfile): boolean {
  return Boolean(
    profile.goal
    && profile.stage
    && profile.incomeSources.length
    && profile.coBorrower
    && profile.propertyBudget
    && profile.ownFunds
    && profile.loanAmount
    && profile.loanTerm
    && profile.monthlyNetIncome
    && profile.monthlyObligations
    && profile.comfortablePayment,
  )
}

export function completedMeetingPreparationChecklistItemIds(
  state: MeetingPreparationState,
): string[] {
  return [...new Set([
    ...state.checkedItemIds,
    ...inferredMeetingPreparationChecklistItemIds(state.profile),
  ])]
}

export function meetingPreparationProgress(state: MeetingPreparationState): number {
  const profileParts = [
    Boolean(state.profile.goal),
    Boolean(state.profile.stage),
    Boolean(state.profile.incomeSources.length),
    Boolean(state.profile.coBorrower),
    Boolean(state.profile.propertyBudget),
    Boolean(state.profile.ownFunds),
    Boolean(state.profile.loanAmount),
    Boolean(state.profile.loanTerm),
    Boolean(state.profile.monthlyNetIncome),
    Boolean(state.profile.monthlyObligations),
    Boolean(state.profile.comfortablePayment),
  ].filter(Boolean).length
  const profileProgress = (profileParts / 11) * 55
  const conceptProgress = Math.min(1, state.readConceptIds.length / meetingConcepts.length) * 15
  const checklist = visibleChecklistItems(state.profile)
  const visibleChecklistIds = new Set(checklist.map(item => item.id))
  const checked = completedMeetingPreparationChecklistItemIds(state)
    .filter(id => visibleChecklistIds.has(id)).length
  const checklistProgress = Math.min(1, checked / Math.max(1, checklist.length)) * 15
  const questionProgress = Math.min(1, state.selectedQuestionIds.length / 5) * 15

  return Math.round(profileProgress + conceptProgress + checklistProgress + questionProgress)
}

export function buildMeetingPreparationSummary(state: MeetingPreparationState): string {
  const selectedQuestions = expertQuestions.filter(question => (
    state.selectedQuestionIds.includes(question.id)
  ))
  const checklist = visibleChecklistItems(state.profile)
  const completedChecklistIds = new Set(completedMeetingPreparationChecklistItemIds(state))
  const checkedItems = checklist.filter(item => completedChecklistIds.has(item.id))
  const lines = [
    'MOJE PRZYGOTOWANIE DO SPOTKANIA Z EKSPERTEM',
    '',
    'PUNKT STARTU',
    `Cel: ${goalLabel(state.profile.goal)}`,
    `Etap: ${stageLabel(state.profile.stage)}`,
    `Źródła dochodu: ${incomeSourceLabels(state.profile.incomeSources).join(', ') || 'Nie wybrano'}`,
    `Współkredytobiorca: ${coBorrowerLabel(state.profile.coBorrower)}`,
    `Budżet / wartość celu: ${propertyBudgetLabel(state.profile.propertyBudget)}`,
    `Środki własne: ${ownFundsLabel(state.profile.ownFunds)}`,
    `Potrzebna kwota kredytu: ${loanAmountLabel(state.profile.loanAmount)}`,
    `Planowany okres: ${loanTermLabel(state.profile.loanTerm)}`,
    `Miesięczny dochód netto: ${monthlyNetIncomeLabel(state.profile.monthlyNetIncome)}`,
    `Miesięczne zobowiązania: ${monthlyObligationsLabel(state.profile.monthlyObligations)}`,
    `Komfortowa rata: ${comfortablePaymentLabel(state.profile.comfortablePayment)}`,
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
    '',
    'Brief jest zapisany przy sprawie. Kwoty są orientacyjne i ekspert potwierdzi je podczas rozmowy.',
  ]

  return lines.join('\n')
}
