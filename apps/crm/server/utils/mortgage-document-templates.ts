import { createHash } from 'node:crypto'
import {
  getTemplate,
  getTemplates,
  validateTemplateJson,
  type DocumentTemplate,
  type TemplateValidationResult,
} from '@openexpert/multiform'
import { createError } from 'h3'

const templateKeyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const maxTemplateBytes = 2 * 1024 * 1024

type JsonRecord = Record<string, unknown>

export interface MortgageTemplateReference {
  productId: string
  productName: string
  requirementCode: string
  requirementLabel: string
  source: 'published' | 'draft'
}

export function mortgageTemplateRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function mortgageTemplateText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function mortgageTemplateKey(value: unknown, field = 'templateId') {
  const key = mortgageTemplateText(value)
  if (!key || key.length > 120 || !templateKeyPattern.test(key)) {
    throw createError({ statusCode: 400, statusMessage: `${field} jest nieprawidłowy.` })
  }
  return key
}

export function mortgageTemplateBank(bankSlug: string): DocumentTemplate['bank'] | null {
  if (bankSlug === 'erste') return 'erste'
  if (bankSlug === 'pko-bp' || bankSlug === 'pko-bank-polski') return 'pko-bp'
  if (bankSlug === 'pekao' || bankSlug === 'bank-pekao') return 'pekao'
  return null
}

export function registeredMortgageTemplates(bankSlug: string) {
  const bank = mortgageTemplateBank(bankSlug)
  return bank ? getTemplates().filter(template => template.bank === bank) : []
}

export function registeredMortgageTemplate(bankSlug: string, templateId: string) {
  const template = getTemplate(templateId)
  return template && template.bank === mortgageTemplateBank(bankSlug)
    ? template
    : undefined
}

export function mortgageTemplateIdsFromRequirements(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((entry) => {
    const source = mortgageTemplateRecord(entry)
    const templateId = mortgageTemplateText(source.templateId ?? source.template_id)
    return templateId ? [templateId] : []
  }))]
}

export function mortgageTemplateIdsFromVersion(value: unknown) {
  const version = mortgageTemplateRecord(value)
  const configured = Array.isArray(version.multiform_template_ids)
    ? version.multiform_template_ids.flatMap((entry) => {
        const templateId = mortgageTemplateText(entry)
        return templateId ? [templateId] : []
      })
    : []
  return [...new Set([
    ...configured,
    ...mortgageTemplateIdsFromRequirements(version.document_requirements),
  ])]
}

export function mortgageTemplateIdsFromDraft(value: unknown) {
  const draft = mortgageTemplateRecord(value)
  const documentation = mortgageTemplateRecord(draft.documentation)
  const configured = Array.isArray(draft.multiformTemplateIds)
    ? draft.multiformTemplateIds.flatMap((entry) => {
        const templateId = mortgageTemplateText(entry)
        return templateId ? [templateId] : []
      })
    : []
  return [...new Set([
    ...configured,
    ...mortgageTemplateIdsFromRequirements(documentation.requirements),
  ])]
}

export function mortgageTemplateJsonBytes(template: unknown) {
  let serialized: string
  try {
    serialized = JSON.stringify(template)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Template JSON nie może zostać zapisany.' })
  }
  if (new TextEncoder().encode(serialized).byteLength > maxTemplateBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Template JSON może mieć maksymalnie 2 MB.' })
  }
  return serialized
}

export function mortgageTemplateContentSha256(template: unknown) {
  return createHash('sha256').update(mortgageTemplateJsonBytes(template)).digest('hex')
}

export function validateMortgageTemplateForBank(
  value: unknown,
  bankSlug: string,
  templateId: string,
): { template: DocumentTemplate, validation: TemplateValidationResult } {
  const validation = validateTemplateJson(value)
  if (!validation.valid || validation.kind !== 'document-template') {
    throw createError({
      statusCode: 422,
      statusMessage: 'Template JSON zawiera błędy i nie może zostać zapisany.',
      data: { validation },
    })
  }

  const template = value as DocumentTemplate
  const registered = registeredMortgageTemplate(bankSlug, templateId)
  if (!registered) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Template nie należy do tej instytucji albo nie istnieje w rejestrze.',
    })
  }
  if (template.id !== templateId || template.bank !== registered.bank) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Identyfikator lub instytucja w Template JSON nie odpowiada otwartemu formularzowi.',
      data: { validation },
    })
  }
  if (
    template.source.fileName !== registered.source.fileName
    || template.source.sha256 !== registered.source.sha256
  ) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Zmiana źródłowego PDF-u wymaga osobnego procesu weryfikacji pliku.',
      data: { validation },
    })
  }
  return { template, validation }
}

export function mortgageTemplateSummary(
  template: DocumentTemplate,
  validation = validateTemplateJson(template),
) {
  const targetKinds = new Set(template.bindings
    .filter(binding => binding.target.kind !== 'unmapped')
    .map(binding => binding.target.kind))
  const fillMode = targetKinds.size > 1
    ? 'hybrid'
    : targetKinds.has('overlay') ? 'overlay' : 'acroform'

  return {
    pages: template.source.pageCount,
    fillMode,
    fieldCount: template.coverage.inScopeTargetCount,
    mappedFieldCount: template.coverage.mappedTargetCount,
    manualUserActionCount: template.coverage.manualUserActionCount ?? 0,
    coverageStatus: template.coverage.status,
    activationReady: validation.summary.activationReady,
    errors: validation.errors.length,
    warnings: validation.warnings.length,
  }
}
