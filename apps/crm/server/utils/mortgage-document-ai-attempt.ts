import { createError } from 'h3'
import {
  mortgageDocumentAiModel,
  mortgageDocumentAiPromptVersion,
  mortgageDocumentAnomalyCodes,
  mortgageDocumentSignalCodes,
  mortgageDocumentValidationReasonCodes,
  type MortgageDocumentAnomalyCode,
  type MortgageDocumentDecisionOutcome,
  type MortgageDocumentKind,
  type MortgageDocumentSignalCode,
  type MortgageDocumentValidationCheck,
  type MortgageDocumentValidationReasonCode,
  type MortgageDocumentValidationResult,
  type MortgageDocumentValidationVerdict,
} from './mortgage-document-ai-validation.ts'

export const mortgageDocumentAiProvider = 'vercel-ai-gateway' as const

interface MortgageDocumentAiAttemptRpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown, error: { message?: string, code?: string } | null }>
}

export interface MortgageDocumentAiAttemptScope {
  organizationId: string
  caseId: string
  applicationId: string
  actorUserId: string
  kind: MortgageDocumentKind
  sourceSha256: string
  applicantContextSha256: string
  bankContextSha256: string
  expectationSha256: string
  decisionOutcome: MortgageDocumentDecisionOutcome | null
  validUntil: string | null
}

export interface MortgageDocumentAiClaimedAttempt {
  attemptId: string
  state: 'claimed'
  leaseToken: string
  leaseExpiresAt: string
}

export interface MortgageDocumentAiInProgressAttempt {
  attemptId: string
  state: 'in_progress'
  leaseExpiresAt: string
}

export interface MortgageDocumentAiCompletedAttempt {
  attemptId: string
  state: 'completed'
  completedAt: string
  validation: MortgageDocumentValidationResult
}

export type MortgageDocumentAiAttempt =
  | MortgageDocumentAiClaimedAttempt
  | MortgageDocumentAiInProgressAttempt
  | MortgageDocumentAiCompletedAttempt

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const sha256Pattern = /^[0-9a-f]{64}$/u
const leaseTokenPattern = /^[0-9a-f]{64}$/u
const validationChecks = [
  'match',
  'partial',
  'mismatch',
  'unknown',
  'not_applicable',
] as const satisfies readonly MortgageDocumentValidationCheck[]
const validationVerdicts = [
  'accepted',
  'needs_review',
  'rejected',
] as const satisfies readonly MortgageDocumentValidationVerdict[]

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every(key => allowed.includes(key))
}

function invalidAttempt(field: string): never {
  throw createError({
    statusCode: 500,
    statusMessage: `Mortgage document AI attempt is invalid (${field})`,
  })
}

function requiredText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) invalidAttempt(field)
  return text
}

function requiredUuid(value: unknown, field: string): string {
  const text = requiredText(value, field).toLowerCase()
  if (!uuidPattern.test(text)) invalidAttempt(field)
  return text
}

function requiredTimestamp(value: unknown, field: string): string {
  const text = requiredText(value, field)
  if (!Number.isFinite(Date.parse(text))) invalidAttempt(field)
  return text
}

function requiredNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) invalidAttempt(field)
  return number
}

function stringEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalidAttempt(field)
  return value as T
}

function uniqueStringArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maximum: number,
  field: string,
): T[] {
  if (!Array.isArray(value) || value.length > maximum) invalidAttempt(field)
  const result = value.map((entry, index) => stringEnum(entry, allowed, `${field}[${index}]`))
  if (new Set(result).size !== result.length) invalidAttempt(field)
  return result
}

function nonNegativeInteger(value: unknown, maximum: number, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) invalidAttempt(field)
  return number
}

export function mortgageDocumentValidationPiiFreeObservations(
  result: MortgageDocumentValidationResult,
): Record<string, unknown> {
  return {
    checks: result.checks,
    expectedApplicantCount: result.expectedApplicantCount,
    matchedApplicantCount: result.matchedApplicantCount,
    missingSignalCodes: result.missingSignalCodes,
    anomalyCodes: result.anomalyCodes,
  }
}

function validationFromCompletedAttempt(
  verdictValue: unknown,
  confidenceValue: unknown,
  reasonCodesValue: unknown,
  observationsValue: unknown,
): MortgageDocumentValidationResult {
  const verdict = stringEnum(verdictValue, validationVerdicts, 'verdict')
  const confidence = requiredNumber(confidenceValue, 'confidence', 0, 1)
  const reasonCodes = uniqueStringArray(
    reasonCodesValue,
    mortgageDocumentValidationReasonCodes,
    32,
    'reasonCodes',
  )
  const observations = record(observationsValue)
  const checksValue = record(observations?.checks)
  if (!observations
    || !checksValue
    || !hasExactKeys(observations, [
      'checks',
      'expectedApplicantCount',
      'matchedApplicantCount',
      'missingSignalCodes',
      'anomalyCodes',
    ])
    || !hasExactKeys(checksValue, [
      'content',
      'kind',
      'bank',
      'applicants',
      'decisionOutcome',
      'validUntil',
      'loanAmount',
      'requiredSections',
    ])) invalidAttempt('piiFreeObservations')

  const checks = {
    content: stringEnum(checksValue.content, validationChecks, 'checks.content'),
    kind: stringEnum(checksValue.kind, validationChecks, 'checks.kind'),
    bank: stringEnum(checksValue.bank, validationChecks, 'checks.bank'),
    applicants: stringEnum(checksValue.applicants, validationChecks, 'checks.applicants'),
    decisionOutcome: stringEnum(
      checksValue.decisionOutcome,
      validationChecks,
      'checks.decisionOutcome',
    ),
    validUntil: stringEnum(checksValue.validUntil, validationChecks, 'checks.validUntil'),
    loanAmount: stringEnum(checksValue.loanAmount, validationChecks, 'checks.loanAmount'),
    requiredSections: stringEnum(
      checksValue.requiredSections,
      validationChecks,
      'checks.requiredSections',
    ),
  }
  const expectedApplicantCount = nonNegativeInteger(
    observations.expectedApplicantCount,
    20,
    'expectedApplicantCount',
  )
  const matchedApplicantCount = nonNegativeInteger(
    observations.matchedApplicantCount,
    expectedApplicantCount,
    'matchedApplicantCount',
  )
  const missingSignalCodes = uniqueStringArray(
    observations.missingSignalCodes,
    mortgageDocumentSignalCodes,
    10,
    'missingSignalCodes',
  ) as MortgageDocumentSignalCode[]
  const anomalyCodes = uniqueStringArray(
    observations.anomalyCodes,
    mortgageDocumentAnomalyCodes,
    8,
    'anomalyCodes',
  ) as MortgageDocumentAnomalyCode[]

  return {
    verdict,
    reasonCodes: reasonCodes as MortgageDocumentValidationReasonCode[],
    safeSummary: verdict === 'accepted'
      ? 'Dokument przeszedł automatyczną walidację strukturalną.'
      : verdict === 'needs_review'
        ? 'Dokument wymaga ręcznej weryfikacji przed użyciem.'
        : 'Dokument nie spełnia warunków bezpiecznego dołączenia.',
    confidence,
    checks,
    expectedApplicantCount,
    matchedApplicantCount,
    missingSignalCodes,
    anomalyCodes,
    provider: mortgageDocumentAiProvider,
    model: mortgageDocumentAiModel,
    promptVersion: mortgageDocumentAiPromptVersion,
  }
}

export function parseMortgageDocumentAiAttempt(value: unknown): MortgageDocumentAiAttempt {
  const row = record(value)
  if (!row) invalidAttempt('result')
  const attemptId = requiredUuid(row.attemptId, 'attemptId')
  if (row.state === 'claimed') {
    const leaseToken = requiredText(row.leaseToken, 'leaseToken')
    if (!leaseTokenPattern.test(leaseToken)) invalidAttempt('leaseToken')
    return {
      attemptId,
      state: 'claimed',
      leaseToken,
      leaseExpiresAt: requiredTimestamp(row.leaseExpiresAt, 'leaseExpiresAt'),
    }
  }
  if (row.state === 'in_progress') {
    return {
      attemptId,
      state: 'in_progress',
      leaseExpiresAt: requiredTimestamp(row.leaseExpiresAt, 'leaseExpiresAt'),
    }
  }
  if (row.state === 'completed') {
    return {
      attemptId,
      state: 'completed',
      completedAt: requiredTimestamp(row.completedAt, 'completedAt'),
      validation: validationFromCompletedAttempt(
        row.verdict,
        row.confidence,
        row.reasonCodes,
        row.piiFreeObservations,
      ),
    }
  }
  return invalidAttempt('state')
}

function claimArgs(scope: MortgageDocumentAiAttemptScope): Record<string, unknown> {
  if (!sha256Pattern.test(scope.sourceSha256)) invalidAttempt('sourceSha256')
  return {
    p_organization_id: scope.organizationId,
    p_case_id: scope.caseId,
    p_application_id: scope.applicationId,
    p_actor_user_id: scope.actorUserId,
    p_expected_kind: scope.kind,
    p_source_sha256: scope.sourceSha256,
    p_applicant_context_sha256: scope.applicantContextSha256,
    p_bank_context_sha256: scope.bankContextSha256,
    p_expectation_sha256: scope.expectationSha256,
    p_provider: mortgageDocumentAiProvider,
    p_model: mortgageDocumentAiModel,
    p_prompt_version: mortgageDocumentAiPromptVersion,
    p_decision_outcome: scope.decisionOutcome,
    p_valid_until: scope.validUntil,
  }
}

function attemptRpcError(action: 'claim' | 'complete', error: { message?: string, code?: string }): never {
  console.error(`[mortgage-artifacts] AI attempt ${action} RPC failed`, {
    code: error.code ?? 'unknown',
    message: error.message ?? 'Database request failed',
  })
  throw createError({
    statusCode: error.message?.includes('context_stale') ? 409 : 503,
    statusMessage: error.message?.includes('context_stale')
      ? 'Dane sprawy zmieniły się podczas analizy. Odśwież sprawę i sprawdź dokument ponownie.'
      : 'Nie można bezpiecznie utrwalić wyniku analizy dokumentu. Spróbuj ponownie.',
  })
}

export async function claimMortgageDocumentAiAttempt(
  backendData: MortgageDocumentAiAttemptRpcClient,
  scope: MortgageDocumentAiAttemptScope,
): Promise<MortgageDocumentAiAttempt> {
  const result = await backendData.rpc(
    'claim_crm_mortgage_document_ai_attempt',
    claimArgs(scope),
  )
  if (result.error) attemptRpcError('claim', result.error)
  return parseMortgageDocumentAiAttempt(result.data)
}

export async function completeMortgageDocumentAiAttempt(
  backendData: MortgageDocumentAiAttemptRpcClient,
  scope: MortgageDocumentAiAttemptScope,
  claimed: MortgageDocumentAiClaimedAttempt,
  validation: MortgageDocumentValidationResult,
): Promise<MortgageDocumentAiCompletedAttempt> {
  const result = await backendData.rpc('complete_crm_mortgage_document_ai_attempt', {
    p_organization_id: scope.organizationId,
    p_case_id: scope.caseId,
    p_application_id: scope.applicationId,
    p_actor_user_id: scope.actorUserId,
    p_attempt_id: claimed.attemptId,
    p_lease_token: claimed.leaseToken,
    p_verdict: validation.verdict,
    p_confidence: validation.confidence,
    p_reason_codes: validation.reasonCodes,
    p_pii_free_observations: mortgageDocumentValidationPiiFreeObservations(validation),
  })
  if (result.error) {
    // A network failure may happen after the database committed. Re-claiming
    // is read/reconcile-safe: a completed row is replayed, while an active
    // lease is never allowed to execute the provider a second time.
    const reconciled = await backendData.rpc(
      'claim_crm_mortgage_document_ai_attempt',
      claimArgs(scope),
    )
    if (!reconciled.error) {
      const parsed = parseMortgageDocumentAiAttempt(reconciled.data)
      if (parsed.state === 'completed') return parsed
    }
    attemptRpcError('complete', result.error)
  }
  const parsed = parseMortgageDocumentAiAttempt(result.data)
  if (parsed.state !== 'completed') invalidAttempt('complete.state')
  return parsed
}

export async function runOrReplayMortgageDocumentAiAttempt(
  backendData: MortgageDocumentAiAttemptRpcClient,
  scope: MortgageDocumentAiAttemptScope,
  analyze: () => Promise<MortgageDocumentValidationResult>,
): Promise<MortgageDocumentAiInProgressAttempt | MortgageDocumentAiCompletedAttempt> {
  const attempt = await claimMortgageDocumentAiAttempt(backendData, scope)
  if (attempt.state === 'completed' || attempt.state === 'in_progress') return attempt
  const validation = await analyze()
  return completeMortgageDocumentAiAttempt(
    backendData,
    scope,
    attempt,
    validation,
  )
}
