import { prepareBundle, templateApplicantCapacity } from '@openexpert/multiform'
import { createError, readBody } from 'h3'
import { bankLabel, toUiField } from '../../../utils/multiform-api'
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

export default defineEventHandler(async (event) => {
  const body = await readBody<{ templateIds?: unknown, crmContext?: unknown }>(event)
  const templateIds = Array.isArray(body?.templateIds)
    ? [...new Set(body.templateIds.filter((id): id is string => typeof id === 'string'))]
    : []

  if (templateIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Wybierz co najmniej jeden dokument.' })
  }
  if (templateIds.length > 10) {
    throw createError({ statusCode: 400, statusMessage: 'Pakiet może zawierać maksymalnie 10 dokumentów.' })
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
  if (crmContext && !crmContext.validation.valid) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Template’y aktywnych wniosków nie są gotowe do przygotowania.',
      data: { blockers: crmContext.validation.blockers },
    })
  }

  try {
    const templateOverrides = crmContext
      ? await resolvePinnedMultiformTemplates(event, crmContext.applications)
      : []
    const bundle = prepareBundle(templateIds, templateOverrides)
    if (bundle.warnings.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Wspólny formularz można utworzyć dopiero po zatwierdzeniu wszystkich mapowań.',
        data: { warnings: bundle.warnings },
      })
    }
    const bindingCount = bundle.documents.reduce((sum, document) => sum + document.bindings.length, 0)
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

    return {
      templateIds: bundle.templateIds,
      documents: bundle.documents.map(document => ({
        id: document.id,
        templateId: document.id,
        bank: bankLabel(document.bank),
        name: document.label,
        fileName: document.source.fileName,
      })),
      fields: bundle.fields.map(toUiField),
      collections: bundle.collections.map(collection => ({
        ...collection,
        ...(collection.key === 'applicants' && applicantCapacity !== null
          ? { maxItems: Math.min(collection.maxItems, applicantCapacity) }
          : {}),
        requiredRelativeKeys: [...collection.requiredRelativeKeys],
      })),
      warnings: bundle.warnings,
      summary: {
        documentCount: bundle.documents.length,
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
