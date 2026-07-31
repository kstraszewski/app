export const multiformIntakeIncomeSources = [
  'employment',
  'business',
  'civil_contract',
  'retirement',
  'rental',
  'foreign',
  'other',
] as const

export const multiformIntakeEmploymentTypes = [
  'indefinite',
  'fixed',
  'probation',
  'other',
] as const

export const multiformIntakeLoanPurposes = [
  'purchase_primary',
  'purchase_secondary',
  'construction',
  'renovation',
  'refinance',
] as const

export const multiformIntakeRequirementStatuses = [
  'required',
  'optional',
  'not_applicable',
  'unknown',
] as const

export type MultiformIntakeIncomeSource = typeof multiformIntakeIncomeSources[number]
export type MultiformIntakeEmploymentType = typeof multiformIntakeEmploymentTypes[number]
export type MultiformIntakeLoanPurpose = typeof multiformIntakeLoanPurposes[number]
export type MultiformIntakeRequirementStatus = typeof multiformIntakeRequirementStatuses[number]

export interface MultiformApplicantIntakeAnswers {
  incomeSource: MultiformIntakeIncomeSource | null
  employmentType: MultiformIntakeEmploymentType | null
  incomePaidToAccount: boolean | null
  additionalIncome: boolean | null
  liabilities: boolean | null
}

export interface MultiformCaseIntakeAnswers {
  loanPurpose: MultiformIntakeLoanPurpose | null
  preliminaryAgreement: boolean | null
  landRegister: boolean | null
  appraisalAvailable: boolean | null
  trancheDisbursement: boolean | null
}

export interface MultiformIntakeAnswers {
  applicants: Record<string, MultiformApplicantIntakeAnswers>
  case: MultiformCaseIntakeAnswers
}

export interface MultiformIntakeOption<T extends string | boolean> {
  label: string
  value: T
}

export const multiformIntakeIncomeSourceOptions = [
  { label: 'Umowa o pracę', value: 'employment' },
  { label: 'Działalność gospodarcza', value: 'business' },
  { label: 'Umowa cywilnoprawna', value: 'civil_contract' },
  { label: 'Emerytura lub renta', value: 'retirement' },
  { label: 'Najem', value: 'rental' },
  { label: 'Dochód zagraniczny', value: 'foreign' },
  { label: 'Inne źródło', value: 'other' },
] as const satisfies readonly MultiformIntakeOption<MultiformIntakeIncomeSource>[]

export const multiformIntakeEmploymentTypeOptions = [
  { label: 'Na czas nieokreślony', value: 'indefinite' },
  { label: 'Na czas określony', value: 'fixed' },
  { label: 'Okres próbny', value: 'probation' },
  { label: 'Inna', value: 'other' },
] as const satisfies readonly MultiformIntakeOption<MultiformIntakeEmploymentType>[]

export const multiformIntakeLoanPurposeOptions = [
  { label: 'Zakup na rynku pierwotnym', value: 'purchase_primary' },
  { label: 'Zakup na rynku wtórnym', value: 'purchase_secondary' },
  { label: 'Budowa', value: 'construction' },
  { label: 'Remont', value: 'renovation' },
  { label: 'Refinansowanie', value: 'refinance' },
] as const satisfies readonly MultiformIntakeOption<MultiformIntakeLoanPurpose>[]

export const multiformIntakeBooleanOptions = [
  { label: 'Tak', value: true },
  { label: 'Nie', value: false },
] as const satisfies readonly MultiformIntakeOption<boolean>[]

export const multiformIntakeLabels = {
  incomeSource: 'Główne źródło dochodu',
  employmentType: 'Rodzaj umowy o pracę',
  incomePaidToAccount: 'Czy dochód wpływa na rachunek bankowy?',
  additionalIncome: 'Czy występują dodatkowe źródła dochodu?',
  liabilities: 'Czy występują obecne zobowiązania finansowe?',
  loanPurpose: 'Cel kredytu',
  preliminaryAgreement: 'Czy podpisano umowę przedwstępną?',
  landRegister: 'Czy nieruchomość ma księgę wieczystą?',
  appraisalAvailable: 'Czy jest dostępny operat szacunkowy?',
  trancheDisbursement: 'Czy kredyt będzie wypłacany w transzach?',
} as const

export const multiformIntakeRequirementStatusLabels = {
  required: 'Wymagany',
  optional: 'Opcjonalny',
  not_applicable: 'Nie dotyczy',
  unknown: 'Do ustalenia',
} as const satisfies Record<MultiformIntakeRequirementStatus, string>

export const multiformIntakeStageLabels = {
  analysis: 'Do analizy wniosku',
  agreement: 'Do umowy',
  disbursement: 'Do uruchomienia',
  tranche: 'Do wypłaty transzy',
  maintenance: 'Po uruchomieniu',
} as const

type ApplicantIntakeField = keyof MultiformApplicantIntakeAnswers
type CaseIntakeField = keyof MultiformCaseIntakeAnswers
export type MultiformIntakeField = ApplicantIntakeField | CaseIntakeField

export interface MultiformIntakeProgressCount {
  completed: number
  total: number
  percentage: number
  complete: boolean
}

export interface MultiformIntakeProgress extends MultiformIntakeProgressCount {
  applicants: Record<string, MultiformIntakeProgressCount>
  case: MultiformIntakeProgressCount
}

export interface MultiformIntakeValidationIssue {
  scope: 'applicant' | 'case'
  clientId: string | null
  field: MultiformIntakeField
  path: string
  message: string
}

export interface MultiformIntakeValidationResult {
  valid: boolean
  value: MultiformIntakeAnswers
  issues: MultiformIntakeValidationIssue[]
  progress: MultiformIntakeProgress
}

export interface MultiformIntakeRequirement {
  code: string
  category: string
  stage: string
  applicability: string
  required: boolean
  ownerClientId: string | null
}

export interface MultiformIntakeRequirementResolution {
  status: MultiformIntakeRequirementStatus
  stage: string
  phase: 'analysis' | 'later'
}

type JsonRecord = Record<string, unknown>

const incomeSourceSet = new Set<string>(multiformIntakeIncomeSources)
const employmentTypeSet = new Set<string>(multiformIntakeEmploymentTypes)
const loanPurposeSet = new Set<string>(multiformIntakeLoanPurposes)

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function ownValue(source: JsonRecord | null, key: string): unknown {
  return source && Object.prototype.hasOwnProperty.call(source, key)
    ? source[key]
    : undefined
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | null {
  return typeof value === 'string' && allowed.has(value) ? value as T : null
}

function normalizedClientIds(clientIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const clientId of clientIds) {
    if (
      typeof clientId !== 'string'
      || !clientId
      || clientId.length > 160
      || seen.has(clientId)
    ) continue
    seen.add(clientId)
    normalized.push(clientId)
  }
  return normalized
}

function emptyApplicantAnswers(): MultiformApplicantIntakeAnswers {
  return {
    incomeSource: null,
    employmentType: null,
    incomePaidToAccount: null,
    additionalIncome: null,
    liabilities: null,
  }
}

function emptyCaseAnswers(): MultiformCaseIntakeAnswers {
  return {
    loanPurpose: null,
    preliminaryAgreement: null,
    landRegister: null,
    appraisalAvailable: null,
    trancheDisbursement: null,
  }
}

/**
 * Accepts persisted or otherwise untrusted JSON and returns only known fields,
 * exact enum values and real booleans. Applicants outside the current case are
 * discarded; missing current applicants are added with empty answers.
 */
export function normalizeMultiformIntake(
  input: unknown,
  clientIds: readonly string[],
): MultiformIntakeAnswers {
  const source = asRecord(input)
  const applicantSource = asRecord(ownValue(source, 'applicants'))
  const applicants = Object.create(null) as Record<string, MultiformApplicantIntakeAnswers>

  for (const clientId of normalizedClientIds(clientIds)) {
    const rawAnswers = asRecord(ownValue(applicantSource, clientId))
    const incomeSource = enumValue<MultiformIntakeIncomeSource>(
      ownValue(rawAnswers, 'incomeSource'),
      incomeSourceSet,
    )
    applicants[clientId] = {
      ...emptyApplicantAnswers(),
      incomeSource,
      employmentType: incomeSource === 'employment'
        ? enumValue<MultiformIntakeEmploymentType>(
            ownValue(rawAnswers, 'employmentType'),
            employmentTypeSet,
          )
        : null,
      incomePaidToAccount: nullableBoolean(ownValue(rawAnswers, 'incomePaidToAccount')),
      additionalIncome: nullableBoolean(ownValue(rawAnswers, 'additionalIncome')),
      liabilities: nullableBoolean(ownValue(rawAnswers, 'liabilities')),
    }
  }

  const rawCase = asRecord(ownValue(source, 'case'))
  return {
    applicants,
    case: {
      ...emptyCaseAnswers(),
      loanPurpose: enumValue<MultiformIntakeLoanPurpose>(
        ownValue(rawCase, 'loanPurpose'),
        loanPurposeSet,
      ),
      preliminaryAgreement: nullableBoolean(ownValue(rawCase, 'preliminaryAgreement')),
      landRegister: nullableBoolean(ownValue(rawCase, 'landRegister')),
      appraisalAvailable: nullableBoolean(ownValue(rawCase, 'appraisalAvailable')),
      trancheDisbursement: nullableBoolean(ownValue(rawCase, 'trancheDisbursement')),
    },
  }
}

export function createEmptyMultiformIntake(clientIds: readonly string[]): MultiformIntakeAnswers {
  return normalizeMultiformIntake(null, clientIds)
}

function countProgress(values: readonly unknown[]): MultiformIntakeProgressCount {
  const completed = values.filter(value => value !== null && value !== undefined).length
  const total = values.length
  return {
    completed,
    total,
    percentage: total === 0 ? 100 : Math.round((completed / total) * 100),
    complete: completed === total,
  }
}

function applicantProgress(answers: MultiformApplicantIntakeAnswers): MultiformIntakeProgressCount {
  return countProgress([
    answers.incomeSource,
    ...(answers.incomeSource === 'employment' ? [answers.employmentType] : []),
    answers.incomePaidToAccount,
    answers.additionalIncome,
    answers.liabilities,
  ])
}

function caseProgress(answers: MultiformCaseIntakeAnswers): MultiformIntakeProgressCount {
  return countProgress([
    answers.loanPurpose,
    answers.preliminaryAgreement,
    answers.landRegister,
    answers.appraisalAvailable,
    answers.trancheDisbursement,
  ])
}

export function getMultiformApplicantIntakeProgress(
  input: unknown,
  clientId: string,
): MultiformIntakeProgressCount {
  const answers = normalizeMultiformIntake(input, [clientId]).applicants[clientId]
  return applicantProgress(answers ?? emptyApplicantAnswers())
}

export function getMultiformIntakeProgress(
  input: unknown,
  clientIds: readonly string[],
): MultiformIntakeProgress {
  const normalizedIds = normalizedClientIds(clientIds)
  const answers = normalizeMultiformIntake(input, normalizedIds)
  const applicants = Object.create(null) as Record<string, MultiformIntakeProgressCount>
  let applicantCompleted = 0
  let applicantTotal = 0

  for (const clientId of normalizedIds) {
    const progress = applicantProgress(answers.applicants[clientId] ?? emptyApplicantAnswers())
    applicants[clientId] = progress
    applicantCompleted += progress.completed
    applicantTotal += progress.total
  }

  const caseAnswersProgress = caseProgress(answers.case)
  const completed = applicantCompleted + caseAnswersProgress.completed
  const total = applicantTotal + caseAnswersProgress.total
  return {
    completed,
    total,
    percentage: total === 0 ? 100 : Math.round((completed / total) * 100),
    complete: completed === total,
    applicants,
    case: caseAnswersProgress,
  }
}

export function validateMultiformIntake(
  input: unknown,
  clientIds: readonly string[],
): MultiformIntakeValidationResult {
  const normalizedIds = normalizedClientIds(clientIds)
  const value = normalizeMultiformIntake(input, normalizedIds)
  const issues: MultiformIntakeValidationIssue[] = []

  const addApplicantIssue = (
    clientId: string,
    field: ApplicantIntakeField,
  ): void => {
    issues.push({
      scope: 'applicant',
      clientId,
      field,
      path: `applicants[${JSON.stringify(clientId)}].${field}`,
      message: `Uzupełnij pole „${multiformIntakeLabels[field]}”.`,
    })
  }

  for (const clientId of normalizedIds) {
    const answers = value.applicants[clientId] ?? emptyApplicantAnswers()
    if (answers.incomeSource === null) addApplicantIssue(clientId, 'incomeSource')
    if (answers.incomeSource === 'employment' && answers.employmentType === null) {
      addApplicantIssue(clientId, 'employmentType')
    }
    if (answers.incomePaidToAccount === null) addApplicantIssue(clientId, 'incomePaidToAccount')
    if (answers.additionalIncome === null) addApplicantIssue(clientId, 'additionalIncome')
    if (answers.liabilities === null) addApplicantIssue(clientId, 'liabilities')
  }

  for (const field of [
    'loanPurpose',
    'preliminaryAgreement',
    'landRegister',
    'appraisalAvailable',
    'trancheDisbursement',
  ] as const satisfies readonly CaseIntakeField[]) {
    if (value.case[field] !== null) continue
    issues.push({
      scope: 'case',
      clientId: null,
      field,
      path: `case.${field}`,
      message: `Uzupełnij pole „${multiformIntakeLabels[field]}”.`,
    })
  }

  return {
    valid: issues.length === 0,
    value,
    issues,
    progress: getMultiformIntakeProgress(value, normalizedIds),
  }
}

function booleanRequirementStatus(value: boolean | null): MultiformIntakeRequirementStatus {
  if (value === true) return 'required'
  if (value === false) return 'not_applicable'
  return 'unknown'
}

function applicantAnswers(
  answers: MultiformIntakeAnswers,
  ownerClientId: string | null,
): MultiformApplicantIntakeAnswers | null {
  if (!ownerClientId || !Object.prototype.hasOwnProperty.call(answers.applicants, ownerClientId)) {
    return null
  }
  return answers.applicants[ownerClientId] ?? null
}

function conditionalRequirementStatus(
  requirement: MultiformIntakeRequirement,
  answers: MultiformIntakeAnswers,
): MultiformIntakeRequirementStatus {
  const code = requirement.code.toLowerCase()
  const category = requirement.category.toLowerCase()
  const owner = applicantAnswers(answers, requirement.ownerClientId)

  if (code === 'income_evidence') {
    return owner?.incomeSource ? 'required' : 'unknown'
  }
  if (code === 'bank_account_statements') {
    return booleanRequirementStatus(owner?.incomePaidToAccount ?? null)
  }
  if (category === 'income_employment') {
    if (!owner?.incomeSource) return 'unknown'
    return ['employment', 'civil_contract'].includes(owner.incomeSource)
      ? 'required'
      : 'not_applicable'
  }
  if (category === 'income_business') {
    if (!owner?.incomeSource) return 'unknown'
    return owner.incomeSource === 'business' ? 'required' : 'not_applicable'
  }
  if (category === 'liabilities') {
    return booleanRequirementStatus(owner?.liabilities ?? null)
  }

  if (
    code === 'preliminary_agreement'
    || code === 'transaction.preliminary_agreement'
    || code === 'transaction_preliminary_agreement'
    || code === 'property.preliminary_agreement'
  ) {
    return booleanRequirementStatus(answers.case.preliminaryAgreement)
  }
  if (
    code === 'land_register'
    || code === 'land_register_verification'
    || code === 'property.land_register'
  ) {
    return booleanRequirementStatus(answers.case.landRegister)
  }
  if (
    code === 'appraisal_report'
    || code === 'valuation.appraisal_report'
  ) {
    return booleanRequirementStatus(answers.case.appraisalAvailable)
  }
  if (category === 'refinance_discharge' || code.startsWith('refinance.')) {
    if (!answers.case.loanPurpose) return 'unknown'
    return answers.case.loanPurpose === 'refinance' ? 'required' : 'not_applicable'
  }
  if (requirement.stage === 'tranche' || code.includes('tranche')) {
    return booleanRequirementStatus(answers.case.trancheDisbursement)
  }
  if (category === 'construction_renovation') {
    if (!answers.case.loanPurpose) return 'unknown'
    return ['construction', 'renovation'].includes(answers.case.loanPurpose)
      ? 'required'
      : 'not_applicable'
  }

  return 'unknown'
}

/**
 * Resolves a catalog checklist row without Vue, browser or server state.
 * `phase` keeps documents needed for the initial application separate from
 * agreement, disbursement, tranche and maintenance requirements.
 */
export function resolveMultiformIntakeRequirement(
  requirement: MultiformIntakeRequirement,
  answers: MultiformIntakeAnswers,
): MultiformIntakeRequirementResolution {
  let status: MultiformIntakeRequirementStatus
  if (requirement.applicability === 'always') status = 'required'
  else if (requirement.applicability === 'optional' || requirement.required === false) status = 'optional'
  else status = conditionalRequirementStatus(requirement, answers)

  return {
    status,
    stage: requirement.stage,
    phase: requirement.stage === 'analysis' ? 'analysis' : 'later',
  }
}

export function resolveMultiformIntakeRequirementStatus(
  requirement: MultiformIntakeRequirement,
  answers: MultiformIntakeAnswers,
): MultiformIntakeRequirementStatus {
  return resolveMultiformIntakeRequirement(requirement, answers).status
}
