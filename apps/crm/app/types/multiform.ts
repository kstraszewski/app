import type { TemplateFillMethod } from '@openexpert/multiform'
import type { MortgageApplicationStatus } from './cases'

export type MultiformFieldValue = string | number | boolean
export type MultiformFieldOption = string | { label: string, value: string }

export type MultiformFillMethod = TemplateFillMethod
export type MultiformFillMethodKind = TemplateFillMethod['kind']

export interface MultiformFieldCondition {
  canonicalKey: string
  equals: string | string[]
}

export interface MultiformCollectionFieldRef {
  key: string
  index: number
  displayIndex: number
  relativeKey: string
  label: string
}

export interface MultiformCollectionDefinition {
  key: string
  label: string
  itemLabel: string
  minItems: number
  maxItems: number
  requiredRelativeKeys: string[]
}

export interface MultiformFormField {
  key: string
  label: string
  question?: string
  helpText?: string
  type: string
  section: string
  required: boolean
  options?: MultiformFieldOption[]
  placeholder?: string
  description?: string
  semanticDescription?: string
  semanticRole?: string
  aiMappingHints?: {
    aliases: string[]
    exclude: string[]
  }
  collection?: MultiformCollectionFieldRef
  visibleWhen?: MultiformFieldCondition
  requiredWhen?: MultiformFieldCondition
  validation?: {
    pattern?: string
    maxLength?: number
    min?: number
    max?: number
    integer?: boolean
  }
}

export interface MultiformPreparedDocument {
  id?: string
  templateId?: string
  bank?: string
  name?: string
  fileName?: string
  fillMethod: MultiformFillMethod
}

export interface MultiformPrepareResponse {
  templateIds: string[]
  fields: MultiformFormField[]
  collections: MultiformCollectionDefinition[]
  documents: MultiformPreparedDocument[]
  warnings?: Array<{ templateId?: string, reason?: string }>
  summary: Record<string, unknown>
}

export interface MultiformContextDocument {
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
}

export interface MultiformContextRequirement {
  code: string
  label: string
  category: string
  itemKind: 'client_document' | 'bank_document' | 'external_check' | 'manual_action'
  scope: 'case' | 'primary_applicant' | 'each_applicant'
  stage: string
  applicability: string
  evidence: string
  required: boolean
  multiple: boolean
  allowedMimeTypes: string[]
  templateId?: string
  notes?: string
  applicationIds: string[]
  offerIds: string[]
  bankNames: string[]
  applicationId?: string
  offerId?: string
  bankId?: string | null
  bankName?: string
  key: string
  ownerClientId: string | null
  ownerLabel: string | null
  documentIds: string[]
  fulfillment: 'attached' | 'generated' | 'missing' | 'manual' | 'conditional' | 'optional'
}

export interface MultiformContextApplication {
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
  statusCode: MortgageApplicationStatus
  templateIds: string[]
  isFinal: boolean
}

export interface MultiformApplicationsValidation {
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

export interface MultiformCrmContext {
  organization: { slug: string, name: string }
  case: { id: string, title: string }
  applicants: Array<{
    clientId: string
    label: string
    pesel: string | null
    isPrimary: boolean
  }>
  applicationIds: string[]
  offerIds: string[]
  contractApplicationId: string | null
  applications: MultiformContextApplication[]
  offer: {
    id: string
    bankId: string | null
    bankName: string
    productId: string | null
    productName: string
    productVersionId: string | null
    versionKey: string | null
  }
  bank: { id: string | null, name: string }
  product: { id: string | null, versionId: string | null, versionKey: string | null, name: string }
  templateIds: string[]
  documentRequirements: Array<Omit<
    MultiformContextRequirement,
    'key' | 'ownerClientId' | 'ownerLabel' | 'documentIds' | 'fulfillment'
  >>
  documents: MultiformContextDocument[]
  checklist: {
    requirements: MultiformContextRequirement[]
    missingAttachmentRequirementCodes: string[]
    missingAttachmentRequirementKeys: string[]
    manualRequirementCodes: string[]
    readyForAttachmentExport: boolean
  }
  selectedOfferValidation: MultiformApplicationsValidation
  selectedApplicationsValidation: MultiformApplicationsValidation
}

export interface CaseMultiformDraft {
  organizationId: string
  caseId: string
  selectionFingerprint: string
  revision: number
  activeStep: number
  intakeAnswers: Record<string, unknown>
  formValues: Record<string, unknown>
  collectionCounts: Record<string, number>
  selectedDocumentIds: string[]
  updatedByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface CaseMultiformDraftResponse {
  selectionFingerprint: string
  draft: CaseMultiformDraft | null
}

export interface CaseMultiformDraftSaveResponse {
  draft: CaseMultiformDraft
}

export interface MultiformFlatGroup {
  kind: 'fields'
  id: string
  section: string
  fields: MultiformFormField[]
}

export interface MultiformRepeatableItem {
  index: number
  fields: MultiformFormField[]
}

export interface MultiformRepeatableGroup {
  kind: 'repeatable'
  id: string
  section: string
  collection: MultiformCollectionDefinition
  items: MultiformRepeatableItem[]
}

export type MultiformRenderGroup = MultiformFlatGroup | MultiformRepeatableGroup
