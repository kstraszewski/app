export type CanonicalScalar = string | number | boolean

export type CanonicalValueOrigin =
  | 'input'
  | 'crm'
  | 'intake'
  | 'case'
  | 'client'
  | 'expert'
  | 'derived'

export type CanonicalResolutionStatus = 'clean' | 'conflict' | 'invalid' | 'stale'

export interface CanonicalResolvedValueMeta {
  origin: CanonicalValueOrigin
  status: CanonicalResolutionStatus
  derivedFrom?: readonly string[]
  expectedValue?: CanonicalScalar
  message?: string
}

export interface CanonicalResolutionIssue {
  key: string
  code:
    | 'invalid_pesel'
    | 'derived_value_conflict'
    | 'invalid_derived_currency'
  severity: 'error' | 'warning'
  message: string
  derivedFrom?: readonly string[]
  expectedValue?: CanonicalScalar
}

export interface CanonicalResolutionResult {
  values: Record<string, CanonicalScalar>
  metadata: Record<string, CanonicalResolvedValueMeta>
  issues: CanonicalResolutionIssue[]
}

export interface ResolveCanonicalValuesOptions {
  origins?: Readonly<Record<string, CanonicalValueOrigin>>
}

export interface DecodedPesel {
  normalized: string
  birthDate: string
  gender: 'female' | 'male'
}

export type PeselDecodeResult =
  | { valid: true, data: DecodedPesel }
  | { valid: false, error: string }

const APPLICANT_INDEXES = [0, 1, 2, 3, 4] as const
const LIABILITY_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3] as const

function isoDate(year: number, month: number, day: number) {
  return [year, month, day].map((part, index) => (
    index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0')
  )).join('-')
}

export function decodePesel(value: unknown): PeselDecodeResult {
  const normalized = String(value ?? '').trim()
  if (!/^\d{11}$/u.test(normalized)) {
    return { valid: false, error: 'PESEL musi zawierać dokładnie 11 cyfr.' }
  }

  const digits = [...normalized].map(Number)
  const checksum = (10 - (PESEL_WEIGHTS.reduce((sum, weight, index) => (
    sum + weight * digits[index]!
  ), 0) % 10)) % 10
  if (checksum !== digits[10]) {
    return { valid: false, error: 'Nieprawidłowa suma kontrolna numeru PESEL.' }
  }

  const encodedMonth = digits[2]! * 10 + digits[3]!
  const century = encodedMonth >= 81
    ? 1800
    : encodedMonth >= 61
      ? 2200
      : encodedMonth >= 41
        ? 2100
        : encodedMonth >= 21
          ? 2000
          : 1900
  const month = encodedMonth > 80
    ? encodedMonth - 80
    : encodedMonth > 60
      ? encodedMonth - 60
      : encodedMonth > 40
        ? encodedMonth - 40
        : encodedMonth > 20
          ? encodedMonth - 20
          : encodedMonth
  const year = century + digits[0]! * 10 + digits[1]!
  const day = digits[4]! * 10 + digits[5]!
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return { valid: false, error: 'PESEL zawiera nieprawidłową datę urodzenia.' }
  }

  return {
    valid: true,
    data: {
      normalized,
      birthDate: isoDate(year, month, day),
      gender: digits[9]! % 2 === 0 ? 'female' : 'male',
    },
  }
}

const ONES = [
  '', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć',
] as const
const TEENS = [
  'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście',
  'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście',
] as const
const TENS = [
  '', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt',
  'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt',
] as const
const HUNDREDS = [
  '', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset',
  'sześćset', 'siedemset', 'osiemset', 'dziewięćset',
] as const
const SCALES = [
  ['', '', ''],
  ['tysiąc', 'tysiące', 'tysięcy'],
  ['milion', 'miliony', 'milionów'],
  ['miliard', 'miliardy', 'miliardów'],
  ['bilion', 'biliony', 'bilionów'],
  ['biliard', 'biliardy', 'biliardów'],
  ['trylion', 'tryliony', 'trylionów'],
] as const

function pluralForm(value: bigint) {
  const lastTwo = Number(value % 100n)
  const last = Number(value % 10n)
  if (value === 1n) return 0
  if (lastTwo >= 12 && lastTwo <= 14) return 2
  return last >= 2 && last <= 4 ? 1 : 2
}

function triadWords(value: number) {
  const parts: string[] = []
  const hundreds = Math.floor(value / 100)
  const remainder = value % 100
  if (hundreds) parts.push(HUNDREDS[hundreds]!)
  if (remainder >= 10 && remainder < 20) {
    parts.push(TEENS[remainder - 10]!)
  }
  else {
    const tens = Math.floor(remainder / 10)
    const ones = remainder % 10
    if (tens) parts.push(TENS[tens]!)
    if (ones) parts.push(ONES[ones]!)
  }
  return parts.join(' ')
}

export function integerToPolishWords(input: bigint) {
  if (input === 0n) return 'zero'
  const negative = input < 0n
  let value = negative ? -input : input
  const groups: number[] = []
  while (value > 0n) {
    groups.push(Number(value % 1000n))
    value /= 1000n
  }
  if (groups.length > SCALES.length) {
    throw new RangeError('Kwota jest zbyt duża do zapisania słownie.')
  }

  const parts: string[] = []
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!
    if (!group) continue
    if (index === 1 && group === 1) {
      parts.push(SCALES[index]![0])
      continue
    }
    parts.push(triadWords(group))
    if (index > 0) parts.push(SCALES[index]![pluralForm(BigInt(group))])
  }
  return `${negative ? 'minus ' : ''}${parts.filter(Boolean).join(' ')}`
}

function parseAmountToMinorUnits(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) return null
    return BigInt(Math.round(value * 100))
  }
  const raw = String(value ?? '').trim().replace(/[\s\u00A0\u202F]/gu, '')
  if (!raw) return null
  const separators = [...raw].flatMap((character, index) => (
    character === ',' || character === '.' ? [index] : []
  ))
  const lastSeparator = separators.at(-1) ?? -1
  const hasBothSeparators = raw.includes(',') && raw.includes('.')
  const digitsAfterLastSeparator = lastSeparator >= 0 ? raw.length - lastSeparator - 1 : 0
  const decimalIndex = hasBothSeparators
    ? lastSeparator
    : lastSeparator >= 0 && digitsAfterLastSeparator <= 2
      ? lastSeparator
      : -1
  let integerPart = decimalIndex >= 0 ? raw.slice(0, decimalIndex) : raw
  let fractionPart = decimalIndex >= 0 ? raw.slice(decimalIndex + 1) : ''
  integerPart = integerPart.replace(/[.,]/gu, '')
  if (!/^-?\d+$/u.test(integerPart) || !/^\d{0,2}$/u.test(fractionPart)) return null
  fractionPart = fractionPart.padEnd(2, '0')
  const negative = integerPart.startsWith('-')
  const absoluteInteger = negative ? integerPart.slice(1) : integerPart
  const minor = BigInt(absoluteInteger) * 100n + BigInt(fractionPart || '0')
  return negative ? -minor : minor
}

const CURRENCY_FORMS: Record<string, readonly [string, string, string]> = {
  PLN: ['złoty', 'złote', 'złotych'],
  EUR: ['euro', 'euro', 'euro'],
  USD: ['dolar amerykański', 'dolary amerykańskie', 'dolarów amerykańskich'],
  GBP: ['funt szterling', 'funty szterlingi', 'funtów szterlingów'],
  CHF: ['frank szwajcarski', 'franki szwajcarskie', 'franków szwajcarskich'],
}

export function formatCurrencyWords(
  value: unknown,
  currency = 'PLN',
  fractionMode: 'fraction' | 'words' = 'fraction',
) {
  const minorUnits = parseAmountToMinorUnits(value)
  if (minorUnits === null) return null
  const negative = minorUnits < 0n
  const absoluteMinor = negative ? -minorUnits : minorUnits
  const whole = absoluteMinor / 100n
  const fraction = absoluteMinor % 100n
  const normalizedCurrency = currency.trim().toUpperCase() || 'PLN'
  const forms = CURRENCY_FORMS[normalizedCurrency]
    ?? [normalizedCurrency, normalizedCurrency, normalizedCurrency]
  const wholeWords = integerToPolishWords(negative ? -whole : whole)
  const currencyWord = forms[pluralForm(whole)]
  if (fractionMode === 'words') {
    const fractionWords = integerToPolishWords(fraction)
    const fractionWord = ['grosz', 'grosze', 'groszy'][pluralForm(fraction)]
    return `${wholeWords} ${currencyWord} ${fractionWords} ${fractionWord}`
  }
  return `${wholeWords} ${currencyWord} ${String(fraction).padStart(2, '0')}/100`
}

function isMissing(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function numeric(value: unknown) {
  const minor = parseAmountToMinorUnits(value)
  return minor === null ? null : Number(minor) / 100
}

function comparable(value: CanonicalScalar) {
  return typeof value === 'string' ? value.trim() : value
}

function propertySourceKey(targetKey: string) {
  const suffix = targetKey.slice('collateralProperty.'.length)
  const mapping: Record<string, string> = {
    type: 'property.type',
    typeOther: 'property.typeOther',
    address: 'property.address.full',
    'address.city': 'property.address.city',
    'address.voivodeship': 'property.address.voivodeship',
    'address.county': 'property.address.county',
    'address.municipality': 'property.address.municipality',
    'address.district': 'property.address.district',
    'address.postalCode': 'property.address.postalCode',
    'address.street': 'property.address.street',
    'address.houseAndUnit': 'property.address.houseAndUnit',
    usableArea: 'property.usableArea',
    constructionYear: 'property.constructionYear',
    marketValue: 'property.marketValue',
    landRegisterNumber: 'property.landRegisterNumber',
  }
  return mapping[suffix]
}

const PROPERTY_ADDRESS_PARTS = [
  'property.address.street',
  'property.address.houseNumber',
  'property.address.unitNumber',
  'property.address.postalCode',
  'property.address.city',
] as const

function fullPropertyAddress(values: Readonly<Record<string, CanonicalScalar>>) {
  const street = String(values['property.address.street'] ?? '').trim()
  const house = String(values['property.address.houseNumber'] ?? '').trim()
  const unit = String(values['property.address.unitNumber'] ?? '').trim()
  const streetLine = [street, house ? `${house}${unit ? `/${unit}` : ''}` : ''].filter(Boolean).join(' ')
  const cityLine = [values['property.address.postalCode'], values['property.address.city']]
    .filter(value => !isMissing(value))
    .map(String)
    .join(' ')
  return [streetLine, cityLine].filter(Boolean).join(', ')
}

function propertyHouseAndUnit(values: Readonly<Record<string, CanonicalScalar>>) {
  const house = String(values['property.address.houseNumber'] ?? '').trim()
  const unit = String(values['property.address.unitNumber'] ?? '').trim()
  return house ? `${house}${unit ? `/${unit}` : ''}` : ''
}

export function canonicalDerivationDependenciesForKey(key: string): readonly string[] {
  const applicantMatch = /^applicants\.(\d+)\.(.+)$/u.exec(key)
  if (applicantMatch) {
    const [, index, relativeKey] = applicantMatch
    if (relativeKey === 'birthDate' || relativeKey === 'gender') {
      return [`applicants.${index}.pesel`]
    }
    if (relativeKey === 'averageNetIncomeInWords') {
      return [`applicants.${index}.averageNetIncome`, `applicants.${index}.incomeCurrency`]
    }
    if (relativeKey === 'correspondenceAddress') {
      return [
        `applicants.${index}.correspondenceSameAsResidential`,
        `applicants.${index}.residentialAddress`,
      ]
    }
  }
  if (key === 'investment.ownFunds') {
    return [
      'investment.ownFundsPaid',
      'investment.ownFundsBeforeDisbursement',
      'investment.ownFundsDuringInvestment',
    ]
  }
  if (key === 'additionalProducts.creditCardApplicant') {
    return [
      'additionalProducts.creditCardApplicantIndex',
      ...APPLICANT_INDEXES.flatMap(index => [
        `applicants.${index}.firstName`,
        `applicants.${index}.lastName`,
      ]),
    ]
  }
  if (key === 'investor.buyerDetails') {
    return APPLICANT_INDEXES.flatMap(index => [
      `applicants.${index}.firstName`,
      `applicants.${index}.lastName`,
    ])
  }
  if (key === 'consents.creditDecisionEmail') return ['applicants.0.email']
  if (key.startsWith('collateralProperty.')) {
    const source = propertySourceKey(key)
    return [
      'collateralProperty.sameAsFinancedProperty',
      ...(source === 'property.address.full'
        ? [...PROPERTY_ADDRESS_PARTS]
        : source === 'property.address.houseAndUnit'
          ? ['property.address.houseNumber', 'property.address.unitNumber']
          : source ? [source] : []),
    ]
  }
  if (key === 'households.0.monthlyDebtInstallments') {
    return LIABILITY_INDEXES.map(index => `liabilities.${index}.installmentAmount`)
  }
  if (key === 'households.0.outstandingDebt') {
    return LIABILITY_INDEXES.map(index => `liabilities.${index}.outstandingAmount`)
  }
  if (key === 'declarations.selectedLoanRiskVariant') return ['loan.interestType']
  return []
}

export function resolveCanonicalValues(
  input: Readonly<Record<string, unknown>>,
  options: ResolveCanonicalValuesOptions = {},
): CanonicalResolutionResult {
  const values: Record<string, CanonicalScalar> = {}
  const metadata: Record<string, CanonicalResolvedValueMeta> = {}
  const issues: CanonicalResolutionIssue[] = []

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    values[key] = value
    metadata[key] = {
      origin: options.origins?.[key] ?? 'input',
      status: 'clean',
    }
  }

  const derive = (
    key: string,
    value: CanonicalScalar | null | undefined,
    derivedFrom: readonly string[],
    mode: 'fallback' | 'replace' | 'conflict' = 'fallback',
  ) => {
    if (value === null || value === undefined || value === '') return
    const current = values[key]
    if (isMissing(current) || mode === 'replace') {
      const stale = !isMissing(current) && comparable(current!) !== comparable(value)
      values[key] = value
      metadata[key] = {
        origin: 'derived',
        status: stale ? 'stale' : 'clean',
        derivedFrom,
        ...(stale ? { expectedValue: value, message: 'Wartość została ponownie wyliczona.' } : {}),
      }
      return
    }
    if (comparable(current!) === comparable(value)) {
      values[key] = value
      metadata[key] = { origin: 'derived', status: 'clean', derivedFrom }
      return
    }
    if (mode === 'fallback') return
    const message = 'Wartość różni się od danych wyliczonych automatycznie.'
    metadata[key] = {
      origin: metadata[key]?.origin ?? 'input',
      status: 'conflict',
      derivedFrom,
      expectedValue: value,
      message,
    }
    issues.push({
      key,
      code: 'derived_value_conflict',
      severity: 'error',
      message,
      derivedFrom,
      expectedValue: value,
    })
  }

  for (const index of APPLICANT_INDEXES) {
    const prefix = `applicants.${index}`
    const peselKey = `${prefix}.pesel`
    const pesel = values[peselKey]
    if (!isMissing(pesel)) {
      const decoded = decodePesel(pesel)
      if (!decoded.valid) {
        metadata[peselKey] = {
          origin: metadata[peselKey]?.origin ?? 'input',
          status: 'invalid',
          message: decoded.error,
        }
        issues.push({
          key: peselKey,
          code: 'invalid_pesel',
          severity: 'error',
          message: decoded.error,
        })
      }
      else {
        values[peselKey] = decoded.data.normalized
        derive(`${prefix}.birthDate`, decoded.data.birthDate, [peselKey], 'conflict')
        derive(`${prefix}.gender`, decoded.data.gender, [peselKey], 'conflict')
      }
    }

    const incomeKey = `${prefix}.averageNetIncome`
    if (!isMissing(values[incomeKey])) {
      const words = formatCurrencyWords(values[incomeKey], String(values[`${prefix}.incomeCurrency`] ?? 'PLN'))
      if (words) derive(`${prefix}.averageNetIncomeInWords`, words, [incomeKey, `${prefix}.incomeCurrency`], 'replace')
      else issues.push({
        key: incomeKey,
        code: 'invalid_derived_currency',
        severity: 'error',
        message: 'Nie można zapisać podanej kwoty słownie.',
      })
    }

    if (String(values[`${prefix}.correspondenceSameAsResidential`] ?? '') === 'true') {
      derive(
        `${prefix}.correspondenceAddress`,
        values[`${prefix}.residentialAddress`],
        [`${prefix}.correspondenceSameAsResidential`, `${prefix}.residentialAddress`],
        'replace',
      )
    }
  }

  for (const index of APPLICANT_INDEXES) {
    const sourceKey = `applicants.${index}.sharedHouseholdWithApplicantNumber`
    const referencedApplicants = String(values[sourceKey] ?? '')
      .split(/[^0-9]+/u)
      .filter(Boolean)
      .map(Number)
      .filter(displayIndex => displayIndex >= 1 && displayIndex <= APPLICANT_INDEXES.length)
    if (referencedApplicants.length !== 1) continue
    const referencedIndex = referencedApplicants[0]! - 1
    if (referencedIndex === index) continue
    derive(
      `applicants.${referencedIndex}.sharedHouseholdWithApplicantNumber`,
      String(index + 1),
      [sourceKey],
      'conflict',
    )
  }

  const ownFundKeys = [
    'investment.ownFundsPaid',
    'investment.ownFundsBeforeDisbursement',
    'investment.ownFundsDuringInvestment',
  ] as const
  if (ownFundKeys.some(key => !isMissing(values[key]))) {
    const parts = ownFundKeys.map(key => numeric(values[key]))
    if (parts.every((part): part is number => part !== null)) {
      derive('investment.ownFunds', parts.reduce((sum, part) => sum + part, 0), ownFundKeys, 'conflict')
    }
  }

  const applicantIndex = Number(values['additionalProducts.creditCardApplicantIndex'])
  if (Number.isInteger(applicantIndex) && applicantIndex >= 0 && applicantIndex < APPLICANT_INDEXES.length) {
    const firstNameKey = `applicants.${applicantIndex}.firstName`
    const lastNameKey = `applicants.${applicantIndex}.lastName`
    const name = [values[firstNameKey], values[lastNameKey]].filter(value => !isMissing(value)).join(' ').trim()
    derive(
      'additionalProducts.creditCardApplicant',
      name,
      ['additionalProducts.creditCardApplicantIndex', firstNameKey, lastNameKey],
      'replace',
    )
  }

  const buyerKeys = APPLICANT_INDEXES.flatMap(index => [
    `applicants.${index}.firstName`,
    `applicants.${index}.lastName`,
  ])
  const buyers = APPLICANT_INDEXES.map(index => (
    [values[`applicants.${index}.firstName`], values[`applicants.${index}.lastName`]]
      .filter(value => !isMissing(value))
      .join(' ')
      .trim()
  )).filter(Boolean)
  if (buyers.length) derive('investor.buyerDetails', buyers.join(', '), buyerKeys, 'fallback')

  derive(
    'consents.creditDecisionEmail',
    values['applicants.0.email'],
    ['applicants.0.email'],
    'fallback',
  )

  if (String(values['collateralProperty.sameAsFinancedProperty'] ?? '') === 'true') {
    const targetKeys = [
      'collateralProperty.type',
      'collateralProperty.typeOther',
      'collateralProperty.address',
      'collateralProperty.address.city',
      'collateralProperty.address.voivodeship',
      'collateralProperty.address.county',
      'collateralProperty.address.municipality',
      'collateralProperty.address.district',
      'collateralProperty.address.postalCode',
      'collateralProperty.address.street',
      'collateralProperty.address.houseAndUnit',
      'collateralProperty.usableArea',
      'collateralProperty.constructionYear',
      'collateralProperty.marketValue',
      'collateralProperty.landRegisterNumber',
    ]
    for (const targetKey of targetKeys) {
      const sourceKey = propertySourceKey(targetKey)
      if (!sourceKey) continue
      const derivedValue = sourceKey === 'property.address.full'
        ? fullPropertyAddress(values)
        : sourceKey === 'property.address.houseAndUnit'
          ? propertyHouseAndUnit(values)
          : values[sourceKey]
      derive(targetKey, derivedValue, canonicalDerivationDependenciesForKey(targetKey), 'replace')
    }
  }

  if (values['collateralProperties.0.relationshipToFinancedProperty'] === 'financed') {
    derive(
      'collateralProperties.0.landRegisterNumber',
      values['property.landRegisterNumber'],
      ['collateralProperties.0.relationshipToFinancedProperty', 'property.landRegisterNumber'],
      'replace',
    )
    if (!isMissing(values['property.landRegisterNumber'])) {
      derive(
        'collateralProperties.0.hasLandRegister',
        true,
        ['collateralProperties.0.relationshipToFinancedProperty', 'property.landRegisterNumber'],
        'replace',
      )
    }
  }

  const liabilityInstallments = LIABILITY_INDEXES
    .map(index => numeric(values[`liabilities.${index}.installmentAmount`]))
    .filter((value): value is number => value !== null)
  if (liabilityInstallments.length) {
    derive(
      'households.0.monthlyDebtInstallments',
      liabilityInstallments.reduce((sum, value) => sum + value, 0),
      canonicalDerivationDependenciesForKey('households.0.monthlyDebtInstallments'),
      'conflict',
    )
  }
  const liabilityOutstanding = LIABILITY_INDEXES
    .map(index => numeric(values[`liabilities.${index}.outstandingAmount`]))
    .filter((value): value is number => value !== null)
  if (liabilityOutstanding.length) {
    derive(
      'households.0.outstandingDebt',
      liabilityOutstanding.reduce((sum, value) => sum + value, 0),
      canonicalDerivationDependenciesForKey('households.0.outstandingDebt'),
      'conflict',
    )
  }

  const interestToRisk: Record<string, string> = {
    variable: 'variable_interest',
    periodically_fixed: 'periodically_fixed',
    indexed: 'currency_indexed',
  }
  derive(
    'declarations.selectedLoanRiskVariant',
    interestToRisk[String(values['loan.interestType'] ?? '')],
    ['loan.interestType'],
    'fallback',
  )
  return { values, metadata, issues }
}
