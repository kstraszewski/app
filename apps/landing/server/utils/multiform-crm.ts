import { createHash } from 'node:crypto'
import { serverDataUser } from './data-api'
import { serverAccessTokenDataClient, serverUserDataClient } from './platform-data'
import {
  getTemplate,
  prepareBundle,
  templateApplicantCapacityIssues,
  type DocumentTemplate,
} from '@openexpert/multiform'
import { useRuntimeConfig } from '#imports'
import { createError, getHeader, setHeader, type H3Event } from 'h3'
import { parseMultiformServiceCredentials } from './multiform-service-auth'
import {
  resolveCrmApplicantProfile,
  type CrmApplicantPerson,
} from './multiform-applicants'
import { resolvePinnedMultiformTemplates } from './multiform-template-repository'

export const CRM_DOCUMENT_BUCKET = 'crm-case-documents'
export const MAX_CRM_ATTACHMENT_COUNT = 50
export const MAX_CRM_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_CRM_ATTACHMENTS_TOTAL_BYTES = 100 * 1024 * 1024

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const organizationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const sha256Pattern = /^[0-9a-f]{64}$/i
const allowedDocumentStatuses = new Set(['received', 'verified'])
const allowedAttachmentMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

type JsonRecord = Record<string, unknown>
type CrmDataClient = any
type CrmMultiformSignatureRole =
  | 'primary_applicant'
  | 'each_applicant'
  | 'spouse'
  | 'third_party'
  | 'bank_employee'

interface CrmMultiformRequirementReadiness {
  blocksSubmission?: boolean
  requiresExpertVerification?: boolean
  maxAgeDays?: number
  signatures?: CrmMultiformSignatureRole[]
  deliveryEvidenceRequired?: boolean
}

type DocumentSelectionCondition =
  | { op: 'selection_is', featureId: string, optionId: string }
  | { op: 'all' | 'any', conditions: DocumentSelectionCondition[] }
  | { op: 'not', condition: DocumentSelectionCondition }

export interface CrmMultiformSelection {
  organizationSlug: string
  caseId: string
  applicationIds: string[]
  offerIds: string[]
}

interface CrmMultiformBaseDocumentRequirement {
  code: string
  label: string
  category: string
  itemKind: 'client_document' | 'bank_document' | 'external_check' | 'manual_action'
  scope: 'case' | 'primary_applicant' | 'each_applicant'
  stage: 'analysis' | 'agreement' | 'disbursement' | 'tranche' | 'maintenance'
  applicability: 'always' | 'conditional' | 'optional' | 'case_requested'
  evidence: 'confirmed_bank_source' | 'inferred' | 'expert_default' | 'organization_custom'
  required: boolean
  multiple: boolean
  allowedMimeTypes: string[]
  templateId?: string
  notes?: string
  readiness?: CrmMultiformRequirementReadiness
}

export interface CrmMultiformDocumentRequirement extends CrmMultiformBaseDocumentRequirement {
  applicationIds: string[]
  offerIds: string[]
  bankNames: string[]
  applicationId?: string
  offerId?: string
  bankId?: string | null
  bankName?: string
  sourceTemplateIds?: string[]
}

export interface CrmMultiformDocumentRow {
  id: string
  client_id: string | null
  submission_id: string | null
  name: string
  document_type: string
  storage_bucket: string | null
  storage_path: string | null
  mime_type: string | null
  size_bytes: number | null
  sha256: string | null
  status_code: string
  received_at: string | null
  verified_at: string | null
  created_at: string
  metadata: unknown
}

export interface CrmMultiformPublicDocument {
  id: string
  client_id: string | null
  submission_id: string | null
  applicant_label: string | null
  name: string
  document_type: string
  mime_type: string | null
  size_bytes: number | null
  sha256: string | null
  status_code: string
  eligible: boolean
  blocker?: string
  received_at: string | null
  verified_at: string | null
  created_at: string
  readiness: {
    issuedAt: string | null
    validUntil: string | null
    deliveryEvidenceAt: string | null
  }
}

export interface CrmMultiformContext {
  session: {
    dataApi: CrmDataClient
    userId: string
    organizationId: string
    organizationName: string
    organizationSlug: string
  }
  case: {
    id: string
    title: string
  }
  applicationIds: string[]
  offerIds: string[]
  contractApplicationId: string | null
  applications: Array<{
    id: string
    applicationId: string
    offerId: string
    bankId: string | null
    bankName: string
    productId: string | null
    productName: string
    productVersionId: string | null
    versionKey: string | null
    propertyId: string | null
    slot: number
    statusCode: string
    templateIds: string[]
    isFinal: boolean
  }>
  offer: {
    id: string
    bankId: string | null
    bankName: string
    productId: string | null
    productName: string
    productVersionId: string | null
    versionKey: string | null
  }
  applicants: Array<{
    clientId: string
    label: string
    firstName: string | null
    lastName: string | null
    pesel: string | null
    email: string | null
    phone: string | null
    birthDate: string | null
    isPrimary: boolean
  }>
  templateIds: string[]
  documentRequirements: CrmMultiformDocumentRequirement[]
  documents: CrmMultiformDocumentRow[]
  publicDocuments: CrmMultiformPublicDocument[]
  validation: {
    valid: boolean
    blockers: string[]
    warnings: string[]
    templates: Array<{
      templateId: string
      found: boolean
      ready: boolean
      warnings: string[]
    }>
  }
  checklist: {
    readiness: {
      manifestVersion: '1.0'
      evaluatedAt: string
    }
    requirements: Array<CrmMultiformDocumentRequirement & {
      key: string
      ownerClientId: string | null
      ownerLabel: string | null
      documentIds: string[]
      fulfillment: 'attached' | 'generated' | 'missing' | 'manual' | 'conditional' | 'optional'
    }>
    missingAttachmentRequirementCodes: string[]
    missingAttachmentRequirementKeys: string[]
    manualRequirementCodes: string[]
    readyForAttachmentExport: boolean
  }
}

export interface DownloadedCrmAttachment {
  documentId: string
  submissionId: string | null
  fileName: string
  bytes: Uint8Array
  mimeType: string
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function nonEmptyString(value: unknown, maxLength = 1_000) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > maxLength) return undefined
  return text
}

function normalizedIsoTimestamp(value: unknown) {
  const text = nonEmptyString(value, 80)
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function firstMetadataTimestamp(source: JsonRecord, keys: readonly string[]) {
  for (const key of keys) {
    const timestamp = normalizedIsoTimestamp(source[key])
    if (timestamp) return timestamp
  }
  return null
}

function publicDocumentReadinessMetadata(metadata: unknown) {
  const source = asRecord(metadata)
  return {
    issuedAt: firstMetadataTimestamp(source, [
      'issuedAt',
      'issued_at',
      'documentDate',
      'document_date',
    ]),
    validUntil: firstMetadataTimestamp(source, [
      'validUntil',
      'valid_until',
      'expiresAt',
      'expires_at',
    ]),
    deliveryEvidenceAt: firstMetadataTimestamp(source, [
      'deliveryEvidenceAt',
      'delivery_evidence_at',
      'deliveredAt',
      'delivered_at',
    ]),
  }
}

function parseDocumentSelectionCondition(input: unknown): DocumentSelectionCondition | null {
  let remainingNodes = 100
  const identifierPattern = /^[a-zA-Z0-9._-]{1,120}$/

  const parse = (value: unknown, depth: number): DocumentSelectionCondition | null => {
    if (depth > 12 || remainingNodes-- <= 0) return null
    const source = asRecord(value)
    if (source.op === 'selection_is') {
      return typeof source.featureId === 'string'
        && identifierPattern.test(source.featureId)
        && typeof source.optionId === 'string'
        && identifierPattern.test(source.optionId)
        ? { op: 'selection_is', featureId: source.featureId, optionId: source.optionId }
        : null
    }
    if (source.op === 'not') {
      const condition = parse(source.condition, depth + 1)
      return condition ? { op: 'not', condition } : null
    }
    if (['all', 'and', 'any', 'or'].includes(String(source.op))) {
      if (!Array.isArray(source.conditions) || !source.conditions.length || source.conditions.length > 50) return null
      const conditions = source.conditions.map(condition => parse(condition, depth + 1))
      if (conditions.some(condition => condition === null)) return null
      return {
        op: source.op === 'all' || source.op === 'and' ? 'all' : 'any',
        conditions: conditions as DocumentSelectionCondition[],
      }
    }
    return null
  }

  return parse(input, 0)
}

function documentScenarioSelections(snapshot: unknown): Record<string, string> {
  const source = asRecord(asRecord(snapshot).selections)
  const selections = Object.create(null) as Record<string, string>
  const identifierPattern = /^[a-zA-Z0-9._-]{1,120}$/
  for (const [featureId, optionId] of Object.entries(source)) {
    if (identifierPattern.test(featureId) && typeof optionId === 'string' && identifierPattern.test(optionId)) {
      selections[featureId] = optionId
    }
  }
  return selections
}

function documentSelectionConditionMatches(
  condition: DocumentSelectionCondition,
  selections: Readonly<Record<string, string>>,
): boolean {
  if (condition.op === 'selection_is') {
    return Object.prototype.hasOwnProperty.call(selections, condition.featureId)
      && selections[condition.featureId] === condition.optionId
  }
  if (condition.op === 'not') return !documentSelectionConditionMatches(condition.condition, selections)
  if (condition.op === 'all') {
    return condition.conditions.every(item => documentSelectionConditionMatches(item, selections))
  }
  return condition.conditions.some(item => documentSelectionConditionMatches(item, selections))
}

function stringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => {
    const text = nonEmptyString(item, maxLength)
    return text ? [text] : []
  }))].slice(0, maxItems)
}

function invalidCatalogSnapshot(message: string): never {
  throw createError({
    statusCode: 409,
    statusMessage: `Snapshot oferty ma nieprawidłową konfigurację dokumentów: ${message}`,
  })
}

function parseRequirementReadiness(
  value: unknown,
  requirementCode: string,
): CrmMultiformRequirementReadiness | undefined {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidCatalogSnapshot(`wymaganie ${requirementCode} ma nieprawidłową konfigurację readiness.`)
  }
  const source = value as JsonRecord
  for (const field of [
    'blocksSubmission',
    'requiresExpertVerification',
    'deliveryEvidenceRequired',
  ] as const) {
    if (source[field] !== undefined && typeof source[field] !== 'boolean') {
      invalidCatalogSnapshot(`wymaganie ${requirementCode} ma nieprawidłowe pole readiness.${field}.`)
    }
  }
  if (
    source.maxAgeDays !== undefined
    && (!Number.isSafeInteger(source.maxAgeDays) || Number(source.maxAgeDays) < 1 || Number(source.maxAgeDays) > 3_650)
  ) {
    invalidCatalogSnapshot(`wymaganie ${requirementCode} ma nieprawidłowe pole readiness.maxAgeDays.`)
  }
  const allowedSignatureRoles = new Set<CrmMultiformSignatureRole>([
    'primary_applicant',
    'each_applicant',
    'spouse',
    'third_party',
    'bank_employee',
  ])
  let signatures: CrmMultiformSignatureRole[] | undefined
  if (source.signatures !== undefined) {
    if (!Array.isArray(source.signatures) || source.signatures.length > allowedSignatureRoles.size) {
      invalidCatalogSnapshot(`wymaganie ${requirementCode} ma nieprawidłową listę readiness.signatures.`)
    }
    signatures = source.signatures.filter((role): role is CrmMultiformSignatureRole => (
      typeof role === 'string' && allowedSignatureRoles.has(role as CrmMultiformSignatureRole)
    ))
    if (signatures.length !== source.signatures.length || new Set(signatures).size !== signatures.length) {
      invalidCatalogSnapshot(`wymaganie ${requirementCode} ma nieprawidłową listę readiness.signatures.`)
    }
  }

  return {
    ...(typeof source.blocksSubmission === 'boolean'
      ? { blocksSubmission: source.blocksSubmission }
      : {}),
    ...(typeof source.requiresExpertVerification === 'boolean'
      ? { requiresExpertVerification: source.requiresExpertVerification }
      : {}),
    ...(typeof source.maxAgeDays === 'number' ? { maxAgeDays: source.maxAgeDays } : {}),
    ...(signatures ? { signatures } : {}),
    ...(typeof source.deliveryEvidenceRequired === 'boolean'
      ? { deliveryEvidenceRequired: source.deliveryEvidenceRequired }
      : {}),
  }
}

function parseTemplateIds(value: unknown) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) invalidCatalogSnapshot('multiform_template_ids nie jest listą.')
  if (value.length > 50) invalidCatalogSnapshot('multiform_template_ids przekracza limit 50 pozycji.')

  const templateIds: string[] = []
  const usedTemplateIds = new Set<string>()
  for (const item of value) {
    const templateId = nonEmptyString(item, 120)
    if (!templateId) invalidCatalogSnapshot('multiform_template_ids zawiera nieprawidłową wartość.')
    if (usedTemplateIds.has(templateId)) invalidCatalogSnapshot(`template ${templateId} występuje więcej niż raz.`)
    usedTemplateIds.add(templateId)
    templateIds.push(templateId)
  }
  return templateIds
}

function requiredSelectionText(value: unknown, field: keyof CrmMultiformSelection) {
  const text = nonEmptyString(value, 120)
  if (!text) {
    throw createError({ statusCode: 400, statusMessage: `Brak parametru ${field}.` })
  }
  return text
}

function requiredSelectionIds(value: unknown, field: 'applicationIds' | 'offerIds') {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const ids = source.map(item => nonEmptyString(item, 120))
  if (
    ids.length < 1
    || ids.length > 3
    || ids.some(id => !id || !uuidPattern.test(id))
    || new Set(ids).size !== ids.length
  ) {
    throw createError({ statusCode: 400, statusMessage: `Parametr ${field} musi zawierać od 1 do 3 unikalnych UUID.` })
  }
  return ids as string[]
}

export function parseCrmMultiformSelection(value: unknown): CrmMultiformSelection {
  const source = asRecord(value)
  const organizationSlug = requiredSelectionText(source.organizationSlug, 'organizationSlug')
  const caseId = requiredSelectionText(source.caseId, 'caseId')
  const applicationIds = requiredSelectionIds(source.applicationIds, 'applicationIds')
  const offerIds = requiredSelectionIds(source.offerIds, 'offerIds')

  if (
    !organizationSlugPattern.test(organizationSlug)
    || !uuidPattern.test(caseId)
    || applicationIds.length !== offerIds.length
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Kontekst sprawy CRM jest nieprawidłowy.' })
  }

  return { organizationSlug, caseId, applicationIds, offerIds }
}

function parseDocumentRequirements(
  value: unknown,
  scenarioSnapshot: unknown,
): CrmMultiformBaseDocumentRequirement[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) invalidCatalogSnapshot('document_requirements nie jest listą.')
  if (value.length > 100) invalidCatalogSnapshot('document_requirements przekracza limit 100 pozycji.')

  const requirements: CrmMultiformBaseDocumentRequirement[] = []
  const usedCodes = new Set<string>()
  const selections = documentScenarioSelections(scenarioSnapshot)
  for (const item of value) {
    const source = asRecord(item)
    const code = nonEmptyString(source.code, 100)
    const label = nonEmptyString(source.label, 200)
    if (!code || !label) invalidCatalogSnapshot('wymaganie nie ma poprawnego kodu lub etykiety.')
    if (usedCodes.has(code)) invalidCatalogSnapshot(`kod wymagania ${code} występuje więcej niż raz.`)

    const itemKind = nonEmptyString(source.itemKind, 40)
    const scope = nonEmptyString(source.scope, 40)
    const stage = nonEmptyString(source.stage, 40)
    const applicability = nonEmptyString(source.applicability, 40)
    const evidence = nonEmptyString(source.evidence, 40)
    if (
      !['client_document', 'bank_document', 'external_check', 'manual_action'].includes(itemKind ?? '')
      || !['case', 'primary_applicant', 'each_applicant'].includes(scope ?? '')
      || !['analysis', 'agreement', 'disbursement', 'tranche', 'maintenance'].includes(stage ?? '')
      || !['always', 'conditional', 'optional', 'case_requested'].includes(applicability ?? '')
      || !['confirmed_bank_source', 'inferred', 'expert_default', 'organization_custom'].includes(evidence ?? '')
      || typeof source.required !== 'boolean'
      || typeof source.multiple !== 'boolean'
    ) invalidCatalogSnapshot(`wymaganie ${code} ma nieprawidłowy typ, zakres albo status.`)

    if (!Array.isArray(source.allowedMimeTypes) || source.allowedMimeTypes.length > 3) {
      invalidCatalogSnapshot(`wymaganie ${code} ma nieprawidłową listę typów MIME.`)
    }
    const allowedMimeTypes = stringList(source.allowedMimeTypes, 3, 100)
    if (
      allowedMimeTypes.length !== source.allowedMimeTypes.length
      || allowedMimeTypes.some(mimeType => !allowedAttachmentMimeTypes.has(mimeType))
    ) invalidCatalogSnapshot(`wymaganie ${code} zawiera niedozwolony albo powtórzony typ MIME.`)
    const templateId = nonEmptyString(source.templateId, 120)
    const notes = nonEmptyString(source.notes, 1_000)
    const readiness = parseRequirementReadiness(source.readiness, code)
    usedCodes.add(code)
    const hasWhen = Object.prototype.hasOwnProperty.call(source, 'when') && source.when != null
    const when = hasWhen ? parseDocumentSelectionCondition(source.when) : null
    if (hasWhen && (!when || !documentSelectionConditionMatches(when, selections))) {
      continue
    }
    requirements.push({
      code,
      label,
      category: nonEmptyString(source.category, 80) ?? 'pozostale',
      itemKind: itemKind as CrmMultiformBaseDocumentRequirement['itemKind'],
      scope: scope as CrmMultiformBaseDocumentRequirement['scope'],
      stage: stage as CrmMultiformBaseDocumentRequirement['stage'],
      applicability: (applicability === 'conditional' && when
        ? 'always'
        : applicability) as CrmMultiformBaseDocumentRequirement['applicability'],
      evidence: evidence as CrmMultiformBaseDocumentRequirement['evidence'],
      required: source.required,
      multiple: source.multiple,
      allowedMimeTypes,
      ...(templateId ? { templateId } : {}),
      ...(notes ? { notes } : {}),
      ...(readiness ? { readiness } : {}),
    })
  }
  return requirements
}

interface RequirementApplicationSource {
  applicationId: string
  offerId: string
  bankId: string | null
  bankName: string
  templateIds: string[]
  requirements: CrmMultiformBaseDocumentRequirement[]
}

interface CrmCaseBankApplicationRow {
  submission_id: string
  case_item_id: string
  offer_id: string
  bank_id: string
  property_id: string | null
  slot: number
  scenario_snapshot: unknown
}

interface CrmOfferSnapshotRow {
  id: string
  case_id: string
  bank_id: string | null
  bank_name: string
  mortgage_product_id: string | null
  mortgage_product_version_id: string | null
  product_name: string
  version_key: string | null
  catalog_snapshot: unknown
  scenario_snapshot: unknown
}

interface CrmSubmissionRow {
  id: string
  status_code: string
}

const requirementScopeRank: Record<CrmMultiformBaseDocumentRequirement['scope'], number> = {
  case: 0,
  primary_applicant: 1,
  each_applicant: 2,
}

const requirementStageRank: Record<CrmMultiformBaseDocumentRequirement['stage'], number> = {
  analysis: 0,
  agreement: 1,
  disbursement: 2,
  tranche: 3,
  maintenance: 4,
}

const requirementApplicabilityRank: Record<CrmMultiformBaseDocumentRequirement['applicability'], number> = {
  optional: 0,
  conditional: 1,
  case_requested: 2,
  always: 3,
}

const requirementEvidenceRank: Record<CrmMultiformBaseDocumentRequirement['evidence'], number> = {
  inferred: 0,
  expert_default: 1,
  organization_custom: 2,
  confirmed_bank_source: 3,
}

function strongerValue<T extends string>(
  left: T,
  right: T,
  rank: Record<T, number>,
) {
  return rank[right] > rank[left] ? right : left
}

function earlierStage(
  left: CrmMultiformBaseDocumentRequirement['stage'],
  right: CrmMultiformBaseDocumentRequirement['stage'],
) {
  return requirementStageRank[right] < requirementStageRank[left] ? right : left
}

function requirementNotes(
  sources: ReadonlyArray<{ bankName: string, notes?: string }>,
) {
  const notes = [...new Set(sources.flatMap(source => source.notes
    ? [`${source.bankName}: ${source.notes}`]
    : []))]
  return notes.length ? notes.join('\n') : undefined
}

function mergeRequirementReadiness(
  left: CrmMultiformRequirementReadiness | undefined,
  right: CrmMultiformRequirementReadiness | undefined,
): CrmMultiformRequirementReadiness | undefined {
  if (!left && !right) return undefined
  const maxAgeDays = left?.maxAgeDays && right?.maxAgeDays
    ? Math.min(left.maxAgeDays, right.maxAgeDays)
    : left?.maxAgeDays ?? right?.maxAgeDays
  const signatures = [...new Set([
    ...(left?.signatures ?? []),
    ...(right?.signatures ?? []),
  ])]
  return {
    ...(left?.blocksSubmission === true || right?.blocksSubmission === true
      ? { blocksSubmission: true }
      : left?.blocksSubmission === false && right?.blocksSubmission === false
        ? { blocksSubmission: false }
        : {}),
    ...(left?.requiresExpertVerification === true || right?.requiresExpertVerification === true
      ? { requiresExpertVerification: true }
      : {}),
    ...(maxAgeDays ? { maxAgeDays } : {}),
    ...(signatures.length ? { signatures } : {}),
    ...(left?.deliveryEvidenceRequired === true || right?.deliveryEvidenceRequired === true
      ? { deliveryEvidenceRequired: true }
      : {}),
  }
}

/**
 * Client-supplied evidence is shared by all banks and therefore appears once.
 * Everything owned by a bank process remains scoped to its submission.
 */
export function aggregateCrmMultiformDocumentRequirements(
  sources: readonly RequirementApplicationSource[],
): CrmMultiformDocumentRequirement[] {
  const result: CrmMultiformDocumentRequirement[] = []
  const sharedClientRequirements = new Map<string, {
    requirement: CrmMultiformDocumentRequirement
    notes: Array<{ bankName: string, notes?: string }>
  }>()

  for (const source of sources) {
    for (const parsed of source.requirements) {
      if (parsed.itemKind !== 'client_document') {
        result.push({
          ...parsed,
          applicationIds: [source.applicationId],
          offerIds: [source.offerId],
          bankNames: [source.bankName],
          applicationId: source.applicationId,
          offerId: source.offerId,
          bankId: source.bankId,
          bankName: source.bankName,
          sourceTemplateIds: [...source.templateIds],
        })
        continue
      }

      const current = sharedClientRequirements.get(parsed.code)
      if (!current) {
        const notes = [{ bankName: source.bankName, notes: parsed.notes }]
        const requirement: CrmMultiformDocumentRequirement = {
          ...parsed,
          applicationIds: [source.applicationId],
          offerIds: [source.offerId],
          bankNames: [source.bankName],
          ...(requirementNotes(notes) ? { notes: requirementNotes(notes) } : {}),
        }
        sharedClientRequirements.set(parsed.code, { requirement, notes })
        result.push(requirement)
        continue
      }

      const requirement = current.requirement
      requirement.applicationIds.push(source.applicationId)
      requirement.offerIds.push(source.offerId)
      requirement.bankNames.push(source.bankName)
      requirement.required = requirement.required || parsed.required
      requirement.multiple = requirement.multiple && parsed.multiple
      requirement.allowedMimeTypes = requirement.allowedMimeTypes
        .filter(mimeType => parsed.allowedMimeTypes.includes(mimeType))
      requirement.scope = strongerValue(requirement.scope, parsed.scope, requirementScopeRank)
      requirement.stage = earlierStage(requirement.stage, parsed.stage)
      requirement.applicability = strongerValue(
        requirement.applicability,
        parsed.applicability,
        requirementApplicabilityRank,
      )
      requirement.evidence = strongerValue(requirement.evidence, parsed.evidence, requirementEvidenceRank)
      const readiness = mergeRequirementReadiness(requirement.readiness, parsed.readiness)
      if (readiness) requirement.readiness = readiness
      else delete requirement.readiness
      if (requirement.templateId !== parsed.templateId) delete requirement.templateId
      current.notes.push({ bankName: source.bankName, notes: parsed.notes })
      const notes = requirementNotes(current.notes)
      if (notes) requirement.notes = notes
      else delete requirement.notes
    }
  }

  return result
}

function requirementAcceptsAttachment(requirement: CrmMultiformBaseDocumentRequirement) {
  return requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
}

function documentBlocker(
  document: CrmMultiformDocumentRow,
  requirement: CrmMultiformDocumentRequirement | undefined,
  organizationId: string,
  caseId: string,
  applicants: ReadonlyArray<CrmMultiformContext['applicants'][number]>,
) {
  if (!requirement || !requirementAcceptsAttachment(requirement)) {
    return 'Dokument nie odpowiada wymaganiu załącznika aktywnych wniosków.'
  }
  if (requirement.itemKind === 'client_document' && document.submission_id !== null) {
    return 'Wspólny dokument klienta jest przypisany do pojedynczego wniosku bankowego.'
  }
  if (
    requirement.itemKind === 'bank_document'
    && document.submission_id !== requirement.applicationId
  ) {
    return 'Dokument bankowy jest przypisany do innego wniosku bankowego.'
  }
  const expectedPathPrefix = `${organizationId}/${caseId}/`
  const objectName = document.storage_path?.startsWith(expectedPathPrefix)
    ? document.storage_path.slice(expectedPathPrefix.length)
    : ''
  if (
    document.storage_bucket !== CRM_DOCUMENT_BUCKET
    || !document.storage_path
    || !uuidPattern.test(objectName.replace(/\.(?:pdf|jpg|png)$/i, ''))
    || !/^[0-9a-f-]+\.(?:pdf|jpg|png)$/i.test(objectName)
  ) {
    return 'Dokument nie ma pliku w prywatnym magazynie sprawy.'
  }
  const primaryApplicantId = applicants.find(applicant => applicant.isPrimary)?.clientId
  const applicantIds = new Set(applicants.map(applicant => applicant.clientId))
  if (requirement.scope === 'primary_applicant' && document.client_id !== primaryApplicantId) {
    return 'Dokument nie jest przypisany do głównego wnioskodawcy.'
  }
  if (
    requirement.scope === 'each_applicant'
    && (!document.client_id || !applicantIds.has(document.client_id))
  ) {
    return 'Dokument nie jest przypisany do wnioskodawcy tej sprawy.'
  }
  if (!allowedDocumentStatuses.has(document.status_code)) {
    return 'Dokument nie ma statusu odebrany lub zweryfikowany.'
  }
  if (!document.mime_type || !allowedAttachmentMimeTypes.has(document.mime_type)) {
    return 'Dokument ma nieobsługiwany typ pliku.'
  }
  if (!requirement.allowedMimeTypes.includes(document.mime_type)) {
    return 'Typ pliku nie jest dozwolony dla tego wymagania.'
  }
  if (
    document.size_bytes === null
    || !Number.isSafeInteger(document.size_bytes)
    || document.size_bytes <= 0
    || document.size_bytes > MAX_CRM_ATTACHMENT_BYTES
  ) {
    return 'Rozmiar dokumentu jest nieprawidłowy lub przekracza 25 MB.'
  }
  if (!document.sha256 || !sha256Pattern.test(document.sha256)) {
    return 'Dokument nie ma poprawnej sumy kontrolnej SHA-256.'
  }
  return undefined
}

function buildTemplateValidation(
  templateIds: readonly string[],
  requirements: readonly CrmMultiformDocumentRequirement[],
  sources: readonly RequirementApplicationSource[],
  applicantCount: number,
  templateOverrides: readonly DocumentTemplate[] = [],
) {
  const overrideById = new Map(templateOverrides.map(template => [template.id, template]))
  const resolvedTemplates = templateIds.flatMap((templateId) => {
    const template = overrideById.get(templateId) ?? getTemplate(templateId)
    return template ? [template] : []
  })
  const templates = templateIds.map((templateId) => {
    const template = overrideById.get(templateId) ?? getTemplate(templateId)
    if (!template) {
      return {
        templateId,
        found: false,
        ready: false,
        warnings: ['Template wskazany przez ofertę nie istnieje w rejestrze Multiform.'],
      }
    }
    const warnings = prepareBundle([templateId], templateOverrides).warnings.map(warning => warning.reason)
    return {
      templateId,
      found: true,
      ready: warnings.length === 0,
      warnings,
    }
  })
  const warnings = sources.flatMap(source => source.templateIds.length
    ? []
    : [
        `${source.bankName}: brak szablonu Multiwniosku. `
        + 'Ten wniosek nie zostanie wygenerowany automatycznie i wymaga obsługi ręcznej.',
      ])

  const blockers = [
    ...(templateIds.length === 0 ? ['Aktywne wnioski nie mają skonfigurowanych template’ów Multiform.'] : []),
    ...(templateIds.length > 50 ? ['Pakiet wniosków przekracza limit 50 template’ów Multiwniosku.'] : []),
    ...requirements.flatMap(requirement => (
      requirement.required
      && requirement.applicability === 'always'
      && requirement.itemKind === 'client_document'
      && requirement.allowedMimeTypes.length === 0
        ? [`${requirement.label}: banki nie mają wspólnego dozwolonego formatu załącznika.`]
        : []
    )),
    ...sources.flatMap(source => source.requirements.flatMap(requirement => (
      requirement.required
      && requirement.applicability === 'always'
      && requirement.itemKind === 'bank_document'
      && requirement.templateId
      && !source.templateIds.includes(requirement.templateId)
        ? [`${source.bankName} — ${requirement.label}: template ${requirement.templateId} nie należy do zestawu tego wniosku.`]
        : []
    ))),
    ...templates.flatMap(template => template.ready
      ? []
      : template.warnings.map(warning => `${template.templateId}: ${warning}`)),
    ...templateApplicantCapacityIssues(resolvedTemplates, applicantCount).map(issue => (
      `${issue.templateLabel} obsługuje maksymalnie ${issue.supportedCount} `
      + `wnioskodawców, a sprawa zawiera ${issue.requestedCount}.`
    )),
  ]
  return { valid: blockers.length === 0, blockers, warnings, templates }
}

function buildChecklist(
  requirements: readonly CrmMultiformDocumentRequirement[],
  documents: readonly CrmMultiformDocumentRow[],
  publicDocuments: readonly CrmMultiformPublicDocument[],
  applicants: ReadonlyArray<CrmMultiformContext['applicants'][number]>,
): CrmMultiformContext['checklist'] {
  const eligibleDocumentIds = new Set(
    publicDocuments.filter(document => document.eligible).map(document => document.id),
  )
  const primaryApplicant = applicants.find(applicant => applicant.isPrimary)
  const checklistRequirements = requirements.flatMap((requirement) => {
    const owners = requirement.scope === 'case'
      ? [{ clientId: null, label: null }]
      : requirement.scope === 'primary_applicant'
        ? [{
            clientId: primaryApplicant?.clientId ?? null,
            label: primaryApplicant?.label ?? 'Brak głównego wnioskodawcy',
          }]
        : applicants.length
          ? applicants.map(applicant => ({ clientId: applicant.clientId, label: applicant.label }))
          : [{ clientId: null, label: 'Brak wnioskodawcy' }]

    return owners.map((owner) => {
      const documentIds = documents
        .filter(document => (
          document.document_type === requirement.code
          && (
            (requirement.itemKind === 'client_document' && document.submission_id === null)
            || (
              requirement.itemKind === 'bank_document'
              && document.submission_id === requirement.applicationId
            )
          )
          && (
            requirement.scope === 'case'
            || Boolean(owner.clientId && document.client_id === owner.clientId)
          )
          && eligibleDocumentIds.has(document.id)
        ))
        .map(document => document.id)
      const generated = requirement.itemKind === 'bank_document'
        && Boolean(
          requirement.templateId
          && requirement.sourceTemplateIds?.includes(requirement.templateId),
        )
      const fulfillment = documentIds.length > 0
        ? 'attached' as const
        : generated
          ? 'generated' as const
          : ['conditional', 'case_requested'].includes(requirement.applicability)
            ? 'conditional' as const
            : !requirement.required || requirement.applicability === 'optional'
              ? 'optional' as const
              : requirementAcceptsAttachment(requirement)
                ? 'missing' as const
                : 'manual' as const
      return {
        ...requirement,
        key: `${requirement.applicationId ? `${requirement.applicationId}:` : ''}${requirement.code}:${owner.clientId ?? 'case'}`,
        ownerClientId: owner.clientId,
        ownerLabel: owner.label,
        documentIds,
        fulfillment,
      }
    })
  })
  const missingAttachmentRequirementCodes = checklistRequirements
    .filter(requirement => requirement.fulfillment === 'missing')
    .map(requirement => requirement.code)
  const missingAttachmentRequirementKeys = checklistRequirements
    .filter(requirement => requirement.fulfillment === 'missing')
    .map(requirement => requirement.key)
  const manualRequirementCodes = checklistRequirements
    .filter(requirement => requirement.fulfillment === 'manual')
    .map(requirement => requirement.code)
  return {
    readiness: {
      manifestVersion: '1.0',
      evaluatedAt: new Date().toISOString(),
    },
    requirements: checklistRequirements,
    missingAttachmentRequirementCodes,
    missingAttachmentRequirementKeys,
    manualRequirementCodes,
    readyForAttachmentExport: missingAttachmentRequirementCodes.length === 0,
  }
}

function throwDatabaseError(error: { message?: string } | null | undefined) {
  if (!error) return
  console.error('[multiform-crm] database query failed')
  throw createError({ statusCode: 500, statusMessage: 'Nie udało się pobrać kontekstu sprawy CRM.' })
}

const activeApplicationStatuses = new Set([
  'draft',
  'wyslane',
  'w_analizie',
  'braki',
  'zaakceptowane',
])

function sameOrderedStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export async function loadCrmMultiformContext(
  event: H3Event,
  input: CrmMultiformSelection,
): Promise<CrmMultiformContext> {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const dataApiConfig = useRuntimeConfig(event).dataApi as {
    url?: string
    jwt?: { audience?: string, issuer?: string, privateKey?: string }
  }
  if (
    !dataApiConfig.url
    || !dataApiConfig.jwt?.audience
    || !dataApiConfig.jwt.issuer
    || !dataApiConfig.jwt.privateKey
  ) {
    throw createError({ statusCode: 503, statusMessage: 'Data API nie jest skonfigurowane.' })
  }

  const claims = await serverDataUser(event)
  const serviceCredentials = claims?.sub
    ? null
    : parseMultiformServiceCredentials(getHeader(event, 'authorization') ?? '')
  const userId = typeof claims?.sub === 'string'
    ? claims.sub
    : serviceCredentials?.userId ?? null
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'Zaloguj się w CRM, aby otworzyć sprawę.' })

  const dataApi = (serviceCredentials
    ? serverAccessTokenDataClient(event, serviceCredentials.token)
    : serverUserDataClient(event, userId)) as CrmDataClient
  if (serviceCredentials) {
    const { data: profile, error: profileError } = await dataApi
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (profileError || !profile) {
      throw createError({ statusCode: 401, statusMessage: 'Zaloguj się w CRM, aby otworzyć sprawę.' })
    }
  }
  const { data: organization, error: organizationError } = await dataApi
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', input.organizationSlug)
    .maybeSingle()
  if (organizationError || !organization) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono organizacji CRM.' })
  }

  const { data: membership, error: membershipError } = await dataApi
    .from('organization_memberships')
    .select('role')
    .eq('organization_id', organization.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (membershipError || !membership) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono organizacji CRM.' })
  }

  const [caseResult, applicationsResult, contractResult, caseClientsResult] = await Promise.all([
    dataApi
      .from('crm_cases')
      .select('id, title')
      .eq('organization_id', organization.id)
      .eq('id', input.caseId)
      .maybeSingle(),
    dataApi
      .from('crm_case_bank_applications')
      .select('submission_id, case_item_id, offer_id, bank_id, property_id, slot, scenario_snapshot')
      .eq('organization_id', organization.id)
      .eq('case_id', input.caseId)
      .order('slot', { ascending: true }),
    dataApi
      .from('crm_case_contract_selections')
      .select('application_id')
      .eq('organization_id', organization.id)
      .eq('case_id', input.caseId)
      .maybeSingle(),
    dataApi
      .from('crm_case_clients')
      .select('client_id, is_primary, created_at')
      .eq('organization_id', organization.id)
      .eq('case_id', input.caseId)
      .order('is_primary', { ascending: false })
      .order('created_at'),
  ])
  throwDatabaseError(caseResult.error)
  throwDatabaseError(applicationsResult.error)
  throwDatabaseError(contractResult.error)
  throwDatabaseError(caseClientsResult.error)
  if (!caseResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono wybranej sprawy.' })
  }

  const allApplications = (applicationsResult.data ?? []) as CrmCaseBankApplicationRow[]
  if (allApplications.length > 3) {
    throw createError({ statusCode: 500, statusMessage: 'Sprawa ma więcej niż trzy wnioski bankowe.' })
  }
  if (!allApplications.length) {
    throw createError({ statusCode: 409, statusMessage: 'Sprawa nie ma wniosków bankowych.' })
  }

  const allApplicationIds = allApplications.map(application => String(application.submission_id))
  const { data: submissions, error: submissionsError } = await dataApi
    .from('crm_item_submissions')
    .select('id, status_code')
    .eq('organization_id', organization.id)
    .in('id', allApplicationIds)
  throwDatabaseError(submissionsError)
  const statusByApplicationId = new Map(
    ((submissions ?? []) as CrmSubmissionRow[])
      .map(submission => [String(submission.id), String(submission.status_code)]),
  )
  if (statusByApplicationId.size !== allApplications.length) {
    throw createError({ statusCode: 500, statusMessage: 'Co najmniej jeden wniosek bankowy nie ma rekordu procesu.' })
  }

  const signedApplicationId = nonEmptyString(contractResult.data?.application_id, 120)
  const selectedApplications = signedApplicationId
    ? allApplications.filter(application => String(application.submission_id) === signedApplicationId)
    : allApplications.filter(application => activeApplicationStatuses.has(
        statusByApplicationId.get(String(application.submission_id)) ?? '',
      ))
  if (signedApplicationId && selectedApplications.length !== 1) {
    throw createError({ statusCode: 409, statusMessage: 'Podpisana umowa nie wskazuje wniosku bankowego tej sprawy.' })
  }
  if (!selectedApplications.length) {
    throw createError({ statusCode: 409, statusMessage: 'Sprawa nie ma aktywnych wniosków do przygotowania.' })
  }
  const currentApplicationIds = selectedApplications.map(application => String(application.submission_id))
  const currentOfferIds = selectedApplications.map(application => String(application.offer_id))
  if (
    !sameOrderedStrings(input.applicationIds, currentApplicationIds)
    || !sameOrderedStrings(input.offerIds, currentOfferIds)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Zestaw aktywnych wniosków bankowych zmienił się. Odśwież kontekst sprawy.',
    })
  }

  const { data: offers, error: offersError } = await dataApi
    .from('crm_case_offer_snapshots')
    .select('id, case_id, bank_id, bank_name, mortgage_product_id, mortgage_product_version_id, product_name, version_key, catalog_snapshot, scenario_snapshot')
    .eq('organization_id', organization.id)
    .eq('case_id', input.caseId)
    .in('id', currentOfferIds)
  throwDatabaseError(offersError)
  const offerById = new Map(
    ((offers ?? []) as CrmOfferSnapshotRow[]).map(offer => [String(offer.id), offer]),
  )
  if (offerById.size !== selectedApplications.length) {
    throw createError({ statusCode: 409, statusMessage: 'Co najmniej jedna oferta wniosku nie istnieje już w tej sprawie.' })
  }

  const requirementSources: RequirementApplicationSource[] = selectedApplications.map((application) => {
    const applicationId = String(application.submission_id)
    const offerId = String(application.offer_id)
    const offer = offerById.get(offerId)
    if (!offer || String(offer.bank_id ?? '') !== String(application.bank_id ?? '')) {
      throw createError({ statusCode: 409, statusMessage: 'Wniosek bankowy nie odpowiada zapisanej ofercie.' })
    }
    const version = asRecord(asRecord(offer.catalog_snapshot).version)
    const requirementTemplateIds = Array.isArray(version.document_requirements)
      ? version.document_requirements.flatMap((entry) => {
          const templateId = nonEmptyString(asRecord(entry).templateId, 120)
          return templateId ? [templateId] : []
        })
      : []
    return {
      applicationId,
      offerId,
      bankId: offer.bank_id ? String(offer.bank_id) : null,
      bankName: String(offer.bank_name),
      templateIds: [...new Set([
        ...parseTemplateIds(version.multiform_template_ids),
        ...requirementTemplateIds,
      ])],
      requirements: parseDocumentRequirements(
        version.document_requirements,
        application.scenario_snapshot ?? offer.scenario_snapshot,
      ),
    }
  })
  const templateIds = [...new Set(requirementSources.flatMap(source => source.templateIds))]
  const documentRequirements = aggregateCrmMultiformDocumentRequirements(requirementSources)

  const clientAttachmentRequirementCodes = [...new Set(documentRequirements
    .filter(requirement => requirement.itemKind === 'client_document' && requirementAcceptsAttachment(requirement))
    .map(requirement => requirement.code))]
  const bankAttachmentRequirementCodes = [...new Set(documentRequirements
    .filter(requirement => requirement.itemKind === 'bank_document' && requirementAcceptsAttachment(requirement))
    .map(requirement => requirement.code))]
  const caseClientLinks = (caseClientsResult.data ?? []) as Array<{
    client_id: string
    is_primary: boolean
  }>
  const clientIds = caseClientLinks.map(link => String(link.client_id))

  const documentSelect = 'id, client_id, submission_id, name, document_type, storage_bucket, storage_path, mime_type, size_bytes, sha256, status_code, received_at, verified_at, created_at, metadata'
  const [clientDocumentsResult, bankDocumentsResult, clientsResult, peopleResult] = await Promise.all([
    clientAttachmentRequirementCodes.length
      ? dataApi
        .from('crm_documents')
        .select(documentSelect)
        .eq('organization_id', organization.id)
        .eq('case_id', input.caseId)
        .eq('storage_bucket', CRM_DOCUMENT_BUCKET)
        .is('submission_id', null)
        .in('document_type', clientAttachmentRequirementCodes)
        .order('id')
        .limit(MAX_CRM_ATTACHMENT_COUNT + 1)
      : Promise.resolve({ data: [], error: null }),
    bankAttachmentRequirementCodes.length
      ? dataApi
        .from('crm_documents')
        .select(documentSelect)
        .eq('organization_id', organization.id)
        .eq('case_id', input.caseId)
        .eq('storage_bucket', CRM_DOCUMENT_BUCKET)
        .in('submission_id', currentApplicationIds)
        .in('document_type', bankAttachmentRequirementCodes)
        .order('id')
        .limit(MAX_CRM_ATTACHMENT_COUNT + 1)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? dataApi
          .from('crm_clients')
          .select('id, display_name')
          .eq('organization_id', organization.id)
          .in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? dataApi
          .from('crm_client_people')
          .select('client_id, display_name, first_name, last_name, pesel, email, phone, date_of_birth, role, created_at')
          .eq('organization_id', organization.id)
          .in('client_id', clientIds)
          .order('created_at')
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDatabaseError(clientDocumentsResult.error)
  throwDatabaseError(bankDocumentsResult.error)
  throwDatabaseError(clientsResult.error)
  throwDatabaseError(peopleResult.error)

  const documents = [...new Map([
    ...(clientDocumentsResult.data ?? []),
    ...(bankDocumentsResult.data ?? []),
  ].map(document => [String(document.id), document])).values()]
    .sort((left, right) => String(left.id).localeCompare(String(right.id))) as CrmMultiformDocumentRow[]
  if (documents.length > MAX_CRM_ATTACHMENT_COUNT) {
    throw createError({
      statusCode: 409,
      statusMessage: `Sprawa ma więcej niż ${MAX_CRM_ATTACHMENT_COUNT} dokumentów pasujących do checklisty. Usuń nadmiarowe pliki przed eksportem.`,
    })
  }
  const clientById = new Map(
    ((clientsResult.data ?? []) as Array<{ id: string, display_name: string }>)
      .map(client => [String(client.id), client]),
  )
  const peopleByClientId = new Map<string, CrmApplicantPerson[]>()
  for (const person of (peopleResult.data ?? []) as CrmApplicantPerson[]) {
    const clientId = String(person.client_id)
    peopleByClientId.set(clientId, [...(peopleByClientId.get(clientId) ?? []), person])
  }
  const applicants = caseClientLinks.map((link, index) => {
    const clientId = String(link.client_id)
    const profile = resolveCrmApplicantProfile(
      clientById.get(clientId),
      peopleByClientId.get(clientId) ?? [],
      `${link.is_primary ? 'Główny wnioskodawca' : 'Wnioskodawca'} ${index + 1}`,
    )
    return {
      clientId,
      label: profile.label,
      firstName: profile.firstName,
      lastName: profile.lastName,
      pesel: profile.pesel,
      email: profile.email,
      phone: profile.phone,
      birthDate: profile.birthDate,
      isPrimary: Boolean(link.is_primary),
    }
  })
  const applicantLabelByClientId = new Map(
    applicants.map(applicant => [applicant.clientId, applicant.label]),
  )
  const requirementForDocument = (document: CrmMultiformDocumentRow) => document.submission_id
    ? documentRequirements.find(requirement => (
        requirement.itemKind === 'bank_document'
        && requirement.applicationId === document.submission_id
        && requirement.code === document.document_type
      ))
    : documentRequirements.find(requirement => (
        requirement.itemKind === 'client_document'
        && requirement.code === document.document_type
      ))
  const publicDocuments = documents.map((document): CrmMultiformPublicDocument => {
    const blocker = documentBlocker(
      document,
      requirementForDocument(document),
      String(organization.id),
      input.caseId,
      applicants,
    )
    return {
      id: document.id,
      client_id: document.client_id,
      submission_id: document.submission_id,
      applicant_label: document.client_id
        ? applicantLabelByClientId.get(document.client_id) ?? 'Wnioskodawca'
        : null,
      name: document.name,
      document_type: document.document_type,
      mime_type: document.mime_type,
      size_bytes: document.size_bytes,
      sha256: document.sha256,
      status_code: document.status_code,
      eligible: !blocker,
      received_at: document.received_at,
      verified_at: document.verified_at,
      created_at: document.created_at,
      readiness: publicDocumentReadinessMetadata(document.metadata),
      ...(blocker ? { blocker } : {}),
    }
  })
  const templateOverrides = await resolvePinnedMultiformTemplates(
    event,
    selectedApplications.map((application) => {
      const offer = offerById.get(String(application.offer_id))
      return {
        productVersionId: offer?.mortgage_product_version_id
          ? String(offer.mortgage_product_version_id)
          : null,
        templateIds: requirementSources.find(source => (
          source.applicationId === String(application.submission_id)
        ))?.templateIds ?? [],
      }
    }),
  )
  const validation = buildTemplateValidation(
    templateIds,
    documentRequirements,
    requirementSources,
    applicants.length,
    templateOverrides,
  )

  const applications = selectedApplications.map((application) => {
    const applicationId = String(application.submission_id)
    const offerId = String(application.offer_id)
    const offer = offerById.get(offerId)!
    return {
      id: applicationId,
      applicationId,
      offerId,
      bankId: offer.bank_id ? String(offer.bank_id) : null,
      bankName: String(offer.bank_name),
      productId: offer.mortgage_product_id ? String(offer.mortgage_product_id) : null,
      productName: String(offer.product_name),
      productVersionId: offer.mortgage_product_version_id
        ? String(offer.mortgage_product_version_id)
        : null,
      versionKey: offer.version_key ? String(offer.version_key) : null,
      propertyId: application.property_id ? String(application.property_id) : null,
      slot: Number(application.slot),
      statusCode: statusByApplicationId.get(applicationId)!,
      templateIds: requirementSources.find(source => source.applicationId === applicationId)?.templateIds ?? [],
      isFinal: applicationId === signedApplicationId,
    }
  })
  const firstApplication = applications[0]!

  return {
    session: {
      dataApi,
      userId,
      organizationId: String(organization.id),
      organizationName: String(organization.name),
      organizationSlug: String(organization.slug),
    },
    case: {
      id: String(caseResult.data.id),
      title: String(caseResult.data.title),
    },
    applicationIds: currentApplicationIds,
    offerIds: currentOfferIds,
    contractApplicationId: signedApplicationId ?? null,
    applications,
    offer: {
      id: firstApplication.offerId,
      bankId: firstApplication.bankId,
      bankName: firstApplication.bankName,
      productId: firstApplication.productId,
      productName: firstApplication.productName,
      productVersionId: firstApplication.productVersionId,
      versionKey: firstApplication.versionKey,
    },
    applicants,
    templateIds,
    documentRequirements,
    documents,
    publicDocuments,
    validation,
    checklist: buildChecklist(documentRequirements, documents, publicDocuments, applicants),
  }
}

function detectedMimeType(bytes: Uint8Array) {
  if (
    bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2D
  ) return 'application/pdf'
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47
    && bytes[4] === 0x0D
    && bytes[5] === 0x0A
    && bytes[6] === 0x1A
    && bytes[7] === 0x0A
  ) return 'image/png'
  return undefined
}

function attachmentExtension(mimeType: string) {
  if (mimeType === 'application/pdf') return '.pdf'
  if (mimeType === 'image/jpeg') return '.jpg'
  return '.png'
}

function fileNameWithCanonicalExtension(fileName: string, mimeType: string) {
  const withoutExtension = fileName.replace(/\.[^.]{1,12}$/u, '')
  return `${withoutExtension || 'zalacznik'}${attachmentExtension(mimeType)}`
}

export async function downloadSelectedCrmAttachments(
  context: CrmMultiformContext,
  documentIds: readonly string[],
): Promise<DownloadedCrmAttachment[]> {
  const uniqueDocumentIds = [...new Set(documentIds)]
  if (uniqueDocumentIds.length > MAX_CRM_ATTACHMENT_COUNT) {
    throw createError({ statusCode: 413, statusMessage: `Pakiet może zawierać maksymalnie ${MAX_CRM_ATTACHMENT_COUNT} załączników.` })
  }
  if (uniqueDocumentIds.some(documentId => !uuidPattern.test(documentId))) {
    throw createError({ statusCode: 400, statusMessage: 'Lista załączników CRM jest nieprawidłowa.' })
  }

  const publicDocumentById = new Map(context.publicDocuments.map(document => [document.id, document]))
  const documentById = new Map(context.documents.map(document => [document.id, document]))
  const selectedDocuments = uniqueDocumentIds.map((documentId) => {
    const publicDocument = publicDocumentById.get(documentId)
    const document = documentById.get(documentId)
    if (!document || !publicDocument?.eligible) {
      throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono wybranego załącznika w tej sprawie.' })
    }
    return document
  })

  const selectedIdSet = new Set(uniqueDocumentIds)
  const missingRequirements = context.checklist.requirements.filter(requirement => (
    requirement.required
    && requirementAcceptsAttachment(requirement)
    && requirement.applicability === 'always'
    && !requirement.documentIds.some(documentId => selectedIdSet.has(documentId))
  ))
  if (missingRequirements.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wybierz wszystkie wymagane załączniki dla tej oferty.',
      data: {
        missingDocumentRequirements: missingRequirements.map(requirement => ({
          code: requirement.code,
          label: requirement.label,
        })),
      },
    })
  }
  const overSelectedRequirements = context.checklist.requirements.filter(requirement => (
    requirementAcceptsAttachment(requirement)
    && !requirement.multiple
    && requirement.documentIds.filter(documentId => selectedIdSet.has(documentId)).length > 1
  ))
  if (overSelectedRequirements.length) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Dla tego wymagania można dołączyć tylko jeden dokument.',
      data: {
        documentRequirements: overSelectedRequirements.map(requirement => ({
          key: requirement.key,
          code: requirement.code,
          label: requirement.label,
        })),
      },
    })
  }

  const declaredTotal = selectedDocuments.reduce((total, document) => total + (document.size_bytes ?? 0), 0)
  if (declaredTotal > MAX_CRM_ATTACHMENTS_TOTAL_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Załączniki przekraczają łączny limit 100 MB.' })
  }

  let actualTotal = 0
  const attachments: DownloadedCrmAttachment[] = []
  for (const document of selectedDocuments) {
    const mimeType = document.mime_type!
    const { data, error } = await context.session.dataApi.storage
      .from(CRM_DOCUMENT_BUCKET)
      .download(document.storage_path!)
    if (error || !data) {
      throw createError({ statusCode: 404, statusMessage: 'Nie udało się pobrać załącznika ze sprawy CRM.' })
    }

    const bytes = new Uint8Array(await data.arrayBuffer())
    actualTotal += bytes.byteLength
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CRM_ATTACHMENT_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Załącznik jest pusty albo przekracza limit 25 MB.' })
    }
    if (actualTotal > MAX_CRM_ATTACHMENTS_TOTAL_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Załączniki przekraczają łączny limit 100 MB.' })
    }
    if (bytes.byteLength !== document.size_bytes) {
      throw createError({ statusCode: 409, statusMessage: 'Rozmiar załącznika nie zgadza się z rekordem CRM.' })
    }
    if (detectedMimeType(bytes) !== mimeType) {
      throw createError({ statusCode: 409, statusMessage: 'Typ załącznika nie zgadza się z jego zawartością.' })
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== document.sha256!.toLocaleLowerCase('en-US')) {
      throw createError({ statusCode: 409, statusMessage: 'Suma kontrolna załącznika nie zgadza się z rekordem CRM.' })
    }

    attachments.push({
      documentId: document.id,
      submissionId: document.submission_id,
      fileName: fileNameWithCanonicalExtension(document.name, mimeType),
      bytes,
      mimeType,
    })
  }
  return attachments
}
