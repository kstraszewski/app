import { normalizeTransactionalEmailAddress } from '@openexpert/email'
import { createError, type H3Event } from 'h3'
import {
  loadCaseBankApplication,
  requireCaseBankApplicationManager,
} from './case-bank-applications.ts'
import { serverDataBackend } from './data-api.ts'
import { loadUserMailConnections, type MailConnectionRow } from './mail-connections.ts'
import { normalizeMultiformPeselPassword } from './multiform-package-email.ts'
import { asRecord, throwDbError, type CrmSession } from './crm.ts'
import { OPENEXPERT_MOCK_BANK_SLUG } from './openexpert-mock-bank-documents.ts'

const applicationNumberPattern = /^OEB-\d{8}-\d{6}$/u

export interface OpenExpertMockBankEmailConfig {
  apiKey?: string
  from?: string
  replyTo?: string
  smtp?: {
    host?: string
    port?: number
    secure?: boolean
    user?: string
    password?: string
  }
}

export interface OpenExpertMockBankContext {
  organizationId: string
  application: Record<string, any>
  applicationId: string
  applicationNumber: string
  applicantNames: string[]
  primaryApplicantName: string
  primaryClientId: string
  pesel: string
  productName: string
  currency: string
  loanAmount: number
  termMonths: number
  interestRatePct: number
  aprcPct: number
  monthlyInstallment: number
  process: {
    stage: string
    revision: number
    applicationSubmittedAt: string | null
    completenessConfirmedAt: string | null
    decisionDueAt: string | null
  }
}

function requiredPositiveNumber(value: unknown, field: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `Wniosek OpenExpert Banku nie ma prawidłowej wartości: ${field}.`,
    })
  }
  return number
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const number = requiredPositiveNumber(value, field)
  if (!Number.isInteger(number)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Wniosek OpenExpert Banku nie ma pełnej liczby: ${field}.`,
    })
  }
  return number
}

function runtimeMockBank(event: H3Event) {
  return useRuntimeConfig(event).mockBank as {
    enabled?: boolean | string
    allowAllOrganizations?: boolean
    organizationIds?: string[]
    email?: OpenExpertMockBankEmailConfig
  }
}

export function isOpenExpertMockBankEnabled(
  event: H3Event,
  organizationId: string,
): boolean {
  const config = runtimeMockBank(event)
  const enabled = config?.enabled === true || config?.enabled === 'true'
  if (!enabled) return false
  if (config.allowAllOrganizations === true) return true
  const normalizedOrganizationId = String(organizationId || '').trim().toLowerCase()
  return Boolean(normalizedOrganizationId && config.organizationIds?.includes(normalizedOrganizationId))
}

export function requireOpenExpertMockBankEnabled(event: H3Event, organizationId: string) {
  const config = runtimeMockBank(event)
  if (!isOpenExpertMockBankEnabled(event, organizationId)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'OpenExpert Bank jest wyłączony dla tej organizacji.',
    })
  }
  return config
}

export function openExpertMockBankEmailConfig(
  event: H3Event,
  organizationId: string,
): OpenExpertMockBankEmailConfig {
  return requireOpenExpertMockBankEnabled(event, organizationId).email ?? {}
}

function selectedRecipient(connections: MailConnectionRow[], session: CrmSession): MailConnectionRow | null {
  const active = connections.filter(connection => connection.status === 'active')
  const sessionEmail = session.email.trim().toLocaleLowerCase('en-US')
  return active.find(connection => connection.account_email.toLocaleLowerCase('en-US') === sessionEmail)
    ?? (active.length === 1 ? active[0]! : null)
    ?? null
}

export async function requireOpenExpertMockBankRecipient(
  event: H3Event,
  session: CrmSession,
): Promise<{ connectionId: string, email: string }> {
  const { connections } = await loadUserMailConnections(event, session)
  const connection = selectedRecipient(connections, session)
  if (!connection) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Podłącz jedną aktywną skrzynkę albo konto zgodne z adresem logowania, aby jednoznacznie odebrać dokumenty z OpenExpert Banku.',
    })
  }
  let email = ''
  try {
    email = normalizeTransactionalEmailAddress(connection.account_email)
  }
  catch {
    throw createError({
      statusCode: 422,
      statusMessage: 'Podłączona skrzynka ma nieprawidłowy adres e-mail.',
    })
  }
  return { connectionId: connection.id, email }
}

export async function requireOpenExpertMockBankContext(
  event: H3Event,
  session: CrmSession,
  caseId: string,
  applicationId: string,
): Promise<OpenExpertMockBankContext> {
  requireOpenExpertMockBankEnabled(event, session.organizationId)
  const application = await loadCaseBankApplication(session, caseId, applicationId)
  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono wniosku bankowego.' })
  }
  await requireCaseBankApplicationManager(session, caseId, application)

  const backendData = serverDataBackend(event) as any
  const [bankResult, offerResult, processResult, linksResult, partiesResult, applicantContextResult] = await Promise.all([
    session.dataApi
      .from('mortgage_banks')
      .select('id, slug, name, is_mock')
      .eq('id', application.bank_id)
      .maybeSingle(),
    session.dataApi
      .from('crm_case_offer_snapshots')
      .select('id, product_name, currency, loan_amount, first_installment, representative_apr_pct, scenario_snapshot, catalog_snapshot')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('id', application.offer_id)
      .maybeSingle(),
    session.dataApi
      .from('crm_mortgage_application_processes')
      .select('stage, revision, application_submitted_at, completeness_confirmed_at, decision_due_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('application_id', applicationId)
      .maybeSingle(),
    session.dataApi
      .from('crm_case_clients')
      .select('client_id, is_primary, created_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .order('is_primary', { ascending: false })
      .order('created_at'),
    session.dataApi
      .from('crm_mortgage_application_parties')
      .select('client_id, role, created_at')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('application_id', applicationId)
      .order('created_at'),
    backendData.rpc('get_crm_mortgage_document_applicant_context', {
      p_organization_id: session.organizationId,
      p_case_id: caseId,
      p_application_id: applicationId,
    }),
  ])
  throwDbError(bankResult.error)
  throwDbError(offerResult.error)
  throwDbError(processResult.error)
  throwDbError(linksResult.error)
  throwDbError(partiesResult.error)
  throwDbError(applicantContextResult.error)

  const bank = bankResult.data as Record<string, any> | null
  if (!bank || bank.is_mock !== true || String(bank.slug) !== OPENEXPERT_MOCK_BANK_SLUG) {
    throw createError({ statusCode: 404, statusMessage: 'Ten wniosek nie należy do banku testowego.' })
  }
  const offer = offerResult.data as Record<string, any> | null
  const process = processResult.data as Record<string, any> | null
  if (!offer || !process) {
    throw createError({ statusCode: 409, statusMessage: 'Wniosek mockowego banku jest niekompletny.' })
  }

  const links = (linksResult.data ?? []) as Array<Record<string, any>>
  const parties = (partiesResult.data ?? []) as Array<Record<string, any>>
  const primaryParty = String(process.stage) === 'pre_application'
    ? links.find(link => link.is_primary === true) ?? links[0]
    : parties.find(party => String(party.role) === 'primary_applicant') ?? parties[0]
  const primaryClientId = String(primaryParty?.client_id ?? '')
  if (!primaryClientId) {
    throw createError({ statusCode: 422, statusMessage: 'Dodaj głównego wnioskodawcę do sprawy.' })
  }

  const [primaryClientResult, peopleResult] = await Promise.all([
    session.dataApi
      .from('crm_clients')
      .select('id, display_name')
      .eq('organization_id', session.organizationId)
      .eq('id', primaryClientId)
      .maybeSingle(),
    session.dataApi
      .from('crm_client_people')
      .select('display_name, pesel, role, created_at')
      .eq('organization_id', session.organizationId)
      .eq('client_id', primaryClientId)
      .order('created_at'),
  ])
  throwDbError(primaryClientResult.error)
  throwDbError(peopleResult.error)
  const people = (peopleResult.data ?? []) as Array<Record<string, any>>
  const primaryPerson = people.find(person => String(person.role) === 'primary') ?? people[0]
  const pesel = normalizeMultiformPeselPassword(primaryPerson?.pesel)
  if (!pesel) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Uzupełnij 11-cyfrowy PESEL głównego wnioskodawcy przed wysyłką dokumentu.',
    })
  }

  const applicantContext = asRecord(applicantContextResult.data)
  const rawApplicants = Array.isArray(applicantContext.applicants) ? applicantContext.applicants : []
  const applicantRows = rawApplicants
    .map((applicant) => {
      const row = asRecord(applicant)
      return {
        clientId: String(row.clientId ?? ''),
        displayName: String(row.displayName ?? '').trim(),
      }
    })
    .filter(applicant => Boolean(applicant.displayName))
    .sort((left, right) => (
      Number(right.clientId === primaryClientId) - Number(left.clientId === primaryClientId)
    ))
  const applicantNames = applicantRows.map(applicant => applicant.displayName)
  if (!applicantNames.length) {
    throw createError({ statusCode: 409, statusMessage: 'Nie można ustalić listy wnioskodawców.' })
  }
  if (!applicantRows.some(applicant => applicant.clientId === primaryClientId)) {
    throw createError({ statusCode: 409, statusMessage: 'Nie można ustalić głównego wnioskodawcy.' })
  }

  const applicationNumber = String(application.external_reference ?? '').trim()
  if (!applicationNumberPattern.test(applicationNumber)) {
    throw createError({ statusCode: 409, statusMessage: 'Wniosek nie ma prawidłowego numeru OpenExpert Banku.' })
  }

  const catalog = asRecord(offer.catalog_snapshot)
  const version = asRecord(catalog.version)
  const scenario = asRecord(offer.scenario_snapshot)
  const applicationScenario = asRecord(application.scenario_snapshot)
  const applicationProperty = asRecord(applicationScenario.property)
  const applicationCalculation = asRecord(application.calculation_snapshot)
  // Match the canonical ESIS validation context, which validates the gross
  // facility first when financed costs are part of the frozen application.
  const loanAmount = requiredPositiveNumber(
    application.gross_loan_amount ?? application.net_loan_amount ?? offer.loan_amount,
    'kwota kredytu',
  )
  const currency = String(
    applicationScenario.currency
      ?? applicationProperty.currency
      ?? applicationCalculation.currency
      ?? offer.currency
      ?? '',
  ).trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wniosek OpenExpert Banku nie ma prawidłowej waluty.',
    })
  }
  const productName = String(offer.product_name ?? '').trim()
  if (!productName) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wniosek OpenExpert Banku nie ma nazwy produktu.',
    })
  }

  return {
    organizationId: session.organizationId,
    application: application as Record<string, any>,
    applicationId,
    applicationNumber,
    applicantNames,
    primaryApplicantName: String(primaryClientResult.data?.display_name || primaryPerson?.display_name || applicantNames[0]),
    primaryClientId,
    pesel,
    productName,
    currency,
    loanAmount,
    termMonths: requiredPositiveInteger(Number(scenario.years) * 12, 'okres kredytowania'),
    interestRatePct: requiredPositiveNumber(version.fixed_rate_pct, 'oprocentowanie nominalne'),
    aprcPct: requiredPositiveNumber(
      offer.representative_apr_pct ?? version.representative_apr_pct,
      'RRSO',
    ),
    monthlyInstallment: requiredPositiveNumber(
      application.first_installment ?? offer.first_installment,
      'pierwsza rata',
    ),
    process: {
      stage: String(process.stage),
      revision: Number(process.revision),
      applicationSubmittedAt: process.application_submitted_at ? String(process.application_submitted_at) : null,
      completenessConfirmedAt: process.completeness_confirmed_at ? String(process.completeness_confirmed_at) : null,
      decisionDueAt: process.decision_due_at ? String(process.decision_due_at) : null,
    },
  }
}
