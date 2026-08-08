import { useRuntimeConfig } from '#imports'
import {
  appendResponseHeader,
  createError,
  getHeader,
  sendStream,
  setHeader,
  type H3Event,
} from 'h3'
import { assertUuid, requireCrmCase } from './case-documents'
import { filterAuthCookieHeader } from './auth-cookie-header'
import { getRequiredParam, requireCrmSession, throwDbError } from './crm'
import { serverDataTokenSigner } from './platform-data'

type JsonRecord = Record<string, unknown>

interface CaseMultiformApplicationRow {
  submission_id: string
  case_item_id: string
  offer_id: string
  slot: number
}

interface CaseMultiformSubmissionRow {
  id: string
  status_code: string
}

interface CaseMultiformOfferRow {
  id: string
  bank_name: string
  product_name: string
  catalog_snapshot: unknown
}

export interface CaseMultiformSelection {
  userId: string
  organizationSlug: string
  caseId: string
  applications: Array<{
    applicationId: string
    offerId: string
    bankName: string
    templateIds: string[]
  }>
  applicationIds: string[]
  offerIds: string[]
  templateIds: string[]
}

const activeApplicationStatuses = new Set([
  'draft',
  'wyslane',
  'w_analizie',
  'braki',
  'zaakceptowane',
])

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseTemplateIds(catalogSnapshot: unknown, offerLabel: string): string[] {
  const version = asRecord(asRecord(catalogSnapshot).version)
  const configured = version.multiform_template_ids === undefined
    ? []
    : Array.isArray(version.multiform_template_ids)
      ? version.multiform_template_ids.map(nonEmptyString)
      : [undefined]
  const requirementIds = Array.isArray(version.document_requirements)
    ? version.document_requirements.flatMap((entry) => {
        const templateId = nonEmptyString(asRecord(entry).templateId)
        return templateId ? [templateId] : []
      })
    : []
  if (configured.some(id => !id)) {
    throw createError({
      statusCode: 409,
      statusMessage: `${offerLabel} ma nieprawidłową konfigurację formularzy bankowych.`,
    })
  }
  return [...new Set([...(configured as string[]), ...requirementIds])]
}

export async function requireCaseMultiformSelection(event: H3Event): Promise<CaseMultiformSelection> {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  assertUuid(caseId, 'case id')
  await requireCrmCase(session, caseId)

  const [applicationsResult, contractResult] = await Promise.all([
    session.dataApi
      .from('crm_case_bank_applications')
      .select('submission_id, case_item_id, offer_id, slot')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .order('slot', { ascending: true }),
    session.dataApi
      .from('crm_case_contract_selections')
      .select('application_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .maybeSingle(),
  ])
  throwDbError(applicationsResult.error)
  throwDbError(contractResult.error)

  const applications = (applicationsResult.data ?? []) as CaseMultiformApplicationRow[]
  if (applications.length > 3) {
    throw createError({ statusCode: 500, statusMessage: 'Sprawa ma więcej niż trzy wnioski bankowe.' })
  }
  if (!applications.length) {
    throw createError({ statusCode: 409, statusMessage: 'Najpierw dodaj co najmniej jeden wniosek bankowy do sprawy.' })
  }

  const allApplicationIds = applications.map(application => String(application.submission_id))
  const { data: submissions, error: submissionsError } = await session.dataApi
    .from('crm_item_submissions')
    .select('id, status_code')
    .eq('organization_id', session.organizationId)
    .in('id', allApplicationIds)
  throwDbError(submissionsError)
  const statusByApplicationId = new Map(
    ((submissions ?? []) as CaseMultiformSubmissionRow[])
      .map(submission => [String(submission.id), String(submission.status_code)]),
  )
  if (statusByApplicationId.size !== applications.length) {
    throw createError({ statusCode: 500, statusMessage: 'Co najmniej jeden wniosek bankowy nie ma rekordu procesu.' })
  }

  const signedApplicationId = nonEmptyString(contractResult.data?.application_id)
  const selectedApplications = signedApplicationId
    ? applications.filter(application => String(application.submission_id) === signedApplicationId)
    : applications.filter(application => activeApplicationStatuses.has(
        statusByApplicationId.get(String(application.submission_id)) ?? '',
      ))

  if (signedApplicationId && selectedApplications.length !== 1) {
    throw createError({ statusCode: 409, statusMessage: 'Podpisana umowa nie wskazuje wniosku bankowego tej sprawy.' })
  }
  if (!selectedApplications.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Sprawa nie ma aktywnych wniosków bankowych do przygotowania.',
    })
  }

  const offerIds = selectedApplications.map(application => String(application.offer_id))
  const { data: offers, error: offersError } = await session.dataApi
    .from('crm_case_offer_snapshots')
    .select('id, bank_name, product_name, catalog_snapshot')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .in('id', offerIds)
  throwDbError(offersError)
  const offerById = new Map(
    ((offers ?? []) as CaseMultiformOfferRow[]).map(offer => [String(offer.id), offer]),
  )
  if (offerById.size !== selectedApplications.length) {
    throw createError({ statusCode: 409, statusMessage: 'Co najmniej jedna oferta wniosku nie istnieje już w tej sprawie.' })
  }

  const selectedApplicationDetails = selectedApplications.map((application) => {
    const offer = offerById.get(String(application.offer_id))
    if (!offer) {
      throw createError({ statusCode: 409, statusMessage: 'Nie znaleziono oferty aktywnego wniosku.' })
    }
    const label = `${String(offer.bank_name)} — ${String(offer.product_name)}`
    return {
      applicationId: String(application.submission_id),
      offerId: String(application.offer_id),
      bankName: String(offer.bank_name),
      templateIds: parseTemplateIds(offer.catalog_snapshot, label),
    }
  })
  const templateIds = [...new Set(selectedApplicationDetails.flatMap(application => application.templateIds))]

  return {
    userId: session.userId,
    organizationSlug: session.organizationSlug,
    caseId,
    applications: selectedApplicationDetails,
    applicationIds: selectedApplications.map(application => String(application.submission_id)),
    offerIds,
    templateIds,
  }
}

export function filterCaseMultiformSelection(
  selection: CaseMultiformSelection,
  requestedApplicationIds: unknown,
): CaseMultiformSelection {
  if (!Array.isArray(requestedApplicationIds) || requestedApplicationIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Wybierz co najmniej jeden wniosek bankowy.' })
  }
  if (requestedApplicationIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw createError({ statusCode: 400, statusMessage: 'Lista wniosków bankowych jest nieprawidłowa.' })
  }

  const requested = [...new Set(requestedApplicationIds.map(id => String(id).trim()))]
  const available = new Map(selection.applications.map(application => [application.applicationId, application]))
  if (requested.some(applicationId => !available.has(applicationId))) {
    throw createError({ statusCode: 404, statusMessage: 'Wybrany wniosek nie należy do tej sprawy.' })
  }

  const applications = requested.map(applicationId => available.get(applicationId)!)
  return {
    ...selection,
    applications,
    applicationIds: applications.map(application => application.applicationId),
    offerIds: [...new Set(applications.map(application => application.offerId))],
    templateIds: [...new Set(applications.flatMap(application => application.templateIds))],
  }
}

function multiformServiceTarget(event: H3Event, path: string) {
  const configured = String(useRuntimeConfig(event).multiformServiceUrl || '').trim()
  if (!configured) {
    throw createError({ statusCode: 503, statusMessage: 'Usługa Multiwniosku nie jest skonfigurowana.' })
  }

  let base: URL
  try {
    base = new URL(configured)
  }
  catch {
    throw createError({ statusCode: 503, statusMessage: 'Adres usługi Multiwniosku jest nieprawidłowy.' })
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw createError({ statusCode: 503, statusMessage: 'Adres usługi Multiwniosku jest nieprawidłowy.' })
  }
  base.pathname = `${base.pathname.replace(/\/+$/g, '')}/`
  base.search = ''
  base.hash = ''
  return new URL(path.replace(/^\/+/, ''), base)
}

function authCookieHeader(event: H3Event) {
  const cookieHeader = getHeader(event, 'cookie') ?? ''
  const authConfig = useRuntimeConfig(event).auth as { cookiePrefix?: string }
  const prefix = String(authConfig.cookiePrefix || '').trim()
  return filterAuthCookieHeader(cookieHeader, prefix)
}

function forwardedHeaders(event: H3Event, userId: string) {
  const headers = new Headers({
    accept: 'application/json, application/zip',
    'content-type': 'application/json',
  })
  const authCookies = authCookieHeader(event)
  if (authCookies) headers.set('cookie', authCookies)
  headers.set('authorization', `Bearer ${serverDataTokenSigner(event).signUser(userId, {
    purpose: 'openexpert:multiform-service',
  })}`)
  return headers
}

function forwardSetCookies(event: H3Event, response: Response) {
  const values = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  for (const cookie of values) appendResponseHeader(event, 'set-cookie', cookie)
}

async function upstreamError(response: Response): Promise<never> {
  let payload: JsonRecord = {}
  try {
    payload = asRecord(await response.json())
  }
  catch {
    // Upstream errors are normalized below without leaking its raw response.
  }
  throw createError({
    statusCode: response.status || 502,
    statusMessage: nonEmptyString(payload.statusMessage)
      || nonEmptyString(payload.message)
      || 'Usługa Multiwniosku odrzuciła żądanie.',
    data: asRecord(payload.data),
  })
}

async function callMultiformService(
  event: H3Event,
  path: string,
  userId: string,
  options: { method?: 'GET' | 'POST', body?: JsonRecord } = {},
) {
  let response: Response
  try {
    response = await fetch(multiformServiceTarget(event, path), {
      method: options.method ?? 'GET',
      headers: forwardedHeaders(event, userId),
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: 'error',
    })
  }
  catch (error) {
    console.error('[case-multiform] service request failed', error instanceof Error ? error.name : 'UnknownError')
    throw createError({ statusCode: 502, statusMessage: 'Usługa Multiwniosku jest chwilowo niedostępna.' })
  }
  forwardSetCookies(event, response)
  if (!response.ok) await upstreamError(response)
  return response
}

export async function loadCaseMultiformContext(
  event: H3Event,
  selection: CaseMultiformSelection,
) {
  const query = new URLSearchParams({
    organizationSlug: selection.organizationSlug,
    caseId: selection.caseId,
  })
  selection.applicationIds.forEach(applicationId => query.append('applicationIds', applicationId))
  selection.offerIds.forEach(offerId => query.append('offerIds', offerId))
  const response = await callMultiformService(
    event,
    `/api/multiform/crm/context?${query.toString()}`,
    selection.userId,
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return response.json()
}

export async function prepareCaseMultiform(
  event: H3Event,
  selection: CaseMultiformSelection,
) {
  if (!selection.templateIds.length) {
    throw createError({ statusCode: 409, statusMessage: 'Aktywne wnioski nie mają przypisanych formularzy bankowych.' })
  }
  const response = await callMultiformService(event, '/api/multiform/bundle/prepare', selection.userId, {
    method: 'POST',
    body: {
      templateIds: selection.templateIds,
      crmContext: {
        organizationSlug: selection.organizationSlug,
        caseId: selection.caseId,
        applicationIds: selection.applicationIds,
        offerIds: selection.offerIds,
      },
    },
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return response.json()
}

export interface CaseMultiformFillInput {
  values: unknown
  collectionCounts: unknown
  documentIds: unknown
  password?: unknown
}

async function requestCaseMultiformArchive(
  event: H3Event,
  selection: CaseMultiformSelection,
  input: CaseMultiformFillInput,
) {
  if (!selection.templateIds.length) {
    throw createError({ statusCode: 409, statusMessage: 'Aktywne wnioski nie mają przypisanych formularzy bankowych.' })
  }
  if (!Array.isArray(input.documentIds)) {
    throw createError({ statusCode: 400, statusMessage: 'Lista załączników jest nieprawidłowa.' })
  }
  const response = await callMultiformService(event, '/api/multiform/bundle/fill', selection.userId, {
    method: 'POST',
    body: {
      templateIds: selection.templateIds,
      values: input.values,
      collectionCounts: input.collectionCounts,
      ...(input.password ? { password: input.password } : {}),
      crmContext: {
        organizationSlug: selection.organizationSlug,
        caseId: selection.caseId,
        applicationIds: selection.applicationIds,
        offerIds: selection.offerIds,
        documentIds: input.documentIds,
      },
    },
  })
  return response
}

export async function createCaseMultiformArchive(
  event: H3Event,
  selection: CaseMultiformSelection,
  input: CaseMultiformFillInput,
) {
  const response = await requestCaseMultiformArchive(event, selection, input)
  return new Uint8Array(await response.arrayBuffer())
}

export async function fillCaseMultiform(
  event: H3Event,
  selection: CaseMultiformSelection,
  input: CaseMultiformFillInput,
) {
  const response = await requestCaseMultiformArchive(event, selection, input)
  setHeader(event, 'Content-Type', response.headers.get('content-type') || 'application/zip')
  setHeader(event, 'Content-Disposition', response.headers.get('content-disposition') || 'attachment; filename="uzupelnione-wnioski.zip"')
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  return sendStream(event, response.body)
}

export async function fillCaseMultiformDocument(
  event: H3Event,
  selection: CaseMultiformSelection,
  input: {
    templateId: string
    variant: 'filled' | 'blank'
    values: unknown
    collectionCounts: unknown
  },
) {
  if (!selection.templateIds.includes(input.templateId)) {
    throw createError({ statusCode: 404, statusMessage: 'Formularz nie należy do aktywnych wniosków tej sprawy.' })
  }
  const response = await callMultiformService(event, '/api/multiform/bundle/fill', selection.userId, {
    method: 'POST',
    body: {
      templateIds: selection.templateIds,
      templateId: input.templateId,
      output: input.variant === 'blank' ? 'source' : 'pdf',
      values: input.values,
      collectionCounts: input.collectionCounts,
      crmContext: {
        organizationSlug: selection.organizationSlug,
        caseId: selection.caseId,
        applicationIds: selection.applicationIds,
        offerIds: selection.offerIds,
        documentIds: [],
      },
    },
  })
  setHeader(event, 'Content-Type', response.headers.get('content-type') || 'application/pdf')
  setHeader(
    event,
    'Content-Disposition',
    response.headers.get('content-disposition')
      || `attachment; filename="${input.variant === 'blank' ? 'pusty-szablon.pdf' : 'uzupelniony-wniosek.pdf'}"`,
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  return sendStream(event, response.body)
}
