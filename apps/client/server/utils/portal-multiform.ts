import { createHash } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { serverDataBackend } from './data-api'
import {
  asRecord,
  publicGrant,
  requirePortalCaseAccess,
  throwPortalDbError,
} from './portal-auth'

const incomeSources = new Set([
  'employment', 'business', 'civil_contract', 'retirement', 'rental', 'foreign', 'other',
])
const employmentTypes = new Set(['indefinite', 'fixed', 'probation', 'other'])
const loanPurposes = new Set([
  'purchase_primary', 'purchase_secondary', 'construction', 'renovation', 'refinance',
])
const activeApplicationStatuses = new Set([
  'draft', 'wyslane', 'w_analizie', 'braki', 'zaakceptowane',
])

type Row = Record<string, any>

function nullableEnum(value: unknown, allowed: Set<string>): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && allowed.has(value)) return value
  throw createError({ statusCode: 400, statusMessage: 'Invalid multiform answer' })
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  throw createError({ statusCode: 400, statusMessage: 'Invalid multiform answer' })
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(record).some(key => !keys.includes(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported multiform field' })
  }
}

function normalizeAnswers(value: unknown) {
  const answers = asRecord(value)
  exactKeys(answers, ['applicant', 'case'])
  const applicant = asRecord(answers.applicant)
  const caseAnswers = asRecord(answers.case)
  exactKeys(applicant, [
    'incomeSource',
    'employmentType',
    'incomePaidToAccount',
    'additionalIncome',
    'liabilities',
  ])
  exactKeys(caseAnswers, [
    'loanPurpose',
    'preliminaryAgreement',
    'landRegister',
    'appraisalAvailable',
    'trancheDisbursement',
  ])
  const incomeSource = nullableEnum(applicant.incomeSource, incomeSources)
  return {
    applicant: {
      incomeSource,
      employmentType: incomeSource === 'employment'
        ? nullableEnum(applicant.employmentType, employmentTypes)
        : null,
      incomePaidToAccount: nullableBoolean(applicant.incomePaidToAccount),
      additionalIncome: nullableBoolean(applicant.additionalIncome),
      liabilities: nullableBoolean(applicant.liabilities),
    },
    case: {
      loanPurpose: nullableEnum(caseAnswers.loanPurpose, loanPurposes),
      preliminaryAgreement: nullableBoolean(caseAnswers.preliminaryAgreement),
      landRegister: nullableBoolean(caseAnswers.landRegister),
      appraisalAvailable: nullableBoolean(caseAnswers.appraisalAvailable),
      trancheDisbursement: nullableBoolean(caseAnswers.trancheDisbursement),
    },
  }
}

function emptyAnswers() {
  return normalizeAnswers({
    applicant: {
      incomeSource: null,
      employmentType: null,
      incomePaidToAccount: null,
      additionalIncome: null,
      liabilities: null,
    },
    case: {
      loanPurpose: null,
      preliminaryAgreement: null,
      landRegister: null,
      appraisalAvailable: null,
      trancheDisbursement: null,
    },
  })
}

function publicAnswers(intake: unknown, clientId: string) {
  const source = asRecord(intake)
  const applicant = asRecord(asRecord(source.applicants)[clientId])
  const caseAnswers = asRecord(source.case)
  try {
    return normalizeAnswers({ applicant, case: caseAnswers })
  }
  catch {
    return emptyAnswers()
  }
}

function publicDraft(row: Row | null, clientId: string) {
  if (!row) return null
  return {
    answers: publicAnswers(row.intake_answers, clientId),
    activeStep: Number(row.client_portal_step ?? 1),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
    completedAt: row.client_portal_completed_at
      ? String(row.client_portal_completed_at)
      : null,
  }
}

async function selectionFingerprint(backend: any, organizationId: string, caseId: string) {
  const [applicationsResult, contractResult] = await Promise.all([
    backend
      .from('crm_case_bank_applications')
      .select('submission_id, offer_id, slot')
      .eq('organization_id', organizationId)
      .eq('case_id', caseId)
      .order('slot', { ascending: true }),
    backend
      .from('crm_case_contract_selections')
      .select('application_id')
      .eq('organization_id', organizationId)
      .eq('case_id', caseId)
      .maybeSingle(),
  ])
  throwPortalDbError(applicationsResult.error, 'could not inspect multiform applications')
  throwPortalDbError(contractResult.error, 'could not inspect multiform contract selection')
  const applications = (applicationsResult.data ?? []) as Row[]
  if (!applications.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The expert must prepare a bank application before saving this form',
    })
  }
  const ids = applications.map(row => String(row.submission_id))
  const submissionsResult = await backend
    .from('crm_item_submissions')
    .select('id, status_code')
    .eq('organization_id', organizationId)
    .in('id', ids)
  throwPortalDbError(submissionsResult.error, 'could not inspect multiform submission states')
  const statusById = new Map<string, string>(
    (submissionsResult.data ?? []).map((row: Row): [string, string] => [
      String(row.id), String(row.status_code),
    ]),
  )
  const signedId = contractResult.data?.application_id
    ? String(contractResult.data.application_id)
    : ''
  const selected = signedId
    ? applications.filter(row => String(row.submission_id) === signedId)
    : applications.filter(row => activeApplicationStatuses.has(
        statusById.get(String(row.submission_id)) ?? '',
      ))
  if (!selected.length) {
    throw createError({ statusCode: 409, statusMessage: 'No active bank application' })
  }
  const offerIds = selected.map(row => String(row.offer_id))
  const offersResult = await backend
    .from('crm_case_offer_snapshots')
    .select('id, catalog_snapshot')
    .eq('organization_id', organizationId)
    .eq('case_id', caseId)
    .in('id', offerIds)
  throwPortalDbError(offersResult.error, 'could not inspect multiform offer configuration')
  const offerById = new Map<string, Row>(
    (offersResult.data ?? []).map((row: Row): [string, Row] => [String(row.id), row]),
  )
  const templateIds = [...new Set(selected.flatMap((application) => {
    const version = asRecord(asRecord(offerById.get(String(application.offer_id))?.catalog_snapshot).version)
    const configured = Array.isArray(version.multiform_template_ids)
      ? version.multiform_template_ids
      : version.multiform_template_ids ? [version.multiform_template_ids] : []
    const requirements = Array.isArray(version.document_requirements)
      ? version.document_requirements
      : []
    return [...configured, ...requirements.map(entry => asRecord(entry).templateId)]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  }))]
  return createHash('sha256').update(JSON.stringify({
    applicationIds: selected.map(row => String(row.submission_id)).sort(),
    offerIds: offerIds.sort(),
    templateIds: templateIds.sort(),
  })).digest('hex')
}

const draftSelect = `
  organization_id,
  case_id,
  selection_fingerprint,
  revision,
  active_step,
  intake_answers,
  form_values,
  collection_counts,
  selected_document_ids,
  client_portal_step,
  client_portal_completed_at,
  updated_at
`

export async function loadPortalMultiform(event: H3Event, caseId: string) {
  const access = await requirePortalCaseAccess(event, caseId)
  const unlocked = access.grant.multiformEnabled && access.link.person.role === 'primary'
  if (!unlocked) {
    return { access, data: { access: 'locked' as const, grant: publicGrant(access.grant), draft: null } }
  }
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_case_multiform_drafts')
    .select(draftSelect)
    .eq('organization_id', access.grant.organizationId)
    .eq('case_id', access.grant.caseId)
    .maybeSingle()
  throwPortalDbError(result.error, 'could not load client multiform draft')
  return {
    access,
    data: {
      access: 'unlocked' as const,
      grant: publicGrant(access.grant),
      draft: publicDraft(result.data, access.grant.clientId) ?? {
        answers: emptyAnswers(),
        activeStep: 1,
        revision: 0,
        updatedAt: null,
        completedAt: null,
      },
    },
  }
}

export async function savePortalMultiform(
  event: H3Event,
  caseId: string,
  bodyInput: unknown,
) {
  const { access, data } = await loadPortalMultiform(event, caseId)
  if (data.access !== 'unlocked') {
    throw createError({ statusCode: 403, statusMessage: 'Multiform is not shared' })
  }
  const body = asRecord(bodyInput)
  exactKeys(body, ['answers', 'step', 'activeStep', 'completed', 'revision'])
  const answers = normalizeAnswers(body.answers)
  const stepValue = body.step ?? body.activeStep
  if (!Number.isInteger(stepValue) || Number(stepValue) < 1 || Number(stepValue) > 3) {
    throw createError({ statusCode: 400, statusMessage: 'step must be between 1 and 3' })
  }
  if (body.completed !== undefined && typeof body.completed !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'completed must be a boolean' })
  }
  if (Buffer.byteLength(JSON.stringify(answers), 'utf8') > 32 * 1024) {
    throw createError({ statusCode: 413, statusMessage: 'Multiform answers are too large' })
  }

  const backend = serverDataBackend(event) as any
  const currentResult = await backend
    .from('crm_case_multiform_drafts')
    .select(draftSelect)
    .eq('organization_id', access.grant.organizationId)
    .eq('case_id', access.grant.caseId)
    .maybeSingle()
  throwPortalDbError(currentResult.error, 'could not reload client multiform draft')
  const current = currentResult.data as Row | null
  if (
    !Number.isSafeInteger(body.revision)
    || Number(body.revision) < 0
    || Number(body.revision) !== Number(current?.revision ?? 0)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'The form changed; reload it and try again' })
  }
  const fingerprint = await selectionFingerprint(
    backend,
    access.grant.organizationId,
    access.grant.caseId,
  )
  const existingIntake = asRecord(current?.intake_answers)
  const intakeAnswers = {
    ...existingIntake,
    applicants: {
      ...asRecord(existingIntake.applicants),
      [access.grant.clientId]: answers.applicant,
    },
    case: answers.case,
  }
  const now = new Date().toISOString()
  const fingerprintChanged = current
    && String(current.selection_fingerprint) !== fingerprint
  if (fingerprintChanged) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The selected bank applications changed; ask the expert to review the form',
    })
  }
  const values = {
    selection_fingerprint: fingerprint,
    active_step: body.completed === true
      ? Math.max(2, Number(current?.active_step ?? 1))
      : Number(current?.active_step ?? 1),
    intake_answers: intakeAnswers,
    form_values: asRecord(current?.form_values),
    collection_counts: asRecord(current?.collection_counts),
    selected_document_ids: Array.isArray(current?.selected_document_ids)
      ? current.selected_document_ids
      : [],
    updated_by_user_id: null,
    updated_by_client_person_id: access.link.clientPersonId,
    updated_by_auth_user_id: access.session.identity.userId,
    client_portal_step: Number(stepValue),
    client_portal_completed_at: body.completed === true
      ? String(current?.client_portal_completed_at ?? now)
      : null,
  }

  const saveResult = current
    ? await backend
        .from('crm_case_multiform_drafts')
        .update({ ...values, revision: Number(current.revision) + 1 })
        .eq('organization_id', access.grant.organizationId)
        .eq('case_id', access.grant.caseId)
        .eq('revision', current.revision)
        .select(draftSelect)
        .maybeSingle()
    : await backend
        .from('crm_case_multiform_drafts')
        .insert({
          organization_id: access.grant.organizationId,
          case_id: access.grant.caseId,
          revision: 1,
          ...values,
        })
        .select(draftSelect)
        .single()
  if (saveResult.error?.code === '23505' || current && !saveResult.data) {
    throw createError({ statusCode: 409, statusMessage: 'The form changed; reload it and try again' })
  }
  throwPortalDbError(saveResult.error, 'could not save client multiform draft')
  return publicDraft(saveResult.data, access.grant.clientId)
}
