export const meetingGoals = ['purchase', 'construction', 'refinance', 'exploring'] as const
export const meetingStages = ['possibilities', 'searching', 'selected', 'deadline'] as const
export const meetingIncomeSources = [
  'employment',
  'business',
  'civil_contract',
  'foreign',
  'retirement',
  'rental',
  'other',
] as const
export const coBorrowerPlans = ['yes', 'no', 'unsure'] as const
export const propertyBudgetChoices = [
  'up_to_400k',
  '400k_600k',
  '600k_800k',
  '800k_1m',
  '1m_1_5m',
  'above_1_5m',
  'unknown',
] as const
export const ownFundsChoices = [
  'none',
  'up_to_50k',
  '50k_100k',
  '100k_200k',
  '200k_300k',
  'above_300k',
  'unknown',
] as const
export const loanAmountChoices = [
  'up_to_300k',
  '300k_500k',
  '500k_700k',
  '700k_1m',
  'above_1m',
  'unknown',
] as const
export const loanTermChoices = ['15', '20', '25', '30', '35', 'unknown'] as const
export const monthlyNetIncomeChoices = [
  'up_to_6k',
  '6k_10k',
  '10k_15k',
  '15k_20k',
  '20k_30k',
  'above_30k',
  'prefer_meeting',
] as const
export const monthlyObligationChoices = [
  'none',
  'up_to_1k',
  '1k_2_5k',
  '2_5k_5k',
  'above_5k',
  'prefer_meeting',
] as const
export const comfortablePaymentChoices = [
  'up_to_2500',
  '2500_3500',
  '3500_4500',
  '4500_6000',
  'above_6000',
  'unknown',
] as const

export type MeetingGoal = typeof meetingGoals[number]
export type MeetingStage = typeof meetingStages[number]
export type MeetingIncomeSource = typeof meetingIncomeSources[number]
export type CoBorrowerPlan = typeof coBorrowerPlans[number]
export type PropertyBudgetChoice = typeof propertyBudgetChoices[number]
export type OwnFundsChoice = typeof ownFundsChoices[number]
export type LoanAmountChoice = typeof loanAmountChoices[number]
export type LoanTermChoice = typeof loanTermChoices[number]
export type MonthlyNetIncomeChoice = typeof monthlyNetIncomeChoices[number]
export type MonthlyObligationChoice = typeof monthlyObligationChoices[number]
export type ComfortablePaymentChoice = typeof comfortablePaymentChoices[number]

export interface MeetingPreparationProfile {
  goal: MeetingGoal | null
  stage: MeetingStage | null
  incomeSources: MeetingIncomeSource[]
  coBorrower: CoBorrowerPlan | null
  propertyBudget: PropertyBudgetChoice | null
  ownFunds: OwnFundsChoice | null
  loanAmount: LoanAmountChoice | null
  loanTerm: LoanTermChoice | null
  monthlyNetIncome: MonthlyNetIncomeChoice | null
  monthlyObligations: MonthlyObligationChoice | null
  comfortablePayment: ComfortablePaymentChoice | null
}

export interface MeetingPreparationAnswers {
  version: 2
  activeStep: number
  profile: MeetingPreparationProfile
  readConceptIds: string[]
  checkedItemIds: string[]
  selectedQuestionIds: string[]
}

export interface PortalMeetingPreparation {
  caseId: string
  appointmentId: string
  answers: MeetingPreparationAnswers
  revision: number
  updatedAt: string | null
  completedAt: string | null
}

export interface SaveMeetingPreparationBody {
  answers: MeetingPreparationAnswers
  revision: number
  completed?: boolean
}

/**
 * Checklist confirmations that are already answered by the bounded profile.
 *
 * Keep this deliberately conservative: an item belongs here only when the
 * profile question carries the same meaning as the checklist confirmation.
 * More detailed prompts (for example the source of own funds or employment
 * dates) must still be confirmed by the client in the checklist.
 */
export function inferredMeetingPreparationChecklistItemIds(
  profile: MeetingPreparationProfile,
): string[] {
  const ids: string[] = []

  if (
    profile.goal
    && profile.stage
    && profile.propertyBudget
    && profile.propertyBudget !== 'unknown'
  ) ids.push('goal-budget')

  if (
    profile.comfortablePayment
    && profile.comfortablePayment !== 'unknown'
  ) ids.push('comfortable-payment')

  if (
    profile.monthlyObligations
    && profile.monthlyObligations !== 'prefer_meeting'
  ) ids.push('liabilities')

  return ids
}

function nullableChoice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] | null {
  return typeof value === 'string' && (choices as readonly string[]).includes(value)
    ? value as T[number]
    : null
}

export function emptyMeetingPreparationProfile(): MeetingPreparationProfile {
  return {
    goal: null,
    stage: null,
    incomeSources: [],
    coBorrower: null,
    propertyBudget: null,
    ownFunds: null,
    loanAmount: null,
    loanTerm: null,
    monthlyNetIncome: null,
    monthlyObligations: null,
    comfortablePayment: null,
  }
}

export function normalizeMeetingPreparationProfile(value: unknown): MeetingPreparationProfile {
  const profile = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const incomeSources = Array.isArray(profile.incomeSources)
    ? [...new Set(profile.incomeSources.filter((item): item is MeetingIncomeSource => (
        typeof item === 'string'
        && (meetingIncomeSources as readonly string[]).includes(item)
      )))]
    : []

  return {
    goal: nullableChoice(profile.goal, meetingGoals),
    stage: nullableChoice(profile.stage, meetingStages),
    incomeSources,
    coBorrower: nullableChoice(profile.coBorrower, coBorrowerPlans),
    propertyBudget: nullableChoice(profile.propertyBudget, propertyBudgetChoices),
    ownFunds: nullableChoice(profile.ownFunds, ownFundsChoices),
    loanAmount: nullableChoice(profile.loanAmount, loanAmountChoices),
    loanTerm: nullableChoice(profile.loanTerm, loanTermChoices),
    monthlyNetIncome: nullableChoice(profile.monthlyNetIncome, monthlyNetIncomeChoices),
    monthlyObligations: nullableChoice(profile.monthlyObligations, monthlyObligationChoices),
    comfortablePayment: nullableChoice(profile.comfortablePayment, comfortablePaymentChoices),
  }
}
