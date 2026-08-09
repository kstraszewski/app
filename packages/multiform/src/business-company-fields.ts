import type { DocumentTemplate } from './types.ts'

export const BUSINESS_COMPANY_RELATIVE_KEYS = [
  'businessName',
  'businessNip',
  'businessRegon',
  'businessCeidgId',
  'businessLegalForm',
  'businessStatus',
  'businessAddress',
  'businessCorrespondenceAddress',
  'businessStartDate',
  'businessSuspensionDate',
  'businessResumeDate',
  'businessTerminationDate',
  'businessRemovalDate',
  'pkdCode',
  'businessPkdCodes',
  'businessEmail',
  'businessPhone',
  'businessWebsite',
  'businessActiveOrRecentlySuspended',
] as const

export const BUSINESS_COMPANY_CANONICAL_KEYS = BUSINESS_COMPANY_RELATIVE_KEYS.map(
  relativeKey => `applicants.0.${relativeKey}`,
)

export const BUSINESS_COMPANY_FORM_CANONICAL_KEYS = [
  'applicants.0.incomeSource',
  ...BUSINESS_COMPANY_CANONICAL_KEYS,
]

function applicantIndex(key: string, relativeKeys: ReadonlySet<string>) {
  const match = key.match(/^applicants\.(\d+)\.([^.]*)$/u)
  if (!match || !relativeKeys.has(match[2] ?? '')) return null
  return Number(match[1])
}

export function businessCompanyFormKeysForTemplate(
  template: Pick<DocumentTemplate, 'bindings' | 'includeWhen'>,
) {
  const businessIndicators = new Set([
    'businessLegalForm',
    'businessActiveOrRecentlySuspended',
    'pkdCode',
  ])
  const condition = template.includeWhen
  const conditionIndex = condition && (
    Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  ).includes('business')
    ? applicantIndex(condition.canonicalKey, new Set(['incomeSource']))
    : null
  const bindingIndex = template.bindings
    .map(binding => applicantIndex(binding.canonicalKey, businessIndicators))
    .find((index): index is number => index !== null)
  const index = conditionIndex ?? bindingIndex
  if (index === undefined || index === null) return []

  return [
    `applicants.${index}.incomeSource`,
    ...BUSINESS_COMPANY_RELATIVE_KEYS.map(relativeKey => (
      `applicants.${index}.${relativeKey}`
    )),
  ]
}
