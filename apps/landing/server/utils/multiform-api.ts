import {
  CANONICAL_FIELDS,
  canonicalDerivationDependenciesForKey,
  instantiateTemplate,
  resolveTemplateFillMethod,
  type CanonicalFieldDefinition,
  type DocumentTemplate,
  type FieldCondition,
  type TemplateFillMethod,
} from '@openexpert/multiform'

const sectionLabels: Record<CanonicalFieldDefinition['group'], string> = {
  application: 'Wniosek',
  applicants: 'Wnioskodawcy',
  loan: 'Parametry kredytu',
  investment: 'Finansowanie inwestycji',
  property: 'Nieruchomość',
  household: 'Gospodarstwo domowe',
  liabilities: 'Zobowiązania i obciążenia',
  declarations: 'Oświadczenia i zgody',
}

const requiredKeys: ReadonlySet<string> = new Set([
  'application.place',
  'application.date',
  'applicants.0.firstName',
  'applicants.0.lastName',
  'applicants.0.pesel',
  'loan.purpose',
  'loan.program',
  'loan.productType',
  'loan.amount',
  'loan.termMonths',
  'loan.repaymentDay',
  'loan.installmentType',
  'loan.interestType',
  'loan.disbursementType',
  'loan.commissionType',
  'investment.totalCost',
  'investment.ownFundsPaid',
  'investment.ownFundsBeforeDisbursement',
  'investment.ownFundsDuringInvestment',
  'property.type',
  'property.address.street',
  'property.address.houseNumber',
  'property.address.postalCode',
  'property.address.city',
  'property.address.county',
  'property.address.voivodeship',
  'property.marketValue',
  'collateralProperty.type',
  'collateralProperty.sameAsFinancedProperty',
  'property.ownershipType',
  'property.ownershipSequence',
  'loan.currency',
  'loan.cpiPremiumFinancing',
  'loan.mortgageEstablishmentMode',
  'property.appraisalSource',
  'declarations.selectedLoanRiskVariant',
])

const fieldLabels = new Map<string, string>(
  CANONICAL_FIELDS.map(field => [field.canonicalKey, field.label]),
)

type SupportedFillMethod = Extract<TemplateFillMethod, {
  kind:
    | 'pdf_acroform'
    | 'pdf_overlay'
    | 'pdf_hybrid'
    | 'pdf_manual'
    | 'pdf_readonly'
    | 'xlsx_native'
    | 'xlsx_manual'
}>
type DeferredFillMethod = Exclude<TemplateFillMethod, SupportedFillMethod>

export type MultiformValue = string | number | boolean

export function isMissingValue(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

export function canonicalMaxLengthIssue(
  field: CanonicalFieldDefinition,
  value: MultiformValue,
) {
  const maxLength = field.validation?.maxLength
  if (maxLength === undefined || String(value).trim().length <= maxLength) return undefined
  return `Wartość może mieć maksymalnie ${maxLength} znaków.`
}

export function isRequiredCanonicalKey(
  key: string,
  additionalRequiredKeys?: ReadonlySet<string>,
) {
  return requiredKeys.has(key) || additionalRequiredKeys?.has(key) === true
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
  additionalRequiredKeys?: ReadonlySet<string>,
) {
  if (!isCanonicalFieldVisible(field, values)) return false
  return isRequiredCanonicalKey(field.canonicalKey, additionalRequiredKeys)
    || Boolean(field.requiredWhen && multiformConditionMatches(field.requiredWhen, values))
}

export function toUiField(
  field: CanonicalFieldDefinition,
  additionalRequiredKeys?: ReadonlySet<string>,
) {
  const derivationDependencies = canonicalDerivationDependenciesForKey(field.canonicalKey)
  const booleanOptions = field.type === 'boolean'
    ? [
        { label: 'Tak', value: 'true' },
        { label: 'Nie', value: 'false' },
      ]
    : undefined

  return {
    key: field.canonicalKey,
    label: field.label,
    question: field.form.question,
    helpText: field.form.helpText,
    // A bank declaration must distinguish an unanswered question from an
    // explicit "Nie". A checkbox cannot represent those three states, so the
    // client receives an explicit Tak/Nie selector with an empty placeholder.
    type: field.type === 'boolean' ? 'select' : field.type,
    section: sectionLabels[field.group],
    required: isRequiredCanonicalKey(field.canonicalKey, additionalRequiredKeys),
    visibleWhen: field.visibleWhen,
    requiredWhen: field.requiredWhen,
    description: field.form.helpText ?? field.description,
    semanticDescription: field.semanticDescription,
    semanticRole: field.semanticRole,
    aiMappingHints: {
      aliases: [...field.aiMappingHints.aliases],
      exclude: [...field.aiMappingHints.exclude],
    },
    placeholder: getPlaceholder(field),
    options: booleanOptions ?? field.options?.map(option => ({ ...option })),
    collection: field.collection ? { ...field.collection } : undefined,
    validation: field.validation,
    derivation: derivationDependencies.length
      ? { mode: 'when_available' as const, dependencies: [...derivationDependencies] }
      : undefined,
  }
}

function getPlaceholder(field: CanonicalFieldDefinition) {
  if (field.canonicalKey.endsWith('.pesel')) return '11 cyfr'
  if (field.canonicalKey === 'property.address.postalCode') return '00-000'
  if (field.type === 'currency') return '0,00'
  if (field.type === 'select' || field.type === 'boolean') return 'Wybierz opcję'
  return undefined
}

export function summarizeTemplate(template: DocumentTemplate) {
  const fillMethod = resolveTemplateFillMethod(template)
  const fillMethodSupported = pdfFillMethodIsSupported(fillMethod)
  const fillMode = legacyFillMode(fillMethod)
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
    ...(fillMethodSupported
      ? []
      : [`Metoda ${fillMethod.kind} nie ma jeszcze aktywnego handlera.`]),
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
    fillMethod,
    fillMode,
    status: !fillMethodSupported ? 'nieobsługiwany' : warnings.length ? 'niepełny' : 'gotowy',
    ready: fillMethodSupported && warnings.length === 0,
    fieldCount: template.coverage.inScopeTargetCount,
    mappedFieldCount: template.coverage.mappedTargetCount,
    manualUserActionCount: template.coverage.manualUserActionCount ?? 0,
    warnings,
  }
}

export function pdfFillMethodIsSupported(
  method: TemplateFillMethod,
): method is SupportedFillMethod {
  return method.kind === 'pdf_acroform'
    || method.kind === 'pdf_overlay'
    || method.kind === 'pdf_hybrid'
    || method.kind === 'pdf_manual'
    || method.kind === 'pdf_readonly'
    || method.kind === 'xlsx_native'
    || method.kind === 'xlsx_manual'
}

export function firstUnsupportedTemplateFillMethod(
  templates: readonly DocumentTemplate[],
) {
  for (const template of templates) {
    const fillMethod = resolveTemplateFillMethod(template)
    if (!pdfFillMethodIsSupported(fillMethod)) {
      return { templateId: template.id, fillMethod }
    }
  }
  return undefined
}

export function unsupportedTemplateFillMethodHttpDetails(issue: {
  templateId: string
  fillMethod: DeferredFillMethod
}) {
  const label = issue.fillMethod.kind === 'web_form'
    ? 'Formularz internetowy'
    : 'Integracja API'
  return {
    statusCode: 501,
    statusMessage: `${label} nie jest jeszcze obsługiwany w eksporcie PDF/ZIP.`,
    data: {
      fillMethod: issue.fillMethod.kind,
      templateId: issue.templateId,
    },
  }
}

export function toPreparedDocument(
  document: DocumentTemplate,
  instance?: { index: number, label?: string },
) {
  const preparedTemplate = instance
    ? instantiateTemplate(document, instance.index)
    : document
  const instanceLabel = instance?.label?.trim()
    || (instance ? `${document.repeatFor?.itemLabel ?? 'Instancja'} ${instance.index + 1}` : undefined)
  return {
    id: instance ? `${document.id}:${instance.index}` : document.id,
    templateId: document.id,
    bank: bankLabel(document.bank),
    name: instanceLabel ? `${document.label} — ${instanceLabel}` : document.label,
    fileName: document.source.fileName,
    fillMethod: resolveTemplateFillMethod(document),
    ...(preparedTemplate.includeWhen ? { includeWhen: preparedTemplate.includeWhen } : {}),
    ...(instance ? { instanceIndex: instance.index, instanceLabel } : {}),
  }
}

function legacyFillMode(method: TemplateFillMethod) {
  if (method.kind === 'pdf_acroform') return 'acroform'
  if (method.kind === 'pdf_overlay') return 'overlay'
  if (method.kind === 'pdf_hybrid') return 'hybrid'
  if (method.kind === 'pdf_manual') return 'manual'
  if (method.kind === 'pdf_readonly') return 'readonly'
  return method.kind
}

export function bankLabel(bank: DocumentTemplate['bank']) {
  if (bank === 'pko-bp') return 'PKO BP'
  if (bank === 'pekao') return 'Pekao SA'
  if (bank === 'ing') return 'ING Bank Śląski'
  if (bank === 'mbank') return 'mBank'
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
