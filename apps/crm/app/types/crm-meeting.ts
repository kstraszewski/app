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
