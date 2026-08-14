import { createError } from 'h3'
import type { MortgageDocumentValidationExpectation } from './mortgage-document-ai-validation'

export type MortgageAiValidatedDocumentKind = 'esis' | 'credit_decision'

export interface MortgageDocumentValidationContext {
  expectation: MortgageDocumentValidationExpectation
  applicantContextSha256: string
  bankContextSha256: string
  expectationSha256: string
  bankId: string
  offerId: string
  decisionOutcome: 'positive' | 'negative' | null
  validUntil: string | null
  loanAmount: number | null
  currency: string | null
}

interface MortgageValidationContextRpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown, error: { message?: string } | null }>
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const sha256Pattern = /^[0-9a-f]{64}$/u

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw invalidContext(field)
  return text
}

function requiredUuid(value: unknown, field: string): string {
  const text = requiredText(value, field).toLowerCase()
  if (!uuidPattern.test(text)) throw invalidContext(field)
  return text
}

function requiredSha256(value: unknown, field: string): string {
  const text = requiredText(value, field)
  if (!sha256Pattern.test(text)) throw invalidContext(field)
  return text
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  const text = requiredText(value, field)
  if (!Number.isFinite(Date.parse(text))) throw invalidContext(field)
  return text
}

function optionalPositiveNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw invalidContext(field)
  return number
}

function invalidContext(field: string) {
  return createError({
    statusCode: 500,
    statusMessage: `Mortgage validation context is invalid (${field})`,
  })
}

function uniqueTextArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw invalidContext(field)
  const result: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const text = requiredText(entry, field)
    const key = text.toLocaleLowerCase('pl-PL')
    if (!seen.has(key)) {
      seen.add(key)
      result.push(text)
    }
  }
  return result
}

function applicantNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidContext('applicants')
  const result: string[] = []
  const ids = new Set<string>()
  for (const applicant of value) {
    const row = record(applicant)
    if (!row) throw invalidContext('applicants')
    const clientId = requiredUuid(row.clientId, 'applicants.clientId')
    const displayName = requiredText(row.displayName, 'applicants.displayName')
    if (ids.has(clientId)) throw invalidContext('applicants.clientId')
    ids.add(clientId)
    result.push(displayName)
  }
  return result
}

export function parseMortgageDocumentValidationContext(
  value: unknown,
  expectedKind: MortgageAiValidatedDocumentKind,
): MortgageDocumentValidationContext {
  const row = record(value)
  if (!row || row.kind !== expectedKind) throw invalidContext('kind')

  const bankName = requiredText(row.bankName, 'bankName')
  const bankAliases = uniqueTextArray(row.bankAliases, 'bankAliases')
  const names = applicantNames(row.applicants)
  const decisionOutcome = row.decisionOutcome === undefined || row.decisionOutcome === null
    ? null
    : row.decisionOutcome === 'positive' || row.decisionOutcome === 'negative'
      ? row.decisionOutcome
      : (() => { throw invalidContext('decisionOutcome') })()
  if ((expectedKind === 'credit_decision') !== (decisionOutcome !== null)) {
    throw invalidContext('decisionOutcome')
  }

  const validUntil = optionalTimestamp(row.validUntil, 'validUntil')
  const loanAmount = optionalPositiveNumber(row.loanAmount, 'loanAmount')
  const currency = row.currency === undefined || row.currency === null
    ? null
    : requiredText(row.currency, 'currency').toUpperCase()
  if ((loanAmount === null) !== (currency === null) || (currency && !/^[A-Z]{3}$/u.test(currency))) {
    throw invalidContext('loanAmount/currency')
  }
  if (expectedKind === 'credit_decision' && (loanAmount !== null || currency !== null)) {
    throw invalidContext('loanAmount/currency')
  }

  return {
    expectation: {
      kind: expectedKind,
      bankName,
      bankAliases,
      applicantNames: names,
      ...(decisionOutcome ? { decisionOutcome } : {}),
      ...(validUntil ? { validUntil } : {}),
      ...(loanAmount !== null ? { loanAmount, currency } : {}),
    },
    applicantContextSha256: requiredSha256(row.applicantContextSha256, 'applicantContextSha256'),
    bankContextSha256: requiredSha256(row.bankContextSha256, 'bankContextSha256'),
    expectationSha256: requiredSha256(row.expectationSha256, 'expectationSha256'),
    bankId: requiredUuid(row.bankId, 'bankId'),
    offerId: requiredUuid(row.offerId, 'offerId'),
    decisionOutcome,
    validUntil,
    loanAmount,
    currency,
  }
}

export async function loadMortgageDocumentValidationContext(
  backendData: MortgageValidationContextRpcClient,
  organizationId: string,
  caseId: string,
  applicationId: string,
  kind: MortgageAiValidatedDocumentKind,
  artifact: Record<string, unknown>,
): Promise<MortgageDocumentValidationContext> {
  const decisionOutcome = kind === 'credit_decision'
    && (artifact.decisionOutcome === 'positive' || artifact.decisionOutcome === 'negative')
    ? artifact.decisionOutcome
    : null
  if (kind === 'credit_decision' && !decisionOutcome) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Wynik decyzji kredytowej jest wymagany do analizy dokumentu.',
    })
  }
  const validUntil = optionalTimestamp(artifact.validUntil, 'artifact.validUntil')
  const result = await backendData.rpc('get_crm_mortgage_document_validation_context', {
    p_organization_id: organizationId,
    p_case_id: caseId,
    p_application_id: applicationId,
    p_expected_kind: kind,
    p_decision_outcome: decisionOutcome,
    p_valid_until: validUntil,
  })
  if (result.error) {
    console.error('[mortgage-artifacts] validation context RPC failed', {
      message: result.error.message ?? 'Database request failed',
    })
    throw createError({
      statusCode: 409,
      statusMessage: 'Nie można ustalić aktualnego kontekstu dokumentu. Odśwież sprawę i spróbuj ponownie.',
    })
  }
  return parseMortgageDocumentValidationContext(result.data, kind)
}
