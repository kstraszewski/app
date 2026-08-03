import { createError } from 'h3'

export const CRM_MEETING_PROCESS_STEPS = [
  'needs',
  'comparison',
  'documents',
  'analysis',
  'agreement',
] as const

export type CrmMeetingProcessStep = typeof CRM_MEETING_PROCESS_STEPS[number]
export type CrmMeetingRelationship = 'first' | 'follow-up'
export type CrmMeetingStatus = 'scheduled' | 'live' | 'ended'
export type CrmMeetingSharedKind = 'none' | 'mortgage-process' | 'mortgage-offers'

export interface CrmMeetingSharedState {
  kind: CrmMeetingSharedKind
  processStepId: string | null
  offerIds: string[]
  activeOfferId: string | null
  updatedAt: string | null
}

const crmMeetingPreparationGoals = ['purchase', 'construction', 'refinance', 'exploring'] as const
const crmMeetingPreparationStages = ['possibilities', 'searching', 'selected', 'deadline'] as const
const crmMeetingPreparationIncomeSources = [
  'employment',
  'business',
  'civil_contract',
  'foreign',
  'retirement',
  'rental',
  'other',
] as const
const crmMeetingPreparationCoBorrowers = ['yes', 'no', 'unsure'] as const
const crmMeetingPreparationPropertyBudgets = [
  'up_to_400k',
  '400k_600k',
  '600k_800k',
  '800k_1m',
  '1m_1_5m',
  'above_1_5m',
  'unknown',
] as const
const crmMeetingPreparationOwnFunds = [
  'none',
  'up_to_50k',
  '50k_100k',
  '100k_200k',
  '200k_300k',
  'above_300k',
  'unknown',
] as const
const crmMeetingPreparationLoanAmounts = [
  'up_to_300k',
  '300k_500k',
  '500k_700k',
  '700k_1m',
  'above_1m',
  'unknown',
] as const
const crmMeetingPreparationLoanTerms = ['15', '20', '25', '30', '35', 'unknown'] as const
const crmMeetingPreparationMonthlyNetIncomes = [
  'up_to_6k',
  '6k_10k',
  '10k_15k',
  '15k_20k',
  '20k_30k',
  'above_30k',
  'prefer_meeting',
] as const
const crmMeetingPreparationMonthlyObligations = [
  'none',
  'up_to_1k',
  '1k_2_5k',
  '2_5k_5k',
  'above_5k',
  'prefer_meeting',
] as const
const crmMeetingPreparationComfortablePayments = [
  'up_to_2500',
  '2500_3500',
  '3500_4500',
  '4500_6000',
  'above_6000',
  'unknown',
] as const

export interface CrmMeetingPreparation {
  caseId: string
  appointmentId: string
  answers: {
    version: 2
    activeStep: 0 | 1 | 2 | 3 | 4
    profile: {
      goal: typeof crmMeetingPreparationGoals[number] | null
      stage: typeof crmMeetingPreparationStages[number] | null
      incomeSources: Array<typeof crmMeetingPreparationIncomeSources[number]>
      coBorrower: typeof crmMeetingPreparationCoBorrowers[number] | null
      propertyBudget: typeof crmMeetingPreparationPropertyBudgets[number] | null
      ownFunds: typeof crmMeetingPreparationOwnFunds[number] | null
      loanAmount: typeof crmMeetingPreparationLoanAmounts[number] | null
      loanTerm: typeof crmMeetingPreparationLoanTerms[number] | null
      monthlyNetIncome: typeof crmMeetingPreparationMonthlyNetIncomes[number] | null
      monthlyObligations: typeof crmMeetingPreparationMonthlyObligations[number] | null
      comfortablePayment: typeof crmMeetingPreparationComfortablePayments[number] | null
    }
    readConceptIds: string[]
    checkedItemIds: string[]
    selectedQuestionIds: string[]
  }
  revision: number
  updatedAt: string
  completedAt: string | null
}

export interface CrmMeetingContext {
  version: 1
  caseId: string
  relationship: CrmMeetingRelationship
  status: CrmMeetingStatus
  startedAt: string | null
  endedAt: string | null
  shared: CrmMeetingSharedState
}

export interface CrmMeetingRecord {
  id: string
  caseId: string
  caseTitle: string
  relationship: CrmMeetingRelationship
  status: CrmMeetingStatus
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

export interface ClientMeetingSharedOffer {
  id: string
  bankName: string
  productName: string
  calculationStatus: 'complete' | 'partial'
  firstInstallment: number
  firstMonthlyOutflow: number
  costFirstFiveYears: number
  totalCost: number
  representativeAprPct: number | null
}

export const crmMeetingAppointmentSelect = [
  'id',
  'organization_id',
  'client_id',
  'client_person_id',
  'facility_id',
  'service_id',
  'expert_user_id',
  'starts_at',
  'ends_at',
  'timezone',
  'status',
  'cancelled_at',
  'meeting_mode',
  'meeting_url',
  'booking_context',
  'customer_name',
  'customer_email',
  'customer_phone',
  'notes',
  'source',
  'idempotency_key',
  'created_by_user_id',
  'created_at',
  'updated_at',
].join(', ')

export const crmMeetingOfferSelect = [
  'id',
  'case_id',
  'bank_name',
  'product_name',
  'currency',
  'loan_amount',
  'first_installment',
  'first_monthly_outflow',
  'cost_first_five_years',
  'total_cost',
  'representative_apr_pct',
  'calculation_snapshot',
  'saved_at',
].join(', ')

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function recordValue(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, any>
}

function nullablePreparationChoice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && (choices as readonly string[]).includes(value)
    ? value as T[number]
    : undefined
}

function preparationChoiceArray<const T extends readonly string[]>(
  value: unknown,
  choices: T,
): Array<T[number]> | null {
  if (!Array.isArray(value) || value.length > choices.length) return null
  if (value.some(item => (
    typeof item !== 'string'
    || !(choices as readonly string[]).includes(item)
  ))) return null
  if (new Set(value).size !== value.length) return null
  return value as Array<T[number]>
}

function preparationIdArray(value: unknown, maximumItems: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null
  if (value.some(item => (
    typeof item !== 'string'
    || !item.trim()
    || item.length > 100
  ))) return null
  if (new Set(value).size !== value.length) return null
  return value as string[]
}

function nullableIsoDate(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString()
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !uuidPattern.test(value)) return undefined
  return value
}

export function isCrmMeetingUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function normalizeCrmMeetingPreparation(
  rowInput: unknown,
): CrmMeetingPreparation | null {
  const row = recordValue(rowInput)
  const answers = recordValue(row.answers)
  const profile = recordValue(answers.profile)
  const goal = nullablePreparationChoice(profile.goal, crmMeetingPreparationGoals)
  const stage = nullablePreparationChoice(profile.stage, crmMeetingPreparationStages)
  const incomeSources = preparationChoiceArray(
    profile.incomeSources,
    crmMeetingPreparationIncomeSources,
  )
  const coBorrower = nullablePreparationChoice(
    profile.coBorrower,
    crmMeetingPreparationCoBorrowers,
  )
  const propertyBudget = nullablePreparationChoice(
    profile.propertyBudget,
    crmMeetingPreparationPropertyBudgets,
  )
  const ownFunds = nullablePreparationChoice(profile.ownFunds, crmMeetingPreparationOwnFunds)
  const loanAmount = nullablePreparationChoice(
    profile.loanAmount,
    crmMeetingPreparationLoanAmounts,
  )
  const loanTerm = nullablePreparationChoice(profile.loanTerm, crmMeetingPreparationLoanTerms)
  const monthlyNetIncome = nullablePreparationChoice(
    profile.monthlyNetIncome,
    crmMeetingPreparationMonthlyNetIncomes,
  )
  const monthlyObligations = nullablePreparationChoice(
    profile.monthlyObligations,
    crmMeetingPreparationMonthlyObligations,
  )
  const comfortablePayment = nullablePreparationChoice(
    profile.comfortablePayment,
    crmMeetingPreparationComfortablePayments,
  )
  const readConceptIds = preparationIdArray(answers.readConceptIds, 20)
  const checkedItemIds = preparationIdArray(answers.checkedItemIds, 50)
  const selectedQuestionIds = preparationIdArray(answers.selectedQuestionIds, 50)
  const revision = Number(row.revision)
  const updatedAt = nullableIsoDate(row.updated_at)
  const completedAt = nullableIsoDate(row.completed_at)

  if (
    !isCrmMeetingUuid(row.case_id)
    || !isCrmMeetingUuid(row.appointment_id)
    || answers.version !== 2
    || !Number.isInteger(answers.activeStep)
    || Number(answers.activeStep) < 0
    || Number(answers.activeStep) > 4
    || goal === undefined
    || stage === undefined
    || incomeSources === null
    || coBorrower === undefined
    || propertyBudget === undefined
    || ownFunds === undefined
    || loanAmount === undefined
    || loanTerm === undefined
    || monthlyNetIncome === undefined
    || monthlyObligations === undefined
    || comfortablePayment === undefined
    || readConceptIds === null
    || checkedItemIds === null
    || selectedQuestionIds === null
    || !Number.isSafeInteger(revision)
    || revision < 1
    || !updatedAt
    || completedAt === undefined
  ) return null

  return {
    caseId: row.case_id,
    appointmentId: row.appointment_id,
    answers: {
      version: 2,
      activeStep: Number(answers.activeStep) as 0 | 1 | 2 | 3 | 4,
      profile: {
        goal,
        stage,
        incomeSources,
        coBorrower,
        propertyBudget,
        ownFunds,
        loanAmount,
        loanTerm,
        monthlyNetIncome,
        monthlyObligations,
        comfortablePayment,
      },
      readConceptIds,
      checkedItemIds,
      selectedQuestionIds,
    },
    revision,
    updatedAt,
    completedAt,
  }
}

export function parseExpertMeetingPreviewOrganizationSlug(
  query: Record<string, unknown>,
): string | null {
  const preview = Array.isArray(query.preview) ? query.preview[0] : query.preview
  if (preview !== 'expert') return null

  const rawOrganizationSlug = Array.isArray(query.organizationSlug)
    ? query.organizationSlug[0]
    : query.organizationSlug
  const organizationSlug = typeof rawOrganizationSlug === 'string'
    ? rawOrganizationSlug.trim()
    : ''

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Valid organizationSlug is required for expert preview',
    })
  }

  return organizationSlug
}

export function emptyCrmMeetingSharedState(): CrmMeetingSharedState {
  return {
    kind: 'none',
    processStepId: null,
    offerIds: [],
    activeOfferId: null,
    updatedAt: null,
  }
}

export function createCrmMeetingContext(
  caseId: string,
  relationship: CrmMeetingRelationship,
): CrmMeetingContext {
  return {
    version: 1,
    caseId,
    relationship,
    status: 'scheduled',
    startedAt: null,
    endedAt: null,
    shared: emptyCrmMeetingSharedState(),
  }
}

export function parseCrmMeetingContext(bookingContext: unknown): CrmMeetingContext | null {
  const container = recordValue(bookingContext)
  const meeting = recordValue(container.crmMeeting)
  const shared = recordValue(meeting.shared)
  const startedAt = nullableIsoDate(meeting.startedAt)
  const endedAt = nullableIsoDate(meeting.endedAt)
  const updatedAt = nullableIsoDate(shared.updatedAt)
  const processStepId = shared.processStepId === null
    ? null
    : typeof shared.processStepId === 'string'
      ? shared.processStepId
      : undefined
  const activeOfferId = nullableUuid(shared.activeOfferId)
  const offerIds = Array.isArray(shared.offerIds)
    ? shared.offerIds.filter(isCrmMeetingUuid)
    : null

  if (
    meeting.version !== 1
    || !isCrmMeetingUuid(meeting.caseId)
    || !['first', 'follow-up'].includes(meeting.relationship)
    || !['scheduled', 'live', 'ended'].includes(meeting.status)
    || startedAt === undefined
    || endedAt === undefined
    || !['none', 'mortgage-process', 'mortgage-offers'].includes(shared.kind)
    || processStepId === undefined
    || activeOfferId === undefined
    || updatedAt === undefined
    || offerIds === null
    || offerIds.length > 3
    || new Set(offerIds).size !== offerIds.length
  ) return null

  if (
    (shared.kind === 'none' && (
      processStepId !== null
      || offerIds.length > 0
      || activeOfferId !== null
    ))
    || (shared.kind === 'mortgage-process' && (
      !CRM_MEETING_PROCESS_STEPS.includes(processStepId as CrmMeetingProcessStep)
      || offerIds.length > 0
      || activeOfferId !== null
    ))
    || (shared.kind === 'mortgage-offers' && (
      processStepId !== null
      || offerIds.length === 0
      || (activeOfferId !== null && !offerIds.includes(activeOfferId))
    ))
  ) return null

  return {
    version: 1,
    caseId: meeting.caseId,
    relationship: meeting.relationship as CrmMeetingRelationship,
    status: meeting.status as CrmMeetingStatus,
    startedAt,
    endedAt,
    shared: {
      kind: shared.kind as CrmMeetingSharedKind,
      processStepId,
      offerIds,
      activeOfferId,
      updatedAt,
    },
  }
}

export function bookingContextWithCrmMeeting(
  bookingContext: unknown,
  meeting: CrmMeetingContext,
): Record<string, unknown> {
  return {
    ...recordValue(bookingContext),
    crmMeeting: meeting,
  }
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeClientMeetingOffer(row: Record<string, any>): ClientMeetingSharedOffer {
  const calculation = recordValue(row.calculation_snapshot)
  return {
    id: String(row.id),
    bankName: String(row.bank_name ?? ''),
    productName: String(row.product_name ?? ''),
    calculationStatus: calculation.status === 'complete' ? 'complete' : 'partial',
    firstInstallment: finiteNumber(row.first_installment),
    firstMonthlyOutflow: finiteNumber(row.first_monthly_outflow),
    costFirstFiveYears: finiteNumber(row.cost_first_five_years),
    totalCost: finiteNumber(row.total_cost),
    representativeAprPct: nullableFiniteNumber(row.representative_apr_pct),
  }
}

function throwQueryError(error: { message?: string, code?: string } | null | undefined): void {
  if (!error) return
  throw createError({
    statusCode: ({
      '23505': 409,
      '23514': 409,
      '23503': 400,
      '42501': 403,
    }[String(error.code)] ?? 500),
    statusMessage: error.message || 'Database operation failed',
  })
}

export async function normalizeCrmMeetingRecords(
  backendData: any,
  organizationId: string,
  rows: Array<Record<string, any>>,
): Promise<CrmMeetingRecord[]> {
  const parsedRows = rows.flatMap((row) => {
    const context = parseCrmMeetingContext(row.booking_context)
    return context ? [{ row, context }] : []
  })
  if (!parsedRows.length) return []

  const caseIds = [...new Set(parsedRows.map(item => item.context.caseId))]
  const appointmentIds = [...new Set(parsedRows.map(item => String(item.row.id)))]
  const clientIds = [...new Set(parsedRows.map(item => String(item.row.client_id)))]
  const facilityIds = [...new Set(parsedRows.map(item => String(item.row.facility_id)))]
  const serviceIds = [...new Set(parsedRows.map(item => String(item.row.service_id)))]
  const expertIds = [...new Set(parsedRows.map(item => String(item.row.expert_user_id)))]

  const [
    casesResult,
    clientsResult,
    facilitiesResult,
    servicesResult,
    expertsResult,
    preparationsResult,
  ] = await Promise.all([
    backendData
      .from('crm_cases')
      .select('id, title')
      .eq('organization_id', organizationId)
      .in('id', caseIds),
    backendData
      .from('crm_clients')
      .select('id, display_name')
      .eq('organization_id', organizationId)
      .in('id', clientIds),
    backendData
      .from('facilities')
      .select('id, name')
      .eq('organization_id', organizationId)
      .in('id', facilityIds),
    backendData
      .from('booking_services')
      .select('id, name')
      .eq('organization_id', organizationId)
      .in('id', serviceIds),
    backendData
      .from('users')
      .select('id, full_name, email')
      .in('id', expertIds),
    backendData
      .from('crm_case_meeting_preparations')
      .select('case_id, appointment_id, answers, revision, completed_at, updated_at')
      .eq('organization_id', organizationId)
      .in('case_id', caseIds)
      .in('appointment_id', appointmentIds),
  ])
  throwQueryError(casesResult.error)
  throwQueryError(clientsResult.error)
  throwQueryError(facilitiesResult.error)
  throwQueryError(servicesResult.error)
  throwQueryError(expertsResult.error)
  throwQueryError(preparationsResult.error)

  const cases = new Map((casesResult.data ?? []).map((row: any) => [String(row.id), row]))
  const clients = new Map((clientsResult.data ?? []).map((row: any) => [String(row.id), row]))
  const facilities = new Map((facilitiesResult.data ?? []).map((row: any) => [String(row.id), row]))
  const services = new Map((servicesResult.data ?? []).map((row: any) => [String(row.id), row]))
  const experts = new Map((expertsResult.data ?? []).map((row: any) => [String(row.id), row]))
  const preparations = new Map<string, CrmMeetingPreparation>()
  for (const row of preparationsResult.data ?? []) {
    const preparation = normalizeCrmMeetingPreparation(row)
    if (!preparation) continue
    preparations.set(
      JSON.stringify([preparation.caseId, preparation.appointmentId]),
      preparation,
    )
  }

  return parsedRows.map(({ row, context }) => {
    const caseRow = cases.get(context.caseId) as Record<string, any> | undefined
    const client = clients.get(String(row.client_id)) as Record<string, any> | undefined
    const facility = facilities.get(String(row.facility_id)) as Record<string, any> | undefined
    const service = services.get(String(row.service_id)) as Record<string, any> | undefined
    const expert = experts.get(String(row.expert_user_id)) as Record<string, any> | undefined
    const cancelled = row.status === 'cancelled'

    return {
      id: String(row.id),
      caseId: context.caseId,
      caseTitle: String(caseRow?.title ?? ''),
      relationship: context.relationship,
      status: cancelled ? 'ended' : context.status,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      timezone: String(row.timezone),
      clientId: String(row.client_id),
      clientName: String(client?.display_name ?? row.customer_name ?? ''),
      facilityId: String(row.facility_id),
      facilityName: String(facility?.name ?? ''),
      serviceId: String(row.service_id),
      serviceName: String(service?.name ?? ''),
      expertUserId: String(row.expert_user_id),
      expertName: String(expert?.full_name || expert?.email || ''),
      meetingUrl: row.meeting_url ? String(row.meeting_url) : null,
      startedAt: context.startedAt,
      endedAt: context.endedAt ?? (cancelled && row.cancelled_at
        ? String(row.cancelled_at)
        : null),
      shared: context.shared,
      preparation: preparations.get(JSON.stringify([context.caseId, String(row.id)])) ?? null,
    }
  })
}

export async function normalizeCrmMeetingRecord(
  backendData: any,
  organizationId: string,
  row: Record<string, any>,
): Promise<CrmMeetingRecord> {
  const [meeting] = await normalizeCrmMeetingRecords(backendData, organizationId, [row])
  if (!meeting) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }
  return meeting
}
