import { Buffer } from 'node:buffer'
import { createError, type H3Event } from 'h3'
import { caseUuidPattern } from './case-identifiers'
import {
  prepareCaseMultiform,
  resolveCaseMultiformSelection,
  type CaseMultiformSelection,
} from './case-multiform'
import { caseMultiformSelectionFingerprint } from './case-multiform-draft-validation'
import {
  invalidClientMultiformFieldKeys,
  mergeOwnedClientMultiformValues,
  sanitizeClientMultiformField,
  verifiedClientMultiformLinks,
  type ClientMultiformVerifiedLink,
} from './client-multiform-scope'
import { requireAuthIdentity, throwDbError, type AuthIdentity } from './crm'
import { serverDataBackend } from './data-api'

type DatabaseRecord = Record<string, any>
type JsonRecord = Record<string, unknown>

export interface ClientMultiformAccess {
  identity: AuthIdentity
  backend: any
  organizationId: string
  organizationName: string
  organizationSlug: string
  caseId: string
  caseTitle: string
  clientId: string
  clientPersonId: string
  applicantIndex: number
  applicantCount: number
  applicantLabel: string
  person: DatabaseRecord
  selection: CaseMultiformSelection
}

interface ClientPreparedForm {
  access: ClientMultiformAccess
  allowedKeys: Set<string>
  draft: DatabaseRecord | null
  response: DatabaseRecord
  selectionFingerprint: string
}

const draftSelect = [
  'selection_fingerprint',
  'revision',
  'active_step',
  'intake_answers',
  'form_values',
  'collection_counts',
  'selected_document_ids',
  'client_portal_step',
  'client_portal_completed_at',
  'created_at',
  'updated_at',
].join(', ')

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function loadVerifiedClientLinks(
  identity: AuthIdentity,
  backend: any,
): Promise<ClientMultiformVerifiedLink[]> {
  const result = await backend
    .from('client_account_links')
    .select('organization_id, client_id, client_person_id, verification_method, verified_contact_normalized')
    .eq('auth_user_id', identity.userId)
    .is('revoked_at', null)
  throwDbError(result.error)
  return verifiedClientMultiformLinks(
    identity.email,
    identity.emailVerified,
    (result.data ?? []) as DatabaseRecord[],
  )
}

function accessNotFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono udostępnionego formularza.' })
}

export async function requireClientMultiformAccess(
  event: H3Event,
  caseId: string,
): Promise<ClientMultiformAccess> {
  if (!caseUuidPattern.test(caseId)) accessNotFound()

  const identity = await requireAuthIdentity(event)
  const backend = serverDataBackend(event) as any
  const links = await loadVerifiedClientLinks(identity, backend)
  if (!links.length) accessNotFound()

  const grantResult = await backend
    .from('client_portal_case_grants')
    .select('organization_id, case_id, client_id, client_person_id, granted_by_user_id')
    .eq('case_id', caseId)
    .eq('portal_enabled', true)
    .eq('multiform_enabled', true)
    .is('revoked_at', null)
  throwDbError(grantResult.error)

  const grant = ((grantResult.data ?? []) as DatabaseRecord[]).find(row => links.some(link => (
    link.organizationId === String(row.organization_id)
    && link.clientId === String(row.client_id)
    && link.clientPersonId === String(row.client_person_id)
  )))
  if (!grant) accessNotFound()

  const link = links.find(candidate => (
    candidate.organizationId === String(grant.organization_id)
    && candidate.clientId === String(grant.client_id)
    && candidate.clientPersonId === String(grant.client_person_id)
  ))
  if (!link) accessNotFound()

  const [personResult, caseResult, organizationResult, caseClientsResult, membershipsResult] = await Promise.all([
    backend
      .from('crm_client_people')
      .select('id, client_id, display_name, first_name, last_name, email, email_normalized, phone, pesel, date_of_birth')
      .eq('organization_id', link.organizationId)
      .eq('client_id', link.clientId)
      .eq('id', link.clientPersonId)
      .maybeSingle(),
    backend
      .from('crm_cases')
      .select('id, title, owner_user_id')
      .eq('organization_id', link.organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    backend
      .from('organizations')
      .select('id, name, slug')
      .eq('id', link.organizationId)
      .maybeSingle(),
    backend
      .from('crm_case_clients')
      .select('client_id, is_primary, created_at')
      .eq('organization_id', link.organizationId)
      .eq('case_id', caseId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true }),
    backend
      .from('organization_memberships')
      .select('user_id, role, created_at')
      .eq('organization_id', link.organizationId)
      .order('created_at', { ascending: true }),
  ])
  throwDbError(personResult.error)
  throwDbError(caseResult.error)
  throwDbError(organizationResult.error)
  throwDbError(caseClientsResult.error)
  throwDbError(membershipsResult.error)

  const person = personResult.data as DatabaseRecord | null
  const crmCase = caseResult.data as DatabaseRecord | null
  const organization = organizationResult.data as DatabaseRecord | null
  if (
    !person
    || !crmCase
    || !organization
    || String(person.email_normalized ?? '') !== link.verifiedEmail
  ) accessNotFound()

  const caseClients = (caseClientsResult.data ?? []) as DatabaseRecord[]
  const applicantIndex = caseClients.findIndex(row => String(row.client_id) === link.clientId)
  if (applicantIndex < 0) accessNotFound()

  const memberships = (membershipsResult.data ?? []) as DatabaseRecord[]
  const preferredStaffIds = [
    grant.granted_by_user_id,
    crmCase.owner_user_id,
  ].filter(Boolean).map(String)
  const staffUserId = preferredStaffIds.find(candidate => (
    memberships.some(row => String(row.user_id) === candidate)
  )) ?? (memberships[0]?.user_id ? String(memberships[0].user_id) : '')
  if (!staffUserId) {
    throw createError({ statusCode: 409, statusMessage: 'Formularz nie ma aktywnego opiekuna w organizacji.' })
  }

  const selection = await resolveCaseMultiformSelection({
    dataApi: backend,
    organizationId: link.organizationId,
    organizationSlug: String(organization.slug),
    caseId,
    userId: staffUserId,
  })

  return {
    identity,
    backend,
    organizationId: link.organizationId,
    organizationName: String(organization.name),
    organizationSlug: String(organization.slug),
    caseId,
    caseTitle: String(crmCase.title),
    clientId: link.clientId,
    clientPersonId: link.clientPersonId,
    applicantIndex,
    applicantCount: caseClients.length,
    applicantLabel: String(person.display_name),
    person,
    selection,
  }
}

function personDefault(access: ClientMultiformAccess, field: DatabaseRecord): string | undefined {
  const relativeKey = text(asRecord(field.collection).relativeKey)
    || text(field.key).slice(`applicants.${access.applicantIndex}.`.length)
  const firstName = text(access.person.first_name).trim()
  const lastName = text(access.person.last_name).trim()
  const defaults: Record<string, string> = {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' ') || access.applicantLabel,
    pesel: text(access.person.pesel).trim(),
    email: text(access.person.email).trim(),
    phone: text(access.person.phone).trim(),
    birthDate: text(access.person.date_of_birth).trim(),
  }
  return Object.prototype.hasOwnProperty.call(defaults, relativeKey)
    ? defaults[relativeKey]
    : undefined
}

function clientFormResponse(input: {
  access: ClientMultiformAccess
  draft: DatabaseRecord | null
  fields: DatabaseRecord[]
  selectionFingerprint: string
}): DatabaseRecord {
  const { access, draft, fields, selectionFingerprint } = input
  const storedValues = draft?.selection_fingerprint === selectionFingerprint
    ? asRecord(draft.form_values)
    : {}
  const values = Object.fromEntries(fields.map((field) => {
    const stored = storedValues[text(field.key)]
    const fallback = personDefault(access, field)
    const storedIsBlank = stored === undefined || stored === null || (typeof stored === 'string' && !stored.trim())
    return [
      text(field.key),
      storedIsBlank && fallback ? fallback : stored ?? fallback ?? (field.type === 'checkbox' ? false : ''),
    ]
  }))

  return {
    data: {
      case: {
        id: access.caseId,
        title: access.caseTitle,
        organization: {
          name: access.organizationName,
          slug: access.organizationSlug,
        },
      },
      applicant: {
        clientId: access.clientId,
        index: access.applicantIndex,
        label: access.applicantLabel,
      },
      selectionFingerprint,
      revision: draft ? Number(draft.revision ?? 0) : 0,
      fields,
      values,
      updatedAt: draft?.selection_fingerprint === selectionFingerprint && draft?.updated_at
        ? String(draft.updated_at)
        : null,
      completedAt: draft?.selection_fingerprint === selectionFingerprint && draft?.client_portal_completed_at
        ? String(draft.client_portal_completed_at)
        : null,
    },
  }
}

async function prepareClientForm(
  event: H3Event,
  access: ClientMultiformAccess,
): Promise<ClientPreparedForm> {
  const selectionFingerprint = caseMultiformSelectionFingerprint(access.selection)
  const [bundle, draftResult] = await Promise.all([
    prepareCaseMultiform(event, access.selection, { includeAuthCookies: false }) as Promise<DatabaseRecord>,
    access.backend
      .from('crm_case_multiform_drafts')
      .select(draftSelect)
      .eq('organization_id', access.organizationId)
      .eq('case_id', access.caseId)
      .maybeSingle(),
  ])
  throwDbError(draftResult.error)
  const draft = draftResult.data as DatabaseRecord | null
  const currentValues = draft?.selection_fingerprint === selectionFingerprint
    ? asRecord(draft.form_values)
    : {}
  const applicantPrefix = `applicants.${access.applicantIndex}.`
  const applicantCollection = (Array.isArray(bundle.collections) ? bundle.collections : [])
    .find((collection: DatabaseRecord) => collection?.key === 'applicants') as DatabaseRecord | undefined
  const requiredRelativeKeys = new Set(
    Array.isArray(applicantCollection?.requiredRelativeKeys)
      ? applicantCollection.requiredRelativeKeys.map(String)
      : [],
  )
  const fields = (Array.isArray(bundle.fields) ? bundle.fields : [])
    .filter((field): field is DatabaseRecord => (
      field && typeof field === 'object' && !Array.isArray(field)
      && text(field.key).startsWith(applicantPrefix)
    ))
    .map((field) => {
      const relativeKey = text(asRecord(field.collection).relativeKey)
      return requiredRelativeKeys.has(relativeKey) ? { ...field, required: true } : field
    })
    .map(field => sanitizeClientMultiformField(field, applicantPrefix, currentValues))
    .filter((field): field is DatabaseRecord => Boolean(field))

  if (!fields.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wybrane formularze bankowe nie zawierają pól dla tego wnioskodawcy.',
    })
  }

  return {
    access,
    allowedKeys: new Set(fields.map(field => text(field.key))),
    draft,
    response: clientFormResponse({ access, draft, fields, selectionFingerprint }),
    selectionFingerprint,
  }
}

export async function loadClientMultiformForm(event: H3Event, caseId: string) {
  const access = await requireClientMultiformAccess(event, caseId)
  return (await prepareClientForm(event, access)).response
}

function parseClientFormInput(value: unknown) {
  const body = asRecord(value)
  const allowedBodyKeys = new Set(['selectionFingerprint', 'revision', 'values', 'completed'])
  if (Object.keys(body).some(key => !allowedBodyKeys.has(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Żądanie zawiera nieobsługiwane pola.' })
  }
  if (typeof body.selectionFingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(body.selectionFingerprint)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowa wersja formularza.' })
  }
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowa rewizja formularza.' })
  }
  if (typeof body.completed !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Pole completed musi być wartością logiczną.' })
  }
  const values = asRecord(body.values)
  if (Buffer.byteLength(JSON.stringify(values), 'utf8') > 1024 * 1024) {
    throw createError({ statusCode: 400, statusMessage: 'Formularz jest zbyt duży.' })
  }
  for (const [key, fieldValue] of Object.entries(values)) {
    if (!key || key.length > 300) {
      throw createError({ statusCode: 400, statusMessage: 'Formularz zawiera nieprawidłowe pole.' })
    }
    if (!['string', 'number', 'boolean'].includes(typeof fieldValue)) {
      throw createError({ statusCode: 400, statusMessage: `Pole ${key} ma nieprawidłową wartość.` })
    }
    if (typeof fieldValue === 'string' && fieldValue.length > 20_000) {
      throw createError({ statusCode: 400, statusMessage: `Pole ${key} jest zbyt długie.` })
    }
  }
  return {
    selectionFingerprint: body.selectionFingerprint,
    revision: Number(body.revision),
    values,
    completed: body.completed,
  }
}

export async function saveClientMultiformForm(
  event: H3Event,
  caseId: string,
  body: unknown,
) {
  const input = parseClientFormInput(body)
  const access = await requireClientMultiformAccess(event, caseId)
  const prepared = await prepareClientForm(event, access)
  if (input.selectionFingerprint !== prepared.selectionFingerprint) {
    throw createError({ statusCode: 409, statusMessage: 'Zakres wniosków zmienił się. Odśwież formularz.' })
  }
  const currentRevision = prepared.draft ? Number(prepared.draft.revision ?? 0) : 0
  if (input.revision !== currentRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Formularz został zmieniony przez eksperta. Odśwież stronę przed zapisem.',
      data: { currentRevision },
    })
  }
  const currentValues = prepared.draft?.selection_fingerprint === prepared.selectionFingerprint
    ? asRecord(prepared.draft.form_values)
    : {}
  const merged = mergeOwnedClientMultiformValues(currentValues, input.values, prepared.allowedKeys)
  if (merged.unknownKey) {
    throw createError({ statusCode: 400, statusMessage: 'Nie możesz zmienić pola spoza własnej części formularza.' })
  }
  const preparedFields = (prepared.response.data as DatabaseRecord).fields as DatabaseRecord[]
  if (input.completed) {
    const invalidKeys = invalidClientMultiformFieldKeys(preparedFields, merged.values)
    if (invalidKeys.length) {
      throw createError({
        statusCode: 400,
        statusMessage: `Uzupełnij lub popraw wymagane pola (${invalidKeys.length}).`,
        data: { invalidKeys },
      })
    }
  }
  const now = new Date().toISOString()
  const draftMatchesSelection = prepared.draft?.selection_fingerprint === prepared.selectionFingerprint
  const values = {
    selection_fingerprint: prepared.selectionFingerprint,
    active_step: draftMatchesSelection && prepared.draft?.active_step
      ? Number(prepared.draft.active_step)
      : 1,
    intake_answers: draftMatchesSelection && prepared.draft
      ? asRecord(prepared.draft.intake_answers)
      : {},
    form_values: merged.values,
    collection_counts: draftMatchesSelection && prepared.draft
      ? asRecord(prepared.draft.collection_counts)
      : { applicants: access.applicantCount },
    selected_document_ids: draftMatchesSelection
      && prepared.draft
      && Array.isArray(prepared.draft.selected_document_ids)
      ? prepared.draft.selected_document_ids
      : [],
    updated_by_user_id: null,
    updated_by_client_person_id: access.clientPersonId,
    updated_by_auth_user_id: access.identity.userId,
    client_portal_step: input.completed ? 3 : 2,
    client_portal_completed_at: input.completed ? now : null,
  }

  let result: { data?: unknown, error?: any }
  if (currentRevision === 0) {
    result = await access.backend
      .from('crm_case_multiform_drafts')
      .insert({
        organization_id: access.organizationId,
        case_id: access.caseId,
        revision: 1,
        ...values,
      })
      .select(draftSelect)
      .single()
  }
  else {
    result = await access.backend
      .from('crm_case_multiform_drafts')
      .update({ revision: currentRevision + 1, ...values })
      .eq('organization_id', access.organizationId)
      .eq('case_id', access.caseId)
      .eq('revision', currentRevision)
      .select(draftSelect)
      .maybeSingle()
  }
  if (result.error?.code === '23505' || (!result.error && !result.data)) {
    throw createError({ statusCode: 409, statusMessage: 'Formularz został właśnie zmieniony. Odśwież stronę.' })
  }
  throwDbError(result.error)
  const savedDraft = result.data as DatabaseRecord

  if (input.completed) {
    const activityResult = await access.backend.from('crm_activities').insert({
      organization_id: access.organizationId,
      actor_user_id: null,
      actor_client_person_id: access.clientPersonId,
      actor_auth_user_id: access.identity.userId,
      client_id: access.clientId,
      case_id: access.caseId,
      activity_type: 'multiform_client_completed',
      title: 'Klient przekazał uzupełniony Multiwniosek',
      body: `${access.applicantLabel} zapisał swoją część formularza do weryfikacji eksperta.`,
      payload: { revision: Number(savedDraft.revision) },
    })
    if (activityResult.error) {
      console.warn('[client-multiform] failed to record completion activity', activityResult.error.message)
    }
  }

  return clientFormResponse({
    access,
    draft: savedDraft,
    fields: preparedFields,
    selectionFingerprint: prepared.selectionFingerprint,
  })
}

export async function listClientMultiformCases(event: H3Event) {
  const identity = await requireAuthIdentity(event)
  const backend = serverDataBackend(event) as any
  const links = await loadVerifiedClientLinks(identity, backend)
  if (!links.length) return { data: [] }

  const grantsResult = await backend
    .from('client_portal_case_grants')
    .select('organization_id, case_id, client_id, client_person_id, multiform_enabled_at, updated_at')
    .in('client_person_id', [...new Set(links.map(link => link.clientPersonId))])
    .eq('portal_enabled', true)
    .eq('multiform_enabled', true)
    .is('revoked_at', null)
    .order('updated_at', { ascending: false })
    .limit(100)
  throwDbError(grantsResult.error)

  const grants = ((grantsResult.data ?? []) as DatabaseRecord[]).filter(grant => links.some(link => (
    link.organizationId === String(grant.organization_id)
    && link.clientId === String(grant.client_id)
    && link.clientPersonId === String(grant.client_person_id)
  )))

  const summaries = await Promise.all(grants.map(async (grant) => {
    const link = links.find(candidate => (
      candidate.organizationId === String(grant.organization_id)
      && candidate.clientId === String(grant.client_id)
      && candidate.clientPersonId === String(grant.client_person_id)
    ))!
    const [personResult, caseResult, organizationResult, draftResult] = await Promise.all([
      backend
        .from('crm_client_people')
        .select('display_name, email_normalized')
        .eq('organization_id', link.organizationId)
        .eq('client_id', link.clientId)
        .eq('id', link.clientPersonId)
        .maybeSingle(),
      backend
        .from('crm_cases')
        .select('id, title')
        .eq('organization_id', link.organizationId)
        .eq('id', String(grant.case_id))
        .maybeSingle(),
      backend
        .from('organizations')
        .select('name, slug')
        .eq('id', link.organizationId)
        .maybeSingle(),
      backend
        .from('crm_case_multiform_drafts')
        .select('revision, client_portal_completed_at, updated_at')
        .eq('organization_id', link.organizationId)
        .eq('case_id', String(grant.case_id))
        .maybeSingle(),
    ])
    throwDbError(personResult.error)
    throwDbError(caseResult.error)
    throwDbError(organizationResult.error)
    throwDbError(draftResult.error)
    const person = personResult.data as DatabaseRecord | null
    const crmCase = caseResult.data as DatabaseRecord | null
    const organization = organizationResult.data as DatabaseRecord | null
    if (
      !person
      || !crmCase
      || !organization
      || String(person.email_normalized ?? '') !== link.verifiedEmail
    ) return null
    const draft = draftResult.data as DatabaseRecord | null
    return {
      id: String(crmCase.id),
      title: String(crmCase.title),
      organization: {
        name: String(organization.name),
        slug: String(organization.slug),
      },
      applicantLabel: String(person.display_name),
      sharedAt: grant.multiform_enabled_at ? String(grant.multiform_enabled_at) : String(grant.updated_at),
      updatedAt: draft?.updated_at ? String(draft.updated_at) : null,
      completedAt: draft?.client_portal_completed_at ? String(draft.client_portal_completed_at) : null,
    }
  }))

  return { data: summaries.filter(Boolean) }
}
