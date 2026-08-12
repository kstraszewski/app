import { CANONICAL_COLLECTIONS, CANONICAL_FIELDS } from './canonical-fields.ts'
import { businessCompanyFormKeysForTemplate } from './business-company-fields.ts'
import { instantiateTemplate } from './template-instances.ts'
import { TEMPLATES } from './templates/index.ts'
import { canonicalDerivationDependenciesForKey } from './value-resolution.ts'
import type {
  BundleWarning,
  CanonicalFieldDefinition,
  DocumentTemplate,
  PreparedBundle,
} from './types.ts'

const TEMPLATE_BY_ID = new Map<string, DocumentTemplate>(
  TEMPLATES.map((template) => [template.id, template]),
)

const TEMPLATE_BY_SOURCE_SHA256 = new Map<string, DocumentTemplate>(
  TEMPLATES.map((template) => [template.source.sha256, template]),
)

const FIELD_KEYS = new Set<string>(
  CANONICAL_FIELDS.map((field) => field.canonicalKey),
)

export function getTemplates(): readonly DocumentTemplate[] {
  return [...TEMPLATES]
}

export function getTemplate(id: string): DocumentTemplate | undefined {
  return TEMPLATE_BY_ID.get(id)
}

export function getTemplateBySourceSha256(sha256: string): DocumentTemplate | undefined {
  return TEMPLATE_BY_SOURCE_SHA256.get(sha256.trim().toLocaleLowerCase('en-US'))
}

function warningForBinding(
  template: DocumentTemplate,
  binding: DocumentTemplate['bindings'][number],
): BundleWarning | undefined {
  if (binding.target.kind === 'unmapped') {
    return {
      templateId: template.id,
      canonicalKey: binding.canonicalKey,
      status: 'unmapped',
      reason: binding.target.reason,
    }
  }

  if (binding.reviewStatus === 'needsReview') {
    return {
      templateId: template.id,
      canonicalKey: binding.canonicalKey,
      status: 'needsReview',
      reason: binding.notes ?? 'Mapowanie wymaga ręcznej weryfikacji.',
    }
  }

  return undefined
}

function warningForCoverage(template: DocumentTemplate): BundleWarning | undefined {
  const coverage = template.coverage
  const missingTargetCount = Math.max(
    0,
    coverage.inScopeTargetCount - coverage.mappedTargetCount,
  )
  if (coverage.status === 'complete' && missingTargetCount === 0) return undefined

  return {
    templateId: template.id,
    canonicalKey: '__templateCoverage__',
    status: 'unmapped',
    reason: missingTargetCount > 0
      ? `Brakuje obsługi ${missingTargetCount} z ${coverage.inScopeTargetCount} targetów formularza klienta.`
      : 'Pełny inwentarz targetów formularza nie został zatwierdzony.',
  }
}

export function prepareBundle(
  templateIds: readonly string[],
  templateOverrides: readonly DocumentTemplate[] = [],
): PreparedBundle {
  const uniqueIds = [...new Set(templateIds)]
  const overrideById = new Map(templateOverrides.map(template => [template.id, template]))
  const documents = uniqueIds.map((id) => {
    const template = overrideById.get(id) ?? getTemplate(id)
    if (!template) throw new Error(`Unknown multiform template: ${id}`)
    return template
  })

  const requestedFields = new Set<string>()
  const warnings: BundleWarning[] = []

  for (const template of documents) {
    const coverageWarning = warningForCoverage(template)
    if (coverageWarning) warnings.push(coverageWarning)

    const fieldTemplates = template.repeatFor
      ? Array.from(
          { length: template.repeatFor.maxInstances },
          (_, instanceIndex) => instantiateTemplate(template, instanceIndex),
        )
      : [template]

    for (const binding of fieldTemplates.flatMap(document => document.bindings)) {
      if (
        !binding.computed
        && binding.target.kind !== 'unmapped'
        && FIELD_KEYS.has(binding.canonicalKey)
      ) {
        requestedFields.add(binding.canonicalKey)
      }
      for (const dependency of binding.valueFrom ?? []) {
        if (FIELD_KEYS.has(dependency)) requestedFields.add(dependency)
      }
      if (binding.condition && FIELD_KEYS.has(binding.condition.canonicalKey)) {
        requestedFields.add(binding.condition.canonicalKey)
      }

      const warning = warningForBinding(template, binding)
      if (warning) warnings.push(warning)
    }
    for (const fieldTemplate of fieldTemplates) {
      if (fieldTemplate.includeWhen && FIELD_KEYS.has(fieldTemplate.includeWhen.canonicalKey)) {
        requestedFields.add(fieldTemplate.includeWhen.canonicalKey)
      }
      for (const key of fieldTemplate.requiredCanonicalKeys ?? []) {
        if (FIELD_KEYS.has(key)) requestedFields.add(key)
      }
      for (const key of businessCompanyFormKeysForTemplate(fieldTemplate)) {
        if (FIELD_KEYS.has(key)) requestedFields.add(key)
      }
    }
  }

  const dependencyQueue = [...requestedFields]
  for (let cursor = 0; cursor < dependencyQueue.length; cursor += 1) {
    const key = dependencyQueue[cursor]!
    for (const dependency of canonicalDerivationDependenciesForKey(key)) {
      if (!FIELD_KEYS.has(dependency) || requestedFields.has(dependency)) continue
      requestedFields.add(dependency)
      dependencyQueue.push(dependency)
    }
  }

  const fields: readonly CanonicalFieldDefinition[] = CANONICAL_FIELDS.filter(
    field => requestedFields.has(field.canonicalKey),
  )
  const requestedCollections = new Set(fields.flatMap(field => (
    field.collection ? [field.collection.key] : []
  )))

  return {
    templateIds: uniqueIds,
    documents,
    fields,
    collections: CANONICAL_COLLECTIONS.filter(collection => requestedCollections.has(collection.key)),
    warnings,
  }
}
