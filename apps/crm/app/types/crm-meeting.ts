export type CrmMeetingDisplayMode = 'expanded' | 'minimized'
export type CrmMeetingArtifactKind = 'mortgage-process' | 'mortgage-comparison'
export type CrmMeetingClientSignal = 'none' | 'question' | 'understood' | 'offer-selected'
export type CrmMeetingTranscriptSource = 'sample' | 'livekit'
export type CrmMeetingTranscriptSpeaker = 'client' | 'expert'
export type CrmMeetingLifecycleStatus = 'scheduled' | 'live' | 'ended'
export type CrmMeetingRelationship = 'first' | 'follow-up'
export type CrmMeetingSharedKind = 'none' | 'mortgage-process' | 'mortgage-offers'
export type CrmMeetingGuidanceMetric =
  | 'monthly-outflow'
  | 'five-year-cost'
  | 'total-cost'
  | 'representative-apr'

export interface CrmMeetingSharedState {
  kind: CrmMeetingSharedKind
  processStepId: string | null
  offerIds: string[]
  activeOfferId: string | null
  updatedAt: string | null
}

export type CrmMeetingPreparationGoal = 'purchase' | 'construction' | 'refinance' | 'exploring'
export type CrmMeetingPreparationStage = 'possibilities' | 'searching' | 'selected' | 'deadline'
export type CrmMeetingPreparationIncomeSource =
  | 'employment'
  | 'business'
  | 'civil_contract'
  | 'foreign'
  | 'retirement'
  | 'rental'
  | 'other'
export type CrmMeetingPreparationCoBorrower = 'yes' | 'no' | 'unsure'
export type CrmMeetingPreparationPropertyBudget =
  | 'up_to_400k'
  | '400k_600k'
  | '600k_800k'
  | '800k_1m'
  | '1m_1_5m'
  | 'above_1_5m'
  | 'unknown'
export type CrmMeetingPreparationOwnFunds =
  | 'none'
  | 'up_to_50k'
  | '50k_100k'
  | '100k_200k'
  | '200k_300k'
  | 'above_300k'
  | 'unknown'
export type CrmMeetingPreparationLoanAmount =
  | 'up_to_300k'
  | '300k_500k'
  | '500k_700k'
  | '700k_1m'
  | 'above_1m'
  | 'unknown'
export type CrmMeetingPreparationLoanTerm = '15' | '20' | '25' | '30' | '35' | 'unknown'
export type CrmMeetingPreparationMonthlyNetIncome =
  | 'up_to_6k'
  | '6k_10k'
  | '10k_15k'
  | '15k_20k'
  | '20k_30k'
  | 'above_30k'
  | 'prefer_meeting'
export type CrmMeetingPreparationMonthlyObligations =
  | 'none'
  | 'up_to_1k'
  | '1k_2_5k'
  | '2_5k_5k'
  | 'above_5k'
  | 'prefer_meeting'
export type CrmMeetingPreparationComfortablePayment =
  | 'up_to_2500'
  | '2500_3500'
  | '3500_4500'
  | '4500_6000'
  | 'above_6000'
  | 'unknown'

export interface CrmMeetingPreparationProfile {
  goal: CrmMeetingPreparationGoal | null
  stage: CrmMeetingPreparationStage | null
  incomeSources: CrmMeetingPreparationIncomeSource[]
  coBorrower: CrmMeetingPreparationCoBorrower | null
  propertyBudget: CrmMeetingPreparationPropertyBudget | null
  ownFunds: CrmMeetingPreparationOwnFunds | null
  loanAmount: CrmMeetingPreparationLoanAmount | null
  loanTerm: CrmMeetingPreparationLoanTerm | null
  monthlyNetIncome: CrmMeetingPreparationMonthlyNetIncome | null
  monthlyObligations: CrmMeetingPreparationMonthlyObligations | null
  comfortablePayment: CrmMeetingPreparationComfortablePayment | null
}

export interface CrmMeetingPreparationAnswers {
  version: 2
  activeStep: 0 | 1 | 2 | 3 | 4
  profile: CrmMeetingPreparationProfile
  readConceptIds: string[]
  checkedItemIds: string[]
  selectedQuestionIds: string[]
}

export interface CrmMeetingPreparation {
  caseId: string
  appointmentId: string
  answers: CrmMeetingPreparationAnswers
  revision: number
  updatedAt: string
  completedAt: string | null
}

export interface CrmMeetingRecord {
  id: string
  caseId: string
  caseTitle: string
  relationship: CrmMeetingRelationship
  status: CrmMeetingLifecycleStatus
  startsAt: string
  endsAt: string
  timezone: string
  clientId: string
  clientName: string
  facilityId: string
  facilityName: string
  serviceId: string
  serviceName: string
  expertUserId: string
  expertName: string
  meetingUrl: string | null
  startedAt: string | null
  endedAt: string | null
  shared: CrmMeetingSharedState
  preparation: CrmMeetingPreparation | null
}

export interface CrmMeetingListResponse {
  data: CrmMeetingRecord[]
}

export interface CrmMeetingProcessStep {
  id: string
  label: string
  summary: string
  clientPrompt: string
}

export interface CrmMeetingProcessArtifact {
  id: 'mortgage-process'
  kind: 'mortgage-process'
  title: string
  description: string
  sourceLabel: string
  steps: CrmMeetingProcessStep[]
}

export interface CrmMeetingMortgageOffer {
  id: string
  bankName: string
  productName: string
  firstInstallment: number
  firstMonthlyOutflow: number
  costFirstFiveYears: number
  totalCost: number
  representativeAprPct: number | null
  unknownFieldCount: number
}

export interface CrmMeetingMortgageScenario {
  propertyValue: number
  loanAmount: number
  years: number
  ltvPct: number
}

export interface CrmMeetingMortgageComparisonArtifact {
  id: string
  kind: 'mortgage-comparison'
  title: string
  description: string
  sourceLabel: string
  publishedAt: string
  scenario: CrmMeetingMortgageScenario
  offers: CrmMeetingMortgageOffer[]
}

export type CrmMeetingArtifact =
  | CrmMeetingProcessArtifact
  | CrmMeetingMortgageComparisonArtifact

export interface CrmMeetingPrototypeState {
  active: boolean
  displayMode: CrmMeetingDisplayMode
  appointmentId: string | null
  caseId: string | null
  clientName: string | null
  activeArtifactKind: CrmMeetingArtifactKind
  mortgageComparison: CrmMeetingMortgageComparisonArtifact | null
  activeProcessStepId: string
  selectedOfferId: string | null
  clientSignal: CrmMeetingClientSignal
  startedAt: string | null
}

export interface CrmMeetingMortgageComparisonInput {
  id: string
  title: string
  description: string
  sourceLabel: string
  scenario: CrmMeetingMortgageScenario
  offers: CrmMeetingMortgageOffer[]
}

export interface CrmMeetingTranscriptSegment {
  id: string
  speaker: CrmMeetingTranscriptSpeaker
  text: string
  source: CrmMeetingTranscriptSource
  isFinal: boolean
  observedAt: string
}

export interface CrmMeetingOfferGuidance {
  status: 'suggestion' | 'insufficient-signal' | 'insufficient-offers'
  source: 'deterministic-rules'
  suggestedOfferId: string | null
  metric: CrmMeetingGuidanceMetric | null
  metricLabel: string | null
  reason: string
  matchedSegmentIds: string[]
}
