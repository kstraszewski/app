export type DocumentSelectionCondition =
  | { op: 'selection_is', featureId: string, optionId: string }
  | { op: 'all' | 'any', conditions: DocumentSelectionCondition[] }
  | { op: 'not', condition: DocumentSelectionCondition }

export const documentRequirementCategories = [
  'application',
  'identity',
  'income_employment',
  'income_business',
  'income_other',
  'liabilities',
  'transaction',
  'property_legal',
  'valuation',
  'construction_renovation',
  'refinance_discharge',
  'insurance_security',
  'disbursement',
  'disclosure_privacy',
  'other',
] as const

export const documentRequirementItemKinds = [
  'client_document',
  'bank_document',
  'external_check',
  'manual_action',
] as const

export const documentRequirementScopes = [
  'case',
  'primary_applicant',
  'each_applicant',
] as const

export const documentRequirementStages = [
  'analysis',
  'agreement',
  'disbursement',
  'tranche',
  'maintenance',
] as const

export const documentRequirementApplicabilities = [
  'always',
  'conditional',
  'optional',
  'case_requested',
] as const

export const documentRequirementEvidenceKinds = [
  'confirmed_bank_source',
  'inferred',
  'expert_default',
  'organization_custom',
] as const

export const documentRequirementAllowedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const

export type DocumentRequirementCategory = typeof documentRequirementCategories[number]
export type DocumentRequirementItemKind = typeof documentRequirementItemKinds[number]
export type DocumentRequirementScope = typeof documentRequirementScopes[number]
export type DocumentRequirementStage = typeof documentRequirementStages[number]
export type DocumentRequirementApplicability = typeof documentRequirementApplicabilities[number]
export type DocumentRequirementEvidence = typeof documentRequirementEvidenceKinds[number]
export type DocumentRequirementMimeType = typeof documentRequirementAllowedMimeTypes[number]

export interface DocumentRequirement {
  code: string
  label: string
  category: DocumentRequirementCategory
  itemKind: DocumentRequirementItemKind
  scope: DocumentRequirementScope
  stage: DocumentRequirementStage
  applicability: DocumentRequirementApplicability
  evidence: DocumentRequirementEvidence
  required: boolean
  multiple: boolean
  allowedMimeTypes: DocumentRequirementMimeType[]
  templateId?: string
  notes?: string
  when?: DocumentSelectionCondition
}

export interface DocumentRequirementValidationIssue {
  code: string
  path: string
  message: string
}

export interface DocumentRequirementValidationResult {
  valid: boolean
  value: DocumentRequirement | null
  issues: DocumentRequirementValidationIssue[]
}

type JsonRecord = Record<string, unknown>

const maxConditionDepth = 12
const maxConditionNodes = 100
const maxConditionGroupSize = 50
const selectionIdentifierPattern = /^[a-zA-Z0-9._-]{1,120}$/
const documentRequirementCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const documentRequirementCategorySet = new Set<string>(documentRequirementCategories)
const documentRequirementItemKindSet = new Set<string>(documentRequirementItemKinds)
const documentRequirementScopeSet = new Set<string>(documentRequirementScopes)
const documentRequirementStageSet = new Set<string>(documentRequirementStages)
const documentRequirementApplicabilitySet = new Set<string>(documentRequirementApplicabilities)
const documentRequirementEvidenceSet = new Set<string>(documentRequirementEvidenceKinds)
const documentRequirementAllowedMimeTypeSet = new Set<string>(documentRequirementAllowedMimeTypes)

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function selectionIdentifier(value: unknown): string | null {
  return typeof value === 'string' && selectionIdentifierPattern.test(value)
    ? value
    : null
}

/**
 * Normalizes the document-checklist subset of mortgage conditions. The offer
 * engine also supports numeric comparisons, but document requirements are
 * deliberately restricted to selected offer variants so a saved scenario is
 * sufficient to resolve them deterministically.
 */
export function parseDocumentSelectionCondition(input: unknown): DocumentSelectionCondition | null {
  let remainingNodes = maxConditionNodes

  const parse = (value: unknown, depth: number): DocumentSelectionCondition | null => {
    if (depth > maxConditionDepth || remainingNodes-- <= 0) return null
    const source = asRecord(value)
    if (!source || typeof source.op !== 'string') return null

    if (source.op === 'selection_is') {
      const featureId = selectionIdentifier(source.featureId)
      const optionId = selectionIdentifier(source.optionId)
      return featureId && optionId
        ? { op: 'selection_is', featureId, optionId }
        : null
    }

    if (source.op === 'not') {
      const condition = parse(source.condition, depth + 1)
      return condition ? { op: 'not', condition } : null
    }

    if (['all', 'and', 'any', 'or'].includes(source.op)) {
      if (
        !Array.isArray(source.conditions)
        || source.conditions.length === 0
        || source.conditions.length > maxConditionGroupSize
      ) return null

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

/**
 * Validates and normalizes the complete checklist contract persisted in offer
 * snapshots. This is the single acceptance boundary shared by publication and
 * runtime case-document handling, so an item cannot publish successfully and
 * then disappear from a case checklist.
 */
export function validateDocumentRequirement(input: unknown): DocumentRequirementValidationResult {
  const issues: DocumentRequirementValidationIssue[] = []
  const source = asRecord(input)
  if (!source) {
    return {
      valid: false,
      value: null,
      issues: [{
        code: 'invalid_document_requirement',
        path: '',
        message: 'A document requirement must be an object.',
      }],
    }
  }

  const addIssue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message })
  }
  const normalizedText = (value: unknown, path: string, maxLength: number): string | null => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
      addIssue(
        `invalid_document_${path.replace(/([A-Z])/g, '_$1').toLowerCase()}`,
        path,
        `Document ${path} must be a non-empty string of at most ${maxLength} characters.`,
      )
      return null
    }
    return value.trim()
  }
  const enumValue = <T extends string>(
    value: unknown,
    allowed: ReadonlySet<string>,
    path: string,
  ): T | null => {
    if (typeof value !== 'string' || !allowed.has(value)) {
      addIssue(
        `invalid_document_${path.replace(/([A-Z])/g, '_$1').toLowerCase()}`,
        path,
        `Document ${path} is not supported.`,
      )
      return null
    }
    return value as T
  }

  const code = normalizedText(source.code, 'code', 100)
  if (code && (typeof source.code !== 'string' || !documentRequirementCodePattern.test(source.code))) {
    addIssue(
      'invalid_document_code',
      'code',
      'Document code must use lowercase letters, numbers and single dot, dash or underscore separators.',
    )
  }
  const label = normalizedText(source.label, 'label', 240)
  const category = enumValue<DocumentRequirementCategory>(source.category, documentRequirementCategorySet, 'category')
  const itemKind = enumValue<DocumentRequirementItemKind>(source.itemKind, documentRequirementItemKindSet, 'itemKind')
  const scope = enumValue<DocumentRequirementScope>(source.scope, documentRequirementScopeSet, 'scope')
  const stage = enumValue<DocumentRequirementStage>(source.stage, documentRequirementStageSet, 'stage')
  const applicability = enumValue<DocumentRequirementApplicability>(source.applicability, documentRequirementApplicabilitySet, 'applicability')
  const evidence = enumValue<DocumentRequirementEvidence>(source.evidence, documentRequirementEvidenceSet, 'evidence')

  const required = typeof source.required === 'boolean' ? source.required : null
  if (required === null) {
    addIssue('invalid_document_required', 'required', 'Document required must be a boolean.')
  }
  const multiple = typeof source.multiple === 'boolean' ? source.multiple : null
  if (multiple === null) {
    addIssue('invalid_document_multiple', 'multiple', 'Document multiple must be a boolean.')
  }

  const allowedMimeTypes: DocumentRequirementMimeType[] = []
  if (!Array.isArray(source.allowedMimeTypes)) {
    addIssue(
      'invalid_document_allowed_mime_types',
      'allowedMimeTypes',
      'Document allowedMimeTypes must be an array.',
    )
  } else {
    const uniqueMimeTypes = new Set<DocumentRequirementMimeType>()
    for (const [index, rawMimeType] of source.allowedMimeTypes.entries()) {
      if (typeof rawMimeType !== 'string' || !documentRequirementAllowedMimeTypeSet.has(rawMimeType)) {
        addIssue(
          'invalid_document_mime_type',
          `allowedMimeTypes.${index}`,
          'Document MIME type must be application/pdf, image/jpeg or image/png.',
        )
        continue
      }
      uniqueMimeTypes.add(rawMimeType as DocumentRequirementMimeType)
    }
    allowedMimeTypes.push(...uniqueMimeTypes)
    if (allowedMimeTypes.length > documentRequirementAllowedMimeTypes.length) {
      addIssue(
        'too_many_document_mime_types',
        'allowedMimeTypes',
        `A document may define at most ${documentRequirementAllowedMimeTypes.length} MIME types.`,
      )
    }
  }

  let templateId: string | undefined
  if (source.templateId !== undefined) {
    templateId = normalizedText(source.templateId, 'templateId', 160) ?? undefined
  }
  let notes: string | undefined
  if (source.notes !== undefined) {
    notes = normalizedText(source.notes, 'notes', 2_000) ?? undefined
  }

  let when: DocumentSelectionCondition | undefined
  const hasWhen = Object.prototype.hasOwnProperty.call(source, 'when') && source.when != null
  if (hasWhen) {
    when = parseDocumentSelectionCondition(source.when) ?? undefined
    if (!when) {
      addIssue(
        'invalid_document_condition',
        'when',
        'A document condition must use selection_is, all/any or not.',
      )
    }
  }

  if (
    issues.length
    || !code
    || !label
    || !category
    || !itemKind
    || !scope
    || !stage
    || !applicability
    || !evidence
    || required === null
    || multiple === null
  ) {
    return { valid: false, value: null, issues }
  }

  return {
    valid: true,
    issues: [],
    value: {
      code,
      label,
      category,
      itemKind,
      scope,
      stage,
      applicability,
      evidence,
      required,
      multiple,
      allowedMimeTypes,
      ...(templateId === undefined ? {} : { templateId }),
      ...(notes === undefined ? {} : { notes }),
      ...(when ? { when } : {}),
    },
  }
}

export function parseDocumentRequirement(input: unknown): DocumentRequirement | null {
  return validateDocumentRequirement(input).value
}

export function documentScenarioSelections(scenarioSnapshot: unknown): Record<string, string> {
  const scenario = asRecord(scenarioSnapshot)
  const source = asRecord(scenario?.selections)
  if (!source) return {}

  const selections: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [featureId, optionId] of Object.entries(source)) {
    const normalizedFeatureId = selectionIdentifier(featureId)
    const normalizedOptionId = selectionIdentifier(optionId)
    if (normalizedFeatureId && normalizedOptionId) {
      selections[normalizedFeatureId] = normalizedOptionId
    }
  }
  return selections
}

export function documentSelectionConditionMatches(
  condition: DocumentSelectionCondition,
  selections: Readonly<Record<string, string>>,
): boolean {
  if (condition.op === 'selection_is') {
    return Object.prototype.hasOwnProperty.call(selections, condition.featureId)
      && selections[condition.featureId] === condition.optionId
  }
  if (condition.op === 'not') {
    return !documentSelectionConditionMatches(condition.condition, selections)
  }
  if (condition.op === 'all') {
    return condition.conditions.every(item => documentSelectionConditionMatches(item, selections))
  }
  return condition.conditions.some(item => documentSelectionConditionMatches(item, selections))
}

/** Missing `when` means a legacy/unconditional requirement. Invalid or
 * unsupported conditions fail closed and are excluded from the checklist. */
export function documentRequirementAppliesToScenario(
  requirement: unknown,
  scenarioSnapshot: unknown,
): boolean {
  const source = asRecord(requirement)
  if (!source) return false
  if (!Object.prototype.hasOwnProperty.call(source, 'when') || source.when == null) return true
  const condition = parseDocumentSelectionCondition(source.when)
  return condition
    ? documentSelectionConditionMatches(condition, documentScenarioSelections(scenarioSnapshot))
    : false
}

export function applicableDocumentRequirements<T>(
  requirements: readonly T[],
  scenarioSnapshot: unknown,
): T[] {
  return requirements.filter(requirement => documentRequirementAppliesToScenario(requirement, scenarioSnapshot))
}

/** A matched V2 conditional item is required; a legacy conditional item with
 * no machine-readable condition remains advisory, preserving old behaviour. */
export function documentRequirementIsRequired(requirement: unknown): boolean {
  const source = asRecord(requirement)
  if (!source || source.required !== true) return false
  if (source.applicability === 'always') return true
  return source.applicability === 'conditional'
    && Object.prototype.hasOwnProperty.call(source, 'when')
    && source.when != null
}
