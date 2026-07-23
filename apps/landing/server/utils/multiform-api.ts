import {
  CANONICAL_FIELDS,
  type CanonicalFieldDefinition,
  type DocumentTemplate,
  type FieldCondition,
} from '@openexpert/multiform'

const sectionLabels: Record<CanonicalFieldDefinition['group'], string> = {
  application: 'Wniosek',
  applicants: 'Wnioskodawcy',
  loan: 'Parametry kredytu',
  investment: 'Finansowanie inwestycji',
  property: 'Nieruchomość',
}

const requiredKeys: ReadonlySet<string> = new Set([
  'application.place',
  'application.date',
  'applicants.0.firstName',
  'applicants.0.lastName',
  'applicants.0.pesel',
  'loan.purpose',
  'loan.amount',
  'loan.termMonths',
  'property.address.street',
  'property.address.houseNumber',
  'property.address.postalCode',
  'property.address.city',
  'property.marketValue',
])

const fieldLabels = new Map<string, string>(
  CANONICAL_FIELDS.map(field => [field.canonicalKey, field.label]),
)

export type MultiformValue = string | number | boolean

export function isMissingValue(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

export function isRequiredCanonicalKey(key: string) {
  return requiredKeys.has(key)
}

export function multiformConditionMatches(
  condition: FieldCondition | undefined,
  values: Readonly<Record<string, MultiformValue>>,
) {
  if (!condition) return true
  const value = values[condition.canonicalKey]
  if (value === undefined || value === null) return false

  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  return expected.includes(String(value))
}

export function isCanonicalFieldVisible(
  field: CanonicalFieldDefinition,
  values: Readonly<Record<string, MultiformValue>>,
) {
  return multiformConditionMatches(field.visibleWhen, values)
}

export function isCanonicalFieldRequired(
  field: CanonicalFieldDefinition,
  values: Readonly<Record<string, MultiformValue>>,
) {
  if (!isCanonicalFieldVisible(field, values)) return false
  return isRequiredCanonicalKey(field.canonicalKey)
    || Boolean(field.requiredWhen && multiformConditionMatches(field.requiredWhen, values))
}

export function toUiField(field: CanonicalFieldDefinition) {
  return {
    key: field.canonicalKey,
    label: field.label,
    type: field.type === 'boolean' ? 'checkbox' : field.type,
    section: sectionLabels[field.group],
    required: isRequiredCanonicalKey(field.canonicalKey),
    visibleWhen: field.visibleWhen,
    requiredWhen: field.requiredWhen,
    description: field.description,
    placeholder: getPlaceholder(field),
    options: field.options?.map(option => ({ ...option })),
    collection: field.collection ? { ...field.collection } : undefined,
    validation: field.validation,
  }
}

function getPlaceholder(field: CanonicalFieldDefinition) {
  if (field.canonicalKey.endsWith('.pesel')) return '11 cyfr'
  if (field.canonicalKey === 'property.address.postalCode') return '00-000'
  if (field.type === 'currency') return '0,00'
  if (field.type === 'select') return 'Wybierz opcję'
  return undefined
}

export function summarizeTemplate(template: DocumentTemplate) {
  const targetKinds = new Set(
    template.bindings
      .filter(binding => binding.target.kind !== 'unmapped')
      .map(binding => binding.target.kind),
  )
  const fillMode = targetKinds.size > 1
    ? 'hybrid'
    : targetKinds.has('overlay') ? 'overlay' : 'acroform'
  const missingCoverageTargets = Math.max(
    0,
    template.coverage.inScopeTargetCount - template.coverage.mappedTargetCount,
  )
  const coverageWarnings = template.coverage.status === 'complete' && missingCoverageTargets === 0
    ? []
    : [missingCoverageTargets > 0
        ? `Pełne pokrycie formularza nie jest gotowe: brakuje ${missingCoverageTargets} z ${template.coverage.inScopeTargetCount} targetów klienta.`
        : 'Pełny inwentarz targetów formularza nie został zatwierdzony.']
  const warnings = [...new Set([
    ...coverageWarnings,
    ...template.bindings.flatMap((binding) => {
    const fieldLabel = fieldLabels.get(binding.canonicalKey) ?? binding.canonicalKey
    if (binding.target.kind === 'unmapped') {
      return [`${fieldLabel}: ${binding.target.reason}`]
    }
    if (binding.reviewStatus === 'needsReview') {
      return [`${fieldLabel}: ${binding.notes || 'mapowanie wymaga zatwierdzenia'}`]
    }
    return []
    }),
  ])]

  return {
    id: template.id,
    bank: bankLabel(template.bank),
    name: template.label,
    fileName: template.source.fileName,
    pages: template.source.pageCount,
    fillMode,
    status: warnings.length ? 'niepełny' : 'gotowy',
    ready: warnings.length === 0,
    fieldCount: template.coverage.inScopeTargetCount,
    mappedFieldCount: template.coverage.mappedTargetCount,
    manualUserActionCount: template.coverage.manualUserActionCount ?? 0,
    warnings,
  }
}

export function bankLabel(bank: DocumentTemplate['bank']) {
  if (bank === 'pko-bp') return 'PKO BP'
  if (bank === 'pekao') return 'Pekao SA'
  return 'Erste'
}

export function normalizeValues(input: unknown): Record<string, MultiformValue> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => (
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ))
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
  )
}

export async function readMultiformAsset(
  storageName: 'assets:multiform-mocks' | 'assets:multiform-fonts',
  key: string,
) {
  const value = await useStorage(storageName).getItemRaw(key)
  if (value === null || value === undefined) {
    throw new Error(`Brak zasobu: ${key}`)
  }
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value as ArrayBuffer)
}
