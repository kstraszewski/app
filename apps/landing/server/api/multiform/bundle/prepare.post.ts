import {
  businessCompanyFormKeysForTemplate,
  instantiateTemplate,
  prepareBundle,
  templateApplicantCapacity,
  templateApplicantCapacityIssues,
  templateInstanceIndexes,
  type DocumentTemplate,
  type FieldCondition,
} from '@openexpert/multiform'
import { createError, readBody } from 'h3'
import { toPreparedDocument, toUiField } from '../../../utils/multiform-api'
import {
  loadCrmMultiformContext,
  parseCrmMultiformSelection,
} from '../../../utils/multiform-crm'
import { resolvePinnedMultiformTemplates } from '../../../utils/multiform-template-repository'

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

function templateInputKeys(template: DocumentTemplate) {
  return new Set([
    ...template.bindings.flatMap(binding => [
      ...(!binding.computed && binding.target.kind !== 'unmapped'
        ? [binding.canonicalKey]
        : []),
      ...(binding.valueFrom ?? []),
      ...(binding.condition ? [binding.condition.canonicalKey] : []),
    ]),
    ...(template.requiredCanonicalKeys ?? []),
    ...businessCompanyFormKeysForTemplate(template),
  ])
}

function fieldApplicabilityByKey(templates: readonly DocumentTemplate[]) {
  const usage = new Map<string, {
    unconditional: boolean
    conditions: FieldCondition[]
  }>()
  const add = (key: string, condition?: FieldCondition) => {
    const current = usage.get(key) ?? { unconditional: false, conditions: [] }
    if (!condition) current.unconditional = true
    else if (!current.conditions.some(item => (
      item.canonicalKey === condition.canonicalKey
      && JSON.stringify(item.equals) === JSON.stringify(condition.equals)
    ))) current.conditions.push(condition)
    usage.set(key, current)
  }

  for (const template of templates) {
    for (const key of templateInputKeys(template)) add(key, template.includeWhen)
    if (template.includeWhen) add(template.includeWhen.canonicalKey)
  }
  return usage
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ templateIds?: unknown, crmContext?: unknown }>(event)
  const templateIds = Array.isArray(body?.templateIds)
    ? [...new Set(body.templateIds.filter((id): id is string => typeof id === 'string'))]
    : []

  if (templateIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Wybierz co najmniej jeden dokument.' })
  }
  if (templateIds.length > 50) {
    throw createError({ statusCode: 400, statusMessage: 'Pakiet może zawierać maksymalnie 50 dokumentów.' })
  }

  const crmContext = body?.crmContext === undefined
    ? undefined
    : await loadCrmMultiformContext(event, parseCrmMultiformSelection(body.crmContext))
  if (crmContext && !sameStringSet(templateIds, crmContext.templateIds)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Zestaw template’ów nie odpowiada aktywnym wnioskom CRM. Odśwież kontekst sprawy.',
    })
  }
  const mappingBlockers = new Set(crmContext?.validation.templates.flatMap(template => (
    template.warnings.map(warning => `${template.templateId}: ${warning}`)
  )) ?? [])
  const nonMappingBlockers = crmContext?.validation.blockers.filter(blocker => (
    !mappingBlockers.has(blocker)
  )) ?? []
  if (nonMappingBlockers.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Aktywne wnioski nie są gotowe do przygotowania formularza.',
      data: { blockers: nonMappingBlockers },
    })
  }

  try {
    const templateOverrides = crmContext
      ? await resolvePinnedMultiformTemplates(event, crmContext.applications)
      : []
    const bundle = prepareBundle(templateIds, templateOverrides)
    if (!crmContext && bundle.warnings.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Wspólny formularz można utworzyć dopiero po zatwierdzeniu wszystkich mapowań.',
        data: { warnings: bundle.warnings },
      })
    }
    const applicantCapacities = bundle.documents
      .map(templateApplicantCapacity)
      .filter((capacity): capacity is number => capacity !== null)
    const applicantCapacity = applicantCapacities.length
      ? Math.min(...applicantCapacities)
      : null
    const applicantCollection = bundle.collections.find(collection => (
      collection.key === 'applicants'
    ))
    if (
      applicantCapacity !== null
      && applicantCollection
      && applicantCapacity < applicantCollection.minItems
    ) {
      const blockers = bundle.documents.flatMap((document) => {
        const capacity = templateApplicantCapacity(document)
        return capacity !== null && capacity < applicantCollection.minItems
          ? [`${document.label}: mapowania wnioskodawców nie zaczynają się od pierwszej osoby.`]
          : []
      })
      throw createError({
        statusCode: 409,
        statusMessage: 'Co najmniej jeden dokument ma nieprawidłową strukturę mapowań wnioskodawców.',
        data: { blockers },
      })
    }

    const preparedApplicantCount = crmContext?.applicants.length
      ?? applicantCollection?.minItems
      ?? 1
    const capacityIssues = templateApplicantCapacityIssues(
      bundle.documents,
      preparedApplicantCount,
    )
    if (capacityIssues.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Co najmniej jeden dokument nie obsługuje liczby wnioskodawców w sprawie.',
        data: {
          blockers: capacityIssues.map(issue => (
            `${issue.templateLabel} obsługuje maksymalnie ${issue.supportedCount} `
            + `wnioskodawców, a sprawa zawiera ${issue.requestedCount}.`
          )),
        },
      })
    }

    const preparedDocuments = bundle.documents.flatMap((document) => {
      if (!document.repeatFor) return [toPreparedDocument(document)]
      return templateInstanceIndexes(document, {
        applicants: preparedApplicantCount,
      }).map(index => toPreparedDocument(document, {
        index,
        label: crmContext?.applicants[index]?.label,
      }))
    })
    const bindingCount = bundle.documents.reduce((sum, document) => (
      sum + document.bindings.length * (document.repeatFor ? preparedApplicantCount : 1)
    ), 0)
    const templateRequiredKeys = new Set(bundle.documents.flatMap((document) => {
      if (!document.repeatFor) return [...(document.requiredCanonicalKeys ?? [])]
      return templateInstanceIndexes(document, {
        applicants: preparedApplicantCount,
      }).flatMap(index => (
        instantiateTemplate(document, index).requiredCanonicalKeys ?? []
      ))
    }))
    const preparedTemplateInstances = bundle.documents.flatMap((document) => (
      document.repeatFor
        ? templateInstanceIndexes(document, { applicants: preparedApplicantCount })
            .map(index => instantiateTemplate(document, index))
        : [document]
    ))
    const fieldApplicability = fieldApplicabilityByKey(preparedTemplateInstances)

    return {
      templateIds: bundle.templateIds,
      documents: preparedDocuments,
      fields: bundle.fields.map((field) => {
        const preparedField = toUiField(field, templateRequiredKeys)
        const applicantAwareField = field.canonicalKey === 'additionalProducts.creditCardApplicantIndex'
          && crmContext
          ? {
              ...preparedField,
              options: crmContext.applicants.map((applicant, index) => ({
                label: applicant.label,
                value: String(index),
              })),
            }
          : preparedField
        const applicability = fieldApplicability.get(field.canonicalKey)
        return applicability && !applicability.unconditional && applicability.conditions.length
          ? { ...applicantAwareField, applicableWhenAny: applicability.conditions }
          : applicantAwareField
      }),
      collections: bundle.collections.map(collection => ({
        ...collection,
        ...(collection.key === 'applicants' && applicantCapacity !== null
          ? { maxItems: Math.min(collection.maxItems, applicantCapacity) }
          : {}),
        requiredRelativeKeys: [...collection.requiredRelativeKeys],
      })),
      warnings: bundle.warnings,
      summary: {
        documentCount: preparedDocuments.length,
        uniqueFieldCount: bundle.fields.length,
        mappedOccurrences: bindingCount,
        reusedOccurrences: Math.max(0, bindingCount - bundle.fields.length),
      },
    }
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Niepoprawny zestaw template’ów.',
    })
  }
})
