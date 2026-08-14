import type {
  CanonicalCollectionDefinition,
  CanonicalComputedBindingDefinition,
  CanonicalFieldDefinition,
  CanonicalFieldType,
} from './types.ts'
export {
  BUSINESS_COMPANY_CANONICAL_KEYS,
  BUSINESS_COMPANY_FORM_CANONICAL_KEYS,
  BUSINESS_COMPANY_RELATIVE_KEYS,
} from './business-company-fields.ts'

const PURPOSE_OPTIONS = [
  { value: 'purchase_primary', label: 'Zakup na rynku pierwotnym' },
  { value: 'purchase_secondary', label: 'Zakup na rynku wtórnym' },
  { value: 'construction', label: 'Budowa domu' },
  { value: 'renovation', label: 'Remont lub wykończenie' },
  { value: 'refinancing', label: 'Refinansowanie lub spłata kredytu' },
  { value: 'repayment_other_bank', label: 'Spłata kredytu mieszkaniowego w innym banku' },
  { value: 'arbitrary_purpose', label: 'Cel dowolny' },
  { value: 'other', label: 'Inny cel' },
  { value: 'family_purchase_primary', label: 'Rodzinny kredyt: zakup na rynku pierwotnym' },
  { value: 'family_purchase_secondary', label: 'Rodzinny kredyt: zakup na rynku wtórnym' },
  { value: 'family_construction', label: 'Rodzinny kredyt: budowa domu' },
  { value: 'family_renovation', label: 'Rodzinny kredyt: remont lub wykończenie' },
  { value: 'mortgage_loan', label: 'Pożyczka hipoteczna' },
  { value: 'finishing', label: 'Wykończenie lub wyposażenie' },
  { value: 'extension', label: 'Nadbudowa lub rozbudowa' },
  { value: 'conversion_to_residential', label: 'Przebudowa na cele mieszkalne' },
  { value: 'purchase_land', label: 'Zakup nieruchomości gruntowej' },
  { value: 'convert_cooperative_right', label: 'Przekształcenie prawa lokatorskiego w odrębną własność' },
  { value: 'municipal_purchase', label: 'Wykup mieszkania komunalnego lub zakładowego' },
  { value: 'garage_purchase', label: 'Zakup garażu lub miejsca postojowego' },
  { value: 'acquire_rights_from_individual', label: 'Nabycie praw od osoby fizycznej' },
  { value: 'purchase_share', label: 'Zakup udziału prowadzący do pełnej własności' },
  { value: 'adaptation_to_residential', label: 'Adaptacja pomieszczenia na cele mieszkalne' },
  { value: 'purchase_with_renovation', label: 'Zakup wraz z remontem lub modernizacją' },
  { value: 'acquire_construction_rights', label: 'Nabycie praw do inwestycji w budowie' },
  { value: 'refinance_with_renovation_no_permit', label: 'Refinansowanie z remontem bez pozwolenia' },
  { value: 'refinance_with_renovation_permit', label: 'Refinansowanie z remontem wymagającym pozwolenia' },
  { value: 'share_purchase_with_renovation_no_permit', label: 'Zakup udziału z remontem bez pozwolenia' },
  { value: 'share_purchase_with_renovation_permit', label: 'Zakup udziału z remontem wymagającym pozwolenia' },
] as const

const COMMISSION_OPTIONS = [
  { value: 'financed', label: 'Kredytowana' },
  { value: 'not_financed', label: 'Niekredytowana' },
  { value: 'not_applicable', label: 'Nie dotyczy' },
] as const

const LOAN_PRODUCT_OPTIONS = [
  { value: 'mortgage', label: 'Kredyt hipoteczny lub mieszkaniowy' },
  { value: 'construction_mortgage', label: 'Kredyt budowlano-hipoteczny' },
  { value: 'mortgage_loan', label: 'Pożyczka hipoteczna' },
  { value: 'other', label: 'Inny produkt kredytowy' },
] as const

const LOAN_PRODUCT_VARIANT_OPTIONS = [
  { value: 'own_home_mortgage', label: 'PKO BP Własny Kąt hipoteczny' },
  { value: 'mix_mortgage', label: 'PKO BP MIX' },
] as const

const REPAYMENT_ACCOUNT_OPTIONS = [
  { value: 'existing_personal_account', label: 'Posiadany rachunek osobisty' },
  { value: 'new_personal_account', label: 'Nowy rachunek osobisty' },
  { value: 'technical_account', label: 'Rachunek techniczny' },
] as const

const COLLATERAL_RELATIONSHIP_OPTIONS = [
  { value: 'financed', label: 'Nieruchomość kredytowana' },
  { value: 'other', label: 'Inna nieruchomość' },
] as const

const PUBLIC_ROAD_ACCESS_OPTIONS = [
  { value: 'direct', label: 'Bezpośredni dostęp' },
  { value: 'easement', label: 'Poprzez służebność drogową' },
  { value: 'road_property_share', label: 'Poprzez udział w nieruchomości drogowej' },
] as const

const APPRAISER_OPTIONS = [
  { value: 'bank_partner_network', label: 'Rzeczoznawca ze współpracującej sieci banku' },
  { value: 'other', label: 'Inny rzeczoznawca' },
] as const

const PROPERTY_OWNERSHIP_OPTIONS = [
  { value: 'apartment_ownership', label: 'Własność lokalu' },
  { value: 'house_ownership', label: 'Własność domu' },
  { value: 'land_right', label: 'Prawo do gruntu' },
  { value: 'cooperative_ownership_right', label: 'Spółdzielcze własnościowe prawo' },
  { value: 'municipal_or_company', label: 'Prawo komunalne lub zakładowe' },
] as const

const YES_NO_NOT_APPLICABLE_OPTIONS = [
  { value: 'yes', label: 'Tak' },
  { value: 'no', label: 'Nie' },
  { value: 'not_applicable', label: 'Nie dotyczy' },
] as const

const PROPERTY_OWNERSHIP_SEQUENCE_OPTIONS = [
  { value: 'first', label: 'Pierwsza nabywana nieruchomość' },
  { value: 'next', label: 'Kolejna nabywana nieruchomość' },
] as const

const MORTGAGE_ESTABLISHMENT_OPTIONS = [
  { value: 'notarial_deed', label: 'Akt notarialny' },
  { value: 'banking_law_article_95', label: 'Oświadczenie banku na podstawie art. 95 Prawa bankowego' },
] as const

const APPRAISAL_SOURCE_OPTIONS = [
  { value: 'bank_provider', label: 'Wycena zlecona przez bank' },
  { value: 'self_provided', label: 'Wycena dostarczona przez klienta' },
] as const

const LOAN_RISK_VARIANT_OPTIONS = [
  { value: 'variable_interest', label: 'Kredyt ze zmienną stopą procentową' },
  { value: 'currency_indexed', label: 'Kredyt indeksowany do waluty obcej' },
  { value: 'periodically_fixed', label: 'Kredyt z okresowo stałą stopą procentową' },
] as const

const MORTGAGE_SETTLEMENT_OPTIONS = [
  { value: 'paid_docs_delivered', label: 'Spłacona, dokumenty do wykreślenia dostarczone' },
  { value: 'paid_docs_not_delivered', label: 'Spłacona, dokumenty do wykreślenia niedostarczone' },
  { value: 'repay_own_funds', label: 'Spłata ze środków własnych' },
  { value: 'repay_credit', label: 'Spłata z kredytu' },
  { value: 'repay_own_and_credit', label: 'Spłata ze środków własnych i kredytu' },
  { value: 'not_repaid', label: 'Nie zostanie spłacona' },
] as const

const SUBMISSION_CHANNEL_OPTIONS = [
  { value: 'branch', label: 'Oddział banku' },
  { value: 'intermediary', label: 'Pośrednik' },
  { value: 'agent_or_partner', label: 'Agent lub placówka partnerska' },
] as const

const INTERMEDIARY_KIND_OPTIONS = [
  { value: 'intermediary_or_partner', label: 'Pośrednik lub placówka partnerska' },
  { value: 'bank_agent', label: 'Agent banku' },
] as const

const CONSTRUCTION_METHOD_OPTIONS = [
  { value: 'self_performed', label: 'System gospodarczy' },
  { value: 'developer_or_cooperative', label: 'Deweloper lub spółdzielnia' },
] as const

const RENOVATION_PERMIT_OPTIONS = [
  { value: 'required', label: 'Remont wymagający pozwolenia na budowę' },
  { value: 'not_required', label: 'Remont niewymagający pozwolenia na budowę' },
] as const

const INSTALLMENT_OPTIONS = [
  { value: 'equal', label: 'Raty równe' },
  { value: 'decreasing', label: 'Raty malejące' },
] as const

const INTEREST_OPTIONS = [
  { value: 'periodically_fixed', label: 'Okresowo stałe' },
  { value: 'variable', label: 'Zmienne' },
] as const

const DISBURSEMENT_OPTIONS = [
  { value: 'single', label: 'Jednorazowo' },
  { value: 'tranches', label: 'W transzach' },
] as const

const INVESTOR_PAYMENT_TIMING_OPTIONS = [
  { value: 'before_notarial_deed', label: 'Przed aktem notarialnym przeniesienia własności' },
  { value: 'after_notarial_deed', label: 'Po akcie notarialnym przeniesienia własności' },
] as const

const PROPERTY_TYPE_OPTIONS = [
  { value: 'house', label: 'Dom' },
  { value: 'apartment', label: 'Mieszkanie' },
  { value: 'plot', label: 'Działka' },
  { value: 'garage', label: 'Garaż' },
  { value: 'parking_space', label: 'Miejsce postojowe' },
  { value: 'agricultural_land', label: 'Grunty rolne' },
  { value: 'multi_family_building', label: 'Dom wielomieszkaniowy' },
  { value: 'recreational_plot', label: 'Działka rekreacyjna' },
  { value: 'other', label: 'Inna nieruchomość' },
] as const

const PEKAO_FINISH_STANDARD_OPTIONS = [
  { value: 'developer', label: 'Deweloperski' },
  { value: 'standard', label: 'Średni' },
  { value: 'enhanced', label: 'Podwyższony' },
  { value: 'high', label: 'Wysoki' },
] as const

const BUILDING_FORM_OPTIONS = [
  { value: 'detached', label: 'Wolnostojąca' },
  { value: 'semi_detached', label: 'Bliźniacza' },
  { value: 'terraced', label: 'Szeregowa' },
] as const

const MARITAL_STATUS_OPTIONS = [
  { value: 'single', label: 'Panna lub kawaler' },
  { value: 'married', label: 'Mężatka lub żonaty' },
  { value: 'divorced', label: 'Rozwiedziona lub rozwiedziony' },
  { value: 'separated', label: 'Separacja' },
  { value: 'widowed', label: 'Wdowa lub wdowiec' },
] as const

const GENDER_OPTIONS = [
  { value: 'female', label: 'Kobieta' },
  { value: 'male', label: 'Mężczyzna' },
] as const


const HOUSING_STATUS_OPTIONS = [
  { value: 'cooperative_tenancy', label: 'Spółdzielcze lokatorskie' },
  { value: 'municipal_or_tbs', label: 'Mieszkanie komunalne lub TBS' },
  { value: 'owner', label: 'Własność' },
  { value: 'cooperative_ownership', label: 'Spółdzielcze własnościowe' },
  { value: 'rental', label: 'Najem' },
  { value: 'with_family', label: 'Przy rodzinie' },
  { value: 'other', label: 'Inne' },
] as const

const EDUCATION_OPTIONS = [
  { value: 'primary', label: 'Podstawowe' },
  { value: 'vocational', label: 'Zawodowe' },
  { value: 'secondary', label: 'Średnie' },
  { value: 'bachelor', label: 'Licencjat' },
  { value: 'higher', label: 'Wyższe' },
  { value: 'other', label: 'Inne' },
] as const

const EMPLOYMENT_CATEGORY_OPTIONS = [
  { value: 'public_budget', label: 'Sfera budżetowa' },
  { value: 'local_or_state_admin', label: 'Administracja lokalna lub państwowa' },
  { value: 'state_enterprise', label: 'Przedsiębiorstwo państwowe' },
  { value: 'joint_stock_company', label: 'Spółka akcyjna' },
  { value: 'limited_liability_company', label: 'Spółka z o.o.' },
  { value: 'private_enterprise', label: 'Pozostałe przedsiębiorstwo prywatne' },
  { value: 'cooperative', label: 'Spółdzielnia' },
  { value: 'freelance', label: 'Wolny zawód' },
  { value: 'farmer', label: 'Rolnik' },
  { value: 'pensioner', label: 'Emeryt lub rencista' },
  { value: 'student', label: 'Student' },
  { value: 'unemployed', label: 'Bezrobotny' },
  { value: 'other', label: 'Inne' },
  { value: 'self_employed', label: 'Własna działalność gospodarcza' },
] as const

const INCOME_SOURCE_OPTIONS = [
  { value: 'employment', label: 'Umowa o pracę' },
  { value: 'business', label: 'Działalność gospodarcza' },
  { value: 'civil_contract', label: 'Umowa cywilnoprawna' },
  { value: 'retirement', label: 'Emerytura lub renta' },
  { value: 'rental', label: 'Najem' },
  { value: 'foreign', label: 'Dochód zagraniczny' },
  { value: 'other', label: 'Inne źródło' },
] as const

const EMPLOYMENT_CONTRACT_DURATION_OPTIONS = [
  { value: 'indefinite', label: 'Na czas nieokreślony' },
  { value: 'fixed_term', label: 'Na czas określony' },
] as const

const SALARY_PAYMENT_METHOD_OPTIONS = [
  { value: 'bank_transfer', label: 'Przelewem na konto' },
  { value: 'cash', label: 'W gotówce' },
] as const

const EMPLOYMENT_TENURE_OPTIONS = [
  { value: 'up_to_6_months', label: 'Do 6 miesięcy' },
  { value: 'up_to_1_year', label: 'Do 1 roku' },
  { value: 'up_to_2_years', label: 'Do 2 lat' },
  { value: 'up_to_5_years', label: 'Do 5 lat' },
  { value: 'up_to_10_years', label: 'Do 10 lat' },
  { value: 'over_10_years', label: 'Powyżej 10 lat' },
] as const

const APPLICANT_LIABILITY_TYPE_OPTIONS = [
  { value: 'obligation', label: 'Zobowiązanie' },
  { value: 'guarantee', label: 'Poręczenie' },
  { value: 'secured_obligation', label: 'Zobowiązanie zabezpieczone' },
] as const

const APPLICANT_LIABILITY_PRODUCT_OPTIONS = [
  { value: 'consumer_credit', label: 'Kredyt konsumpcyjny' },
  { value: 'mortgage_secured_credit', label: 'Kredyt zabezpieczony hipoteką' },
  { value: 'business', label: 'Finansowanie działalności gospodarczej' },
] as const

const APPLICANT_LIABILITY_PARTY_OPTIONS = [
  { value: 'applicant', label: 'Wnioskodawca' },
  { value: 'spouse', label: 'Współmałżonek' },
] as const

type SemanticFieldInput<TCanonicalKey extends string> = Omit<
  CanonicalFieldDefinition,
  'canonicalKey' | 'form' | 'semanticDescription' | 'semanticRole' | 'aiMappingHints'
> & {
  canonicalKey: TCanonicalKey
  question: string
  helpText?: string
  semanticDescription: string
  semanticRole: string
  aliases?: readonly string[]
  exclude?: readonly string[]
}

function defineField<TCanonicalKey extends string>(
  input: SemanticFieldInput<TCanonicalKey>,
): CanonicalFieldDefinition & { canonicalKey: TCanonicalKey } {
  const {
    question,
    helpText,
    semanticDescription,
    semanticRole,
    aliases = [],
    exclude = [],
    ...field
  } = input

  return {
    ...field,
    form: {
      question,
      ...(helpText ? { helpText } : {}),
    },
    semanticDescription,
    semanticRole,
    aiMappingHints: {
      aliases: [...new Set([field.label, ...aliases])],
      exclude: [...new Set(exclude)],
    },
  }
}

type CompactFieldInput<TCanonicalKey extends string> = Omit<
  SemanticFieldInput<TCanonicalKey>,
  'question' | 'semanticDescription' | 'semanticRole' | 'aliases' | 'exclude'
> & {
  question?: string
  semanticDescription?: string
  semanticRole?: string
  aliases?: readonly string[]
  exclude?: readonly string[]
}

function defineCompactField<const TCanonicalKey extends string>(
  input: CompactFieldInput<TCanonicalKey>,
): CanonicalFieldDefinition & { canonicalKey: TCanonicalKey } {
  const {
    question,
    semanticDescription,
    semanticRole,
    aliases,
    exclude,
    ...field
  } = input

  return defineField({
    ...field,
    question: question ?? field.label,
    semanticDescription: semanticDescription ?? `${field.label} podawane przez klienta na potrzeby formularza bankowego.`,
    semanticRole: semanticRole ?? `mortgageApplication.${field.canonicalKey}`,
    aliases: aliases ?? [field.label],
    exclude: exclude ?? [],
  })
}

export const APPLICANT_INDEXES = [0, 1, 2, 3, 4] as const
export const MAX_APPLICANTS = APPLICANT_INDEXES.length
const APPLICANT_REFERENCE_OPTIONS = APPLICANT_INDEXES.map(index => ({
  value: String(index),
  label: `Wnioskodawca ${index + 1}`,
}))
export const TRANCHE_INDEXES = [0, 1, 2, 3, 4, 5] as const
export const INVESTOR_PAYMENT_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7] as const
export const HOUSEHOLD_INDEXES = [0, 1, 2] as const
export const LIABILITY_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export const MORTGAGE_DISCHARGE_INDEXES = [0, 1, 2, 3] as const
export const COLLATERAL_PROPERTY_INDEXES = [0, 1, 2] as const

type ApplicantIndex = typeof APPLICANT_INDEXES[number]
type ApplicantRelativeKey = 'firstName' | 'lastName' | 'pesel'
type ApplicantCanonicalFieldKey = `applicants.${ApplicantIndex}.${ApplicantRelativeKey}`
type ApplicantComputedBindingKey = `applicants.${ApplicantIndex}.fullName`

const APPLICANT_ORDINAL_GENITIVE = [
  'pierwszego',
  'drugiego',
  'trzeciego',
  'czwartego',
  'piątego',
] as const

interface ApplicantFieldBlueprint {
  relativeKey: ApplicantRelativeKey
  label: string
  questionNoun: string
  type: CanonicalFieldType
  semanticRole: string
  aliases: readonly string[]
  exclude: readonly string[]
  helpText: string
  semanticDescription: (displayIndex: number) => string
  validation?: CanonicalFieldDefinition['validation']
}

const APPLICANT_FIELD_BLUEPRINTS = [
  {
    relativeKey: 'firstName',
    label: 'Imię',
    questionNoun: 'imię',
    type: 'text',
    semanticRole: 'person.name.given',
    aliases: ['imię wnioskodawcy', 'pierwsze imię'],
    exclude: ['nazwisko', 'imię ojca', 'imię matki', 'nazwa firmy'],
    helpText: 'Podaj imię dokładnie tak, jak widnieje w dokumencie tożsamości tej osoby.',
    semanticDescription: displayIndex => `Imię osoby występującej jako wnioskodawca nr ${displayIndex}.`,
  },
  {
    relativeKey: 'lastName',
    label: 'Nazwisko',
    questionNoun: 'nazwisko',
    type: 'text',
    semanticRole: 'person.name.family',
    aliases: ['nazwisko wnioskodawcy', 'nazwisko rodowe'],
    exclude: ['imię', 'nazwisko małżonka', 'nazwa firmy'],
    helpText: 'Podaj nazwisko dokładnie tak, jak widnieje w dokumencie tożsamości tej osoby.',
    semanticDescription: displayIndex => `Nazwisko osoby występującej jako wnioskodawca nr ${displayIndex}.`,
  },
  {
    relativeKey: 'pesel',
    label: 'PESEL',
    questionNoun: 'PESEL',
    type: 'text',
    semanticRole: 'person.identifier.pesel',
    aliases: ['PESEL', 'nr PESEL', 'numer PESEL'],
    exclude: ['NIP', 'REGON', 'numer dowodu', 'numer paszportu'],
    helpText: '11-cyfrowy numer PESEL tej osoby.',
    semanticDescription: displayIndex => `Polski numer PESEL osoby występującej jako wnioskodawca nr ${displayIndex}.`,
    validation: { pattern: '^\\d{11}$' },
  },
] as const satisfies readonly ApplicantFieldBlueprint[]

function materializeApplicantField(
  index: ApplicantIndex,
  blueprint: ApplicantFieldBlueprint,
): CanonicalFieldDefinition & { canonicalKey: ApplicantCanonicalFieldKey } {
  const displayIndex = index + 1
  const ordinal = APPLICANT_ORDINAL_GENITIVE[index]
  return defineField({
    canonicalKey: `applicants.${index}.${blueprint.relativeKey}` as ApplicantCanonicalFieldKey,
    label: `${blueprint.label} — wnioskodawca ${displayIndex}`,
    type: blueprint.type,
    group: 'applicants',
    question: `Podaj ${blueprint.questionNoun} ${ordinal} wnioskodawcy`,
    helpText: blueprint.helpText,
    semanticDescription: blueprint.semanticDescription(displayIndex),
    semanticRole: blueprint.semanticRole,
    aliases: [
      ...blueprint.aliases,
      `${blueprint.label} wnioskodawcy ${displayIndex}`,
      `wnioskodawca ${displayIndex} ${blueprint.label}`,
    ],
    exclude: [
      ...blueprint.exclude,
      `${blueprint.label} innego wnioskodawcy`,
    ],
    collection: {
      key: 'applicants',
      index,
      displayIndex,
      relativeKey: blueprint.relativeKey,
      label: blueprint.label,
    },
    ...(blueprint.validation ? { validation: blueprint.validation } : {}),
  })
}

function materializeApplicantFullName(
  index: ApplicantIndex,
): CanonicalComputedBindingDefinition & { canonicalKey: ApplicantComputedBindingKey } {
  const displayIndex = index + 1
  return {
    canonicalKey: `applicants.${index}.fullName`,
    label: `Imię i nazwisko — wnioskodawca ${displayIndex}`,
    type: 'text',
    group: 'applicants',
    semanticDescription: `Pełne imię i nazwisko osoby występującej jako wnioskodawca nr ${displayIndex}, wyliczane z oddzielnych danych imienia i nazwiska.`,
    semanticRole: 'person.name.full',
    aiMappingHints: {
      aliases: [
        'imię i nazwisko',
        `imię i nazwisko wnioskodawcy ${displayIndex}`,
        `wnioskodawca ${displayIndex} imię i nazwisko`,
      ],
      exclude: ['samo imię', 'samo nazwisko', 'nazwa firmy', 'pełnomocnik'],
    },
    collection: {
      key: 'applicants',
      index,
      displayIndex,
      relativeKey: 'fullName',
      label: 'Imię i nazwisko',
    },
    computed: true,
    valueFrom: [
      `applicants.${index}.firstName`,
      `applicants.${index}.lastName`,
    ],
    valueFormat: 'fullName',
  }
}

function materializeApplicantAverageNetIncomeInWords(
  index: ApplicantIndex,
): CanonicalComputedBindingDefinition {
  const displayIndex = index + 1
  return {
    canonicalKey: `applicants.${index}.averageNetIncomeInWords`,
    label: `Wynagrodzenie netto słownie — wnioskodawca ${displayIndex}`,
    type: 'text',
    group: 'applicants',
    semanticDescription: `Średnie wynagrodzenie netto wnioskodawcy nr ${displayIndex} zapisane słownie i wyliczane z kwoty oraz waluty.`,
    semanticRole: 'person.income.averageNet.words',
    aiMappingHints: {
      aliases: ['wynagrodzenie netto słownie', 'dochód słownie'],
      exclude: ['kwota wynagrodzenia cyframi'],
    },
    collection: {
      key: 'applicants',
      index,
      displayIndex,
      relativeKey: 'averageNetIncomeInWords',
      label: 'Wynagrodzenie netto słownie',
    },
    computed: true,
    valueFrom: [
      `applicants.${index}.averageNetIncome`,
      `applicants.${index}.incomeCurrency`,
    ],
    valueFormat: 'currency.words',
  }
}

export const CANONICAL_COLLECTIONS = [
  {
    key: 'applicants',
    label: 'Wnioskodawcy',
    itemLabel: 'Wnioskodawca',
    minItems: 1,
    maxItems: MAX_APPLICANTS,
    requiredRelativeKeys: [
      'firstName',
      'lastName',
      'pesel',
      'targetPropertyOwner',
      'willOccupyFinancedProperty',
      'lifeInsuranceSelected',
      'postContractDataProcessingConsent',
    ],
  },
  {
    key: 'tranches',
    label: 'Planowane transze',
    itemLabel: 'Transza',
    minItems: 1,
    maxItems: TRANCHE_INDEXES.length,
    requiredRelativeKeys: ['date', 'amount', 'accountOwner'],
  },
  {
    key: 'investorPayments',
    label: 'Harmonogram płatności inwestorowi',
    itemLabel: 'Płatność',
    minItems: 1,
    maxItems: INVESTOR_PAYMENT_INDEXES.length,
    requiredRelativeKeys: ['date', 'amount', 'purpose'],
  },
  {
    key: 'households',
    label: 'Gospodarstwa domowe',
    itemLabel: 'Gospodarstwo',
    minItems: 1,
    maxItems: HOUSEHOLD_INDEXES.length,
    requiredRelativeKeys: [
      'monthlyDebtInstallments',
      'outstandingDebt',
      'otherFixedExpenses',
      'externalCreditLimits',
      'householdExpenses',
    ],
  },
  {
    key: 'liabilities',
    label: 'Zobowiązania przeznaczone do spłaty',
    itemLabel: 'Zobowiązanie',
    minItems: 0,
    maxItems: LIABILITY_INDEXES.length,
    requiredRelativeKeys: [],
  },
  {
    key: 'mortgageDischarges',
    label: 'Obciążenia hipoteczne',
    itemLabel: 'Hipoteka',
    minItems: 0,
    maxItems: MORTGAGE_DISCHARGE_INDEXES.length,
    requiredRelativeKeys: [],
  },
  {
    key: 'collateralProperties',
    label: 'Nieruchomości pod hipotekę',
    itemLabel: 'Nieruchomość',
    minItems: 1,
    maxItems: COLLATERAL_PROPERTY_INDEXES.length,
    requiredRelativeKeys: ['relationshipToFinancedProperty', 'hasLandRegister'],
  },
] as const satisfies readonly CanonicalCollectionDefinition[]

const APPLICATION_FIELDS = [
  defineField({
    canonicalKey: 'application.place',
    label: 'Miejscowość złożenia wniosku',
    type: 'text',
    group: 'application',
    question: 'Podaj miejscowość, w której składany jest wniosek',
    helpText: 'Nie podawaj miejscowości zamieszkania wnioskodawcy ani położenia nieruchomości.',
    semanticDescription: 'Miejscowość, w której wniosek jest podpisywany lub formalnie składany w instytucji.',
    semanticRole: 'application.submission.place',
    aliases: ['miejsce złożenia wniosku', 'miejscowość i data', 'sporządzono w'],
    exclude: ['miejsce zamieszkania', 'adres korespondencyjny', 'miejscowość nieruchomości', 'miejsce urodzenia'],
  }),
  defineField({
    canonicalKey: 'application.date',
    label: 'Data złożenia wniosku',
    type: 'date',
    group: 'application',
    question: 'Podaj datę złożenia wniosku',
    helpText: 'Data podpisania lub formalnego przekazania wniosku do instytucji.',
    semanticDescription: 'Data, w której wniosek jest podpisywany lub formalnie składany.',
    semanticRole: 'application.submission.date',
    aliases: ['data wniosku', 'data złożenia', 'dnia'],
    exclude: ['data urodzenia', 'data zawarcia umowy', 'data wypłaty'],
  }),
] as const

const APPLICANT_FIELDS = APPLICANT_INDEXES.flatMap(index => (
  APPLICANT_FIELD_BLUEPRINTS.map(blueprint => materializeApplicantField(index, blueprint))
))

const KIK_APPLICANT_FIELD_BLUEPRINTS = [
  { relativeKey: 'middleName', label: 'Drugie imię', type: 'text' },
  { relativeKey: 'birthDate', label: 'Data urodzenia', type: 'date' },
  { relativeKey: 'gender', label: 'Płeć', type: 'select', options: GENDER_OPTIONS },
  { relativeKey: 'identityDocumentType', label: 'Typ dokumentu tożsamości', type: 'text' },
  { relativeKey: 'identityDocumentNumber', label: 'Seria i numer dokumentu tożsamości', type: 'text' },
  { relativeKey: 'birthPlace', label: 'Miejsce urodzenia', type: 'text' },
  { relativeKey: 'countryOfResidence', label: 'Kraj zamieszkania', type: 'text' },
  { relativeKey: 'citizenship', label: 'Obywatelstwo', type: 'text' },
  { relativeKey: 'phone', label: 'Numer telefonu', type: 'text' },
  { relativeKey: 'email', label: 'Adres e-mail', type: 'text', validation: { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' } },
  { relativeKey: 'residentialAddress', label: 'Adres zamieszkania', type: 'text' },
  { relativeKey: 'correspondenceSameAsResidential', label: 'Adres korespondencyjny taki sam jak zamieszkania', type: 'boolean' },
  {
    relativeKey: 'correspondenceAddress',
    label: 'Adres do korespondencji',
    type: 'text',
    visibleWhen: { relativeKey: 'correspondenceSameAsResidential', equals: 'false' },
  },
  { relativeKey: 'maritalStatus', label: 'Stan cywilny', type: 'select', options: MARITAL_STATUS_OPTIONS },
  { relativeKey: 'maritalPropertyCommunity', label: 'Wspólność majątkowa', type: 'boolean', visibleWhen: { relativeKey: 'maritalStatus', equals: 'married' } },
  { relativeKey: 'housingStatus', label: 'Status mieszkaniowy', type: 'select', options: HOUSING_STATUS_OPTIONS },
  { relativeKey: 'ownsMultiFamilyHouse', label: 'Posiada dom wielorodzinny', type: 'boolean' },
  { relativeKey: 'ownsSingleFamilyHouse', label: 'Posiada dom jednorodzinny', type: 'boolean' },
  { relativeKey: 'ownsApartment', label: 'Posiada mieszkanie', type: 'boolean' },
  { relativeKey: 'ownsPlot', label: 'Posiada działkę', type: 'boolean' },
  { relativeKey: 'ownsOtherProperty', label: 'Posiada inną nieruchomość', type: 'boolean' },
  { relativeKey: 'householdSize', label: 'Liczba osób w gospodarstwie domowym', type: 'number', validation: { min: 1, integer: true } },
  { relativeKey: 'childBenefitCount', label: 'Liczba dzieci objętych świadczeniem Rodzina 800+', type: 'number', validation: { min: 0, integer: true } },
  { relativeKey: 'childBenefitBirthDate1', label: 'Miesiąc i rok urodzenia dziecka 800+ — 1', type: 'text', visibleWhen: { relativeKey: 'childBenefitCount', equals: ['1', '2', '3', '4', '5', '6'] } },
  { relativeKey: 'childBenefitBirthDate2', label: 'Miesiąc i rok urodzenia dziecka 800+ — 2', type: 'text', visibleWhen: { relativeKey: 'childBenefitCount', equals: ['2', '3', '4', '5', '6'] } },
  { relativeKey: 'childBenefitBirthDate3', label: 'Miesiąc i rok urodzenia dziecka 800+ — 3', type: 'text', visibleWhen: { relativeKey: 'childBenefitCount', equals: ['3', '4', '5', '6'] } },
  { relativeKey: 'childBenefitBirthDate4', label: 'Miesiąc i rok urodzenia dziecka 800+ — 4', type: 'text', visibleWhen: { relativeKey: 'childBenefitCount', equals: ['4', '5', '6'] } },
  { relativeKey: 'childBenefitBirthDate5', label: 'Miesiąc i rok urodzenia dziecka 800+ — 5', type: 'text', visibleWhen: { relativeKey: 'childBenefitCount', equals: ['5', '6'] } },
  { relativeKey: 'childBenefitBirthDate6', label: 'Miesiąc i rok urodzenia dziecka 800+ — 6', type: 'text', visibleWhen: { relativeKey: 'childBenefitCount', equals: '6' } },
  { relativeKey: 'education', label: 'Wykształcenie', type: 'select', options: EDUCATION_OPTIONS },
  { relativeKey: 'occupation', label: 'Wykonywany zawód', type: 'text' },
  { relativeKey: 'employmentCategory', label: 'Kategoria zatrudnienia', type: 'select', options: EMPLOYMENT_CATEGORY_OPTIONS },
  { relativeKey: 'incomeSource', label: 'Główne źródło dochodu', type: 'select', options: INCOME_SOURCE_OPTIONS },
  { relativeKey: 'businessName', label: 'Pełna nazwa firmy', type: 'text', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessNip', label: 'NIP firmy', type: 'text', validation: { pattern: '^\\d{10}$', maxLength: 10 }, visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessRegon', label: 'REGON firmy', type: 'text', validation: { pattern: '^(\\d{9}|\\d{14})$', maxLength: 14 }, visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessCeidgId', label: 'Identyfikator wpisu CEIDG', type: 'text', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessLegalForm', label: 'Forma organizacyjno-prawna działalności', type: 'text', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' } },
  { relativeKey: 'businessStatus', label: 'Status działalności w CEIDG', type: 'text', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessAddress', label: 'Adres wykonywania działalności', type: 'textarea', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessCorrespondenceAddress', label: 'Adres do korespondencji firmy', type: 'textarea', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessStartDate', label: 'Data rozpoczęcia działalności', type: 'date', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessSuspensionDate', label: 'Data zawieszenia działalności', type: 'date', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessResumeDate', label: 'Data wznowienia działalności', type: 'date', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessTerminationDate', label: 'Data zaprzestania działalności', type: 'date', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessRemovalDate', label: 'Data wykreślenia z CEIDG', type: 'date', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'pkdCode', label: 'Główny kod PKD działalności', type: 'text', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' } },
  { relativeKey: 'businessPkdCodes', label: 'Wszystkie kody PKD', type: 'textarea', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessEmail', label: 'Firmowy adres e-mail', type: 'text', validation: { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' }, visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessPhone', label: 'Firmowy numer telefonu', type: 'text', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'businessWebsite', label: 'Strona internetowa firmy', type: 'text', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' }, requiredWhenVisible: false },
  { relativeKey: 'employmentTenure', label: 'Staż pracy', type: 'select', options: EMPLOYMENT_TENURE_OPTIONS },
  { relativeKey: 'businessActiveOrRecentlySuspended', label: 'Prowadzi lub niedawno zawiesił działalność gospodarczą', type: 'boolean', visibleWhen: { relativeKey: 'incomeSource', equals: 'business' } },
  { relativeKey: 'monthlyMaintenanceCosts', label: 'Miesięczne koszty utrzymania', type: 'currency', validation: { min: 0 } },
  { relativeKey: 'alimonyAndLegalBurdens', label: 'Alimenty i inne miesięczne obciążenia prawne', type: 'currency', validation: { min: 0 } },
  { relativeKey: 'collectionProceedings', label: 'Postępowanie windykacyjne', type: 'boolean' },
  { relativeKey: 'collectedDebtAmount', label: 'Kwota windykowanego długu', type: 'currency', validation: { min: 0 }, visibleWhen: { relativeKey: 'collectionProceedings', equals: 'true' } },
] as const

type KikApplicantRelativeKey = typeof KIK_APPLICANT_FIELD_BLUEPRINTS[number]['relativeKey']
type KikApplicantCanonicalFieldKey = `applicants.${ApplicantIndex}.${KikApplicantRelativeKey}`

function materializeKikApplicantField(
  index: ApplicantIndex,
  blueprint: typeof KIK_APPLICANT_FIELD_BLUEPRINTS[number],
): CanonicalFieldDefinition & { canonicalKey: KikApplicantCanonicalFieldKey } {
  const displayIndex = index + 1
  const visibleWhen = 'visibleWhen' in blueprint
    ? {
        canonicalKey: `applicants.${index}.${blueprint.visibleWhen.relativeKey}`,
        equals: blueprint.visibleWhen.equals,
      }
    : undefined
  const requiredWhenVisible = 'requiredWhenVisible' in blueprint
    ? blueprint.requiredWhenVisible
    : true

  return defineCompactField({
    canonicalKey: `applicants.${index}.${blueprint.relativeKey}` as KikApplicantCanonicalFieldKey,
    label: `${blueprint.label} — wnioskodawca ${displayIndex}`,
    type: blueprint.type,
    group: 'applicants',
    question: `${blueprint.label} — wnioskodawca ${displayIndex}`,
    semanticDescription: `${blueprint.label} osoby występującej jako wnioskodawca nr ${displayIndex}, potrzebne do bankowej karty informacyjnej klienta.`,
    semanticRole: `person.${blueprint.relativeKey}`,
    aliases: [blueprint.label, `${blueprint.label} wnioskodawcy ${displayIndex}`],
    collection: {
      key: 'applicants',
      index,
      displayIndex,
      relativeKey: blueprint.relativeKey,
      label: blueprint.label,
    },
    ...('options' in blueprint ? { options: blueprint.options } : {}),
    ...('validation' in blueprint ? { validation: blueprint.validation } : {}),
    ...(visibleWhen
      ? {
          visibleWhen,
          ...(requiredWhenVisible ? { requiredWhen: visibleWhen } : {}),
        }
      : {}),
  })
}

const KIK_APPLICANT_FIELDS = APPLICANT_INDEXES.flatMap(index => (
  KIK_APPLICANT_FIELD_BLUEPRINTS.map(blueprint => materializeKikApplicantField(index, blueprint))
))

const KIK_APPLICANT_LIABILITY_INDEXES = [0, 1, 2, 3, 4] as const
const KIK_APPLICANT_LIABILITY_FIELD_BLUEPRINTS = [
  { relativeKey: 'institution', label: 'Nazwa banku lub instytucji', type: 'text' },
  { relativeKey: 'obligationType', label: 'Typ zobowiązania', type: 'select', options: APPLICANT_LIABILITY_TYPE_OPTIONS },
  { relativeKey: 'productType', label: 'Rodzaj zobowiązania', type: 'select', options: APPLICANT_LIABILITY_PRODUCT_OPTIONS },
  { relativeKey: 'outstandingAmount', label: 'Kwota aktualnego zobowiązania', type: 'currency', validation: { min: 0 } },
  { relativeKey: 'monthlyPayment', label: 'Miesięczna rata zobowiązania', type: 'currency', validation: { min: 0 } },
  { relativeKey: 'currency', label: 'Waluta zobowiązania', type: 'text' },
  { relativeKey: 'burdenedParty', label: 'Osoba obciążona zobowiązaniem', type: 'select', options: APPLICANT_LIABILITY_PARTY_OPTIONS },
] as const

type KikApplicantLiabilityIndex = typeof KIK_APPLICANT_LIABILITY_INDEXES[number]
type KikApplicantLiabilityRelativeKey = typeof KIK_APPLICANT_LIABILITY_FIELD_BLUEPRINTS[number]['relativeKey']
type KikApplicantLiabilityCanonicalFieldKey =
  `applicants.${ApplicantIndex}.liabilities.${KikApplicantLiabilityIndex}.${KikApplicantLiabilityRelativeKey}`

function materializeKikApplicantLiabilityField(
  applicantIndex: ApplicantIndex,
  liabilityIndex: KikApplicantLiabilityIndex,
  blueprint: typeof KIK_APPLICANT_LIABILITY_FIELD_BLUEPRINTS[number],
): CanonicalFieldDefinition & { canonicalKey: KikApplicantLiabilityCanonicalFieldKey } {
  const applicantDisplayIndex = applicantIndex + 1
  const liabilityDisplayIndex = liabilityIndex + 1
  const relativeKey = `liabilities.${liabilityIndex}.${blueprint.relativeKey}`

  return defineCompactField({
    canonicalKey: `applicants.${applicantIndex}.${relativeKey}` as KikApplicantLiabilityCanonicalFieldKey,
    label: `${blueprint.label} — wnioskodawca ${applicantDisplayIndex}, zobowiązanie ${liabilityDisplayIndex}`,
    type: blueprint.type,
    group: 'liabilities',
    semanticDescription: `${blueprint.label} w pozycji ${liabilityDisplayIndex} indywidualnej karty informacyjnej wnioskodawcy nr ${applicantDisplayIndex}.`,
    semanticRole: `person.liabilities.${blueprint.relativeKey}`,
    collection: {
      key: 'applicants',
      index: applicantIndex,
      displayIndex: applicantDisplayIndex,
      relativeKey,
      label: `${blueprint.label} — zobowiązanie ${liabilityDisplayIndex}`,
    },
    ...('options' in blueprint ? { options: blueprint.options } : {}),
    ...('validation' in blueprint ? { validation: blueprint.validation } : {}),
  })
}

const KIK_APPLICANT_LIABILITY_FIELDS = APPLICANT_INDEXES.flatMap(applicantIndex => (
  KIK_APPLICANT_LIABILITY_INDEXES.flatMap(liabilityIndex => (
    KIK_APPLICANT_LIABILITY_FIELD_BLUEPRINTS.map(blueprint => (
      materializeKikApplicantLiabilityField(applicantIndex, liabilityIndex, blueprint)
    ))
  ))
))

const INCOME_APPLICANT_FIELD_BLUEPRINTS = [
  { relativeKey: 'employerName', label: 'Nazwa pracodawcy lub płatnika świadczenia', type: 'text' },
  { relativeKey: 'employerNip', label: 'NIP pracodawcy lub płatnika świadczenia', type: 'text', validation: { pattern: '^\\d{10}$' } },
  { relativeKey: 'employerRegon', label: 'REGON pracodawcy lub płatnika świadczenia', type: 'text', validation: { pattern: '^\\d{9}(?:\\d{5})?$' } },
  { relativeKey: 'employerRegistryNumber', label: 'Numer CEIDG albo KRS pracodawcy', type: 'text' },
  { relativeKey: 'employerAddress', label: 'Adres pracodawcy lub płatnika świadczenia', type: 'text' },
  { relativeKey: 'employmentBenefitType', label: 'Rodzaj umowy albo świadczenia', type: 'text' },
  { relativeKey: 'employmentStartDate', label: 'Data rozpoczęcia umowy albo przyznania świadczenia', type: 'date' },
  { relativeKey: 'employmentContractDuration', label: 'Okres obowiązywania umowy albo świadczenia', type: 'select', options: EMPLOYMENT_CONTRACT_DURATION_OPTIONS },
  { relativeKey: 'employmentEndDate', label: 'Data końcowa umowy albo świadczenia', type: 'date', visibleWhen: { relativeKey: 'employmentContractDuration', equals: 'fixed_term' } },
  { relativeKey: 'jobTitle', label: 'Stanowisko pracy', type: 'text' },
  { relativeKey: 'averageNetIncome', label: 'Średnie miesięczne wynagrodzenie netto', type: 'currency', validation: { min: 0 } },
  { relativeKey: 'incomeCurrency', label: 'Waluta dochodu', type: 'text' },
  { relativeKey: 'salaryPaymentMethod', label: 'Sposób wypłaty wynagrodzenia', type: 'select', options: SALARY_PAYMENT_METHOD_OPTIONS },
  { relativeKey: 'salaryGarnished', label: 'Wynagrodzenie obciążone wyrokami lub innymi potrąceniami', type: 'boolean' },
  { relativeKey: 'salaryGarnishmentAmount', label: 'Kwota potrącenia z wynagrodzenia', type: 'currency', validation: { min: 0 }, visibleWhen: { relativeKey: 'salaryGarnished', equals: 'true' } },
  { relativeKey: 'adverseEmploymentCircumstances', label: 'Likwidacja, upadłość, wypowiedzenie, okres próbny albo praca tymczasowa', type: 'boolean' },
] as const

type IncomeApplicantRelativeKey = typeof INCOME_APPLICANT_FIELD_BLUEPRINTS[number]['relativeKey']
type IncomeApplicantCanonicalFieldKey = `applicants.${ApplicantIndex}.${IncomeApplicantRelativeKey}`

function materializeIncomeApplicantField(
  index: ApplicantIndex,
  blueprint: typeof INCOME_APPLICANT_FIELD_BLUEPRINTS[number],
): CanonicalFieldDefinition & { canonicalKey: IncomeApplicantCanonicalFieldKey } {
  const displayIndex = index + 1
  const visibleWhen = 'visibleWhen' in blueprint
    ? {
        canonicalKey: `applicants.${index}.${blueprint.visibleWhen.relativeKey}`,
        equals: blueprint.visibleWhen.equals,
      }
    : undefined

  return defineCompactField({
    canonicalKey: `applicants.${index}.${blueprint.relativeKey}` as IncomeApplicantCanonicalFieldKey,
    label: `${blueprint.label} — wnioskodawca ${displayIndex}`,
    type: blueprint.type,
    group: 'applicants',
    question: `${blueprint.label} — wnioskodawca ${displayIndex}`,
    semanticDescription: `${blueprint.label} osoby występującej jako wnioskodawca nr ${displayIndex}, wymagane w formularzu dochodowym Erste.`,
    semanticRole: `person.income.${blueprint.relativeKey}`,
    aliases: [blueprint.label, `${blueprint.label} wnioskodawcy ${displayIndex}`],
    collection: {
      key: 'applicants',
      index,
      displayIndex,
      relativeKey: blueprint.relativeKey,
      label: blueprint.label,
    },
    ...('options' in blueprint ? { options: blueprint.options } : {}),
    ...('validation' in blueprint ? { validation: blueprint.validation } : {}),
    ...(visibleWhen ? { visibleWhen, requiredWhen: visibleWhen } : {}),
  })
}

const INCOME_APPLICANT_FIELDS = APPLICANT_INDEXES.flatMap(index => (
  INCOME_APPLICANT_FIELD_BLUEPRINTS.map(blueprint => materializeIncomeApplicantField(index, blueprint))
))

const TRANCHE_FIELDS = TRANCHE_INDEXES.flatMap((index) => {
  const displayIndex = index + 1
  const collection = (relativeKey: string, label: string) => ({
    key: 'tranches',
    index,
    displayIndex,
    relativeKey,
    label,
  })
  const visibleWhen = { canonicalKey: 'loan.disbursementType', equals: 'tranches' } as const
  return [
    defineField({
      canonicalKey: `tranches.${index}.date`,
      label: `Data wypłaty — transza ${displayIndex}`,
      type: 'date',
      group: 'loan',
      question: `Podaj datę wypłaty transzy ${displayIndex}`,
      semanticDescription: `Planowana data wypłaty transzy kredytu nr ${displayIndex}.`,
      semanticRole: 'loan.disbursement.tranche.date',
      aliases: ['termin transzy', 'data wypłaty transzy'],
      exclude: ['data złożenia wniosku'],
      collection: collection('date', 'Data wypłaty'),
      visibleWhen,
    }),
    defineField({
      canonicalKey: `tranches.${index}.amount`,
      label: `Kwota — transza ${displayIndex}`,
      type: 'currency',
      group: 'loan',
      question: `Podaj kwotę transzy ${displayIndex}`,
      semanticDescription: `Kwota planowanej transzy kredytu nr ${displayIndex}.`,
      semanticRole: 'loan.disbursement.tranche.amount',
      aliases: ['kwota wypłaty', 'kwota transzy'],
      exclude: ['kwota kredytu łącznie'],
      collection: collection('amount', 'Kwota'),
      visibleWhen,
      validation: { min: 0 },
    }),
    defineField({
      canonicalKey: `tranches.${index}.accountOwner`,
      label: `Właściciel rachunku — transza ${displayIndex}`,
      type: 'text',
      group: 'loan',
      question: `Podaj właściciela rachunku dla transzy ${displayIndex}`,
      semanticDescription: `Właściciel rachunku odbiorcy transzy nr ${displayIndex}.`,
      semanticRole: 'loan.disbursement.tranche.accountOwner',
      aliases: ['właściciel rachunku', 'odbiorca transzy'],
      exclude: ['numer rachunku'],
      collection: collection('accountOwner', 'Właściciel rachunku'),
      visibleWhen,
    }),
    defineField({
      canonicalKey: `tranches.${index}.ownFundsBeforeDisbursement`,
      label: `Środki własne przed wypłatą — transza ${displayIndex}`,
      type: 'currency',
      group: 'investment',
      question: `Podaj środki własne do wniesienia przed transzą ${displayIndex}`,
      semanticDescription: `Kwota środków własnych wnoszona przed wypłatą transzy nr ${displayIndex}.`,
      semanticRole: 'investment.ownFunds.beforeTranche',
      aliases: ['środki własne przed transzą', 'wkład własny przed wypłatą'],
      exclude: ['kwota transzy kredytu'],
      collection: collection('ownFundsBeforeDisbursement', 'Środki własne przed wypłatą'),
      visibleWhen,
      validation: { min: 0 },
    }),
  ]
})

const INVESTOR_PAYMENT_FIELDS = INVESTOR_PAYMENT_INDEXES.flatMap((index) => {
  const displayIndex = index + 1
  const collection = (relativeKey: string, label: string) => ({
    key: 'investorPayments',
    index,
    displayIndex,
    relativeKey,
    label,
  })
  const visibleWhen = {
    canonicalKey: 'investor.paymentScheduleType',
    equals: 'tranches',
  } as const

  return [
    defineCompactField({
      canonicalKey: `investorPayments.${index}.date`,
      label: `Data płatności — pozycja ${displayIndex}`,
      type: 'date',
      group: 'investment',
      semanticDescription: `Data płatności nr ${displayIndex} z harmonogramu ceny dla inwestora.`,
      semanticRole: 'investment.investor.payment.date',
      aliases: ['data płatności', 'data transzy dla inwestora'],
      exclude: ['data wypłaty transzy kredytu'],
      collection: collection('date', 'Data płatności'),
      visibleWhen,
    }),
    defineCompactField({
      canonicalKey: `investorPayments.${index}.amount`,
      label: `Kwota płatności — pozycja ${displayIndex}`,
      type: 'currency',
      group: 'investment',
      semanticDescription: `Kwota płatności nr ${displayIndex} z harmonogramu ceny dla inwestora.`,
      semanticRole: 'investment.investor.payment.amount',
      aliases: ['kwota płatności', 'kwota transzy dla inwestora'],
      exclude: ['kwota wypłaty transzy kredytu'],
      collection: collection('amount', 'Kwota płatności'),
      visibleWhen,
      validation: { min: 0 },
    }),
    defineCompactField({
      canonicalKey: `investorPayments.${index}.purpose`,
      label: `Przeznaczenie płatności — pozycja ${displayIndex}`,
      type: 'text',
      group: 'investment',
      semanticDescription: `Przedmiot płatności nr ${displayIndex}: lokal, dom albo udział.`,
      semanticRole: 'investment.investor.payment.purpose',
      aliases: ['za co jest płatność transzy', 'przedmiot płatności'],
      exclude: ['cel kredytu'],
      collection: collection('purpose', 'Przeznaczenie płatności'),
      visibleWhen,
    }),
  ]
})

const BANK_APPLICANT_INDEXES = [0, 1, 2, 3] as const

const ERSTE_PRELIMINARY_APPLICANT_FIELDS = BANK_APPLICANT_INDEXES.map((index) => {
  const displayIndex = index + 1
  return defineCompactField({
    canonicalKey: `applicants.${index}.postContractDataProcessingConsent` as const,
    label: `Zgoda na przetwarzanie danych po wygaśnięciu zobowiązania — wnioskodawca ${displayIndex}`,
    type: 'boolean',
    group: 'applicants',
    semanticDescription: `Zgoda wnioskodawcy nr ${displayIndex} na przetwarzanie danych objętych tajemnicą bankową po wygaśnięciu zobowiązania, maksymalnie przez 5 lat.`,
    semanticRole: 'person.consent.postContractDataProcessing',
    aliases: ['zgoda na przetwarzanie danych po wygaśnięciu zobowiązania'],
    exclude: ['zgoda marketingowa', 'zgoda na kontakt elektroniczny'],
    collection: {
      key: 'applicants',
      index,
      displayIndex,
      relativeKey: 'postContractDataProcessingConsent',
      label: 'Zgoda na przetwarzanie danych po wygaśnięciu zobowiązania',
    },
  })
})

const EXTENDED_APPLICANT_FIELDS = BANK_APPLICANT_INDEXES.flatMap((index) => {
  const displayIndex = index + 1
  const collection = (relativeKey: string, label: string) => ({
    key: 'applicants',
    index,
    displayIndex,
    relativeKey,
    label,
  })
  return [
    defineField({
      canonicalKey: `applicants.${index}.targetPropertyOwner` as `applicants.${typeof index}.targetPropertyOwner`,
      label: `Właściciel nieruchomości docelowej — wnioskodawca ${displayIndex}`,
      type: 'boolean',
      group: 'applicants',
      question: `Czy wnioskodawca ${displayIndex} jest lub będzie właścicielem kredytowanej nieruchomości?`,
      semanticDescription: `Informacja, czy wnioskodawca nr ${displayIndex} jest lub będzie właścicielem przedmiotu kredytowania.`,
      semanticRole: 'person.property.target.owner',
      aliases: ['właściciel nieruchomości kredytowanej'],
      exclude: ['właściciel rachunku'],
      collection: collection('targetPropertyOwner', 'Właściciel nieruchomości'),
    }),
    defineField({
      canonicalKey: `applicants.${index}.sharedHouseholdWithApplicantNumber` as `applicants.${typeof index}.sharedHouseholdWithApplicantNumber`,
      label: `Wspólne gospodarstwo — wnioskodawca ${displayIndex}`,
      type: 'text',
      group: 'applicants',
      question: `Podaj numer wnioskodawcy prowadzącego wspólne gospodarstwo z osobą ${displayIndex}`,
      helpText: 'Pozostaw puste, jeżeli osoba prowadzi odrębne gospodarstwo domowe.',
      semanticDescription: `Numer innego wnioskodawcy, z którym osoba nr ${displayIndex} prowadzi wspólne gospodarstwo domowe.`,
      semanticRole: 'person.household.sharedWithApplicantNumber',
      aliases: ['numer wspólnego gospodarstwa', 'wspólne gospodarstwo z wnioskodawcą'],
      exclude: ['numer gospodarstwa banku'],
      collection: collection('sharedHouseholdWithApplicantNumber', 'Wspólne gospodarstwo'),
    }),
    defineField({
      canonicalKey: `applicants.${index}.willOccupyFinancedProperty` as `applicants.${typeof index}.willOccupyFinancedProperty`,
      label: `Zamieszkanie w nieruchomości — wnioskodawca ${displayIndex}`,
      type: 'boolean',
      group: 'applicants',
      question: `Czy wnioskodawca ${displayIndex} będzie mieszkać w finansowanej nieruchomości?`,
      semanticDescription: `Deklaracja docelowego zamieszkania wnioskodawcy nr ${displayIndex} w finansowanej nieruchomości.`,
      semanticRole: 'person.property.financed.willOccupy',
      aliases: ['wnioskodawca zamieszkujący docelowo'],
      exclude: ['obecny adres zamieszkania'],
      collection: collection('willOccupyFinancedProperty', 'Docelowe zamieszkanie'),
    }),
    defineField({
      canonicalKey: `additionalProducts.lifeInsuranceApplicant.${index}` as `additionalProducts.lifeInsuranceApplicant.${typeof index}`,
      label: `Ubezpieczenie na życie — wnioskodawca ${displayIndex}`,
      type: 'boolean',
      group: 'loan',
      question: `Czy ubezpieczeniem na życie ma zostać objęty wnioskodawca ${displayIndex}?`,
      semanticDescription: `Wybór wnioskodawcy nr ${displayIndex} jako osoby objętej dodatkowym ubezpieczeniem na życie.`,
      semanticRole: 'loan.additionalProducts.lifeInsurance.applicant',
      aliases: ['ubezpieczony wnioskodawca'],
      exclude: [],
      collection: collection('lifeInsuranceSelected', 'Ubezpieczenie na życie'),
      visibleWhen: { canonicalKey: 'additionalProducts.lifeInsurance', equals: 'true' },
    }),
  ]
})

const HOUSEHOLD_FIELDS = HOUSEHOLD_INDEXES.flatMap((index) => {
  const displayIndex = index + 1
  const collection = (relativeKey: string, label: string) => ({
    key: 'households',
    index,
    displayIndex,
    relativeKey,
    label,
  })
  const definitions = [
    ['monthlyDebtInstallments', 'Łączne miesięczne raty', 'Łączna miesięczna wysokość rat kredytów i pożyczek.', 'currency'],
    ['outstandingDebt', 'Pozostałe zadłużenie', 'Łączna kwota kapitału pozostałego do spłaty.', 'currency'],
    ['otherFixedExpenses', 'Inne stałe obciążenia', 'Miesięczna wartość alimentów, polis i innych stałych obciążeń.', 'currency'],
    ['externalCreditLimits', 'Limity poza Pekao', 'Łączna wysokość limitów kredytowych poza Bankiem Pekao.', 'currency'],
    ['householdExpenses', 'Wydatki gospodarstwa', 'Łączna miesięczna wysokość wydatków gospodarstwa domowego.', 'currency'],
  ] as const
  return definitions.map(([key, label, description, type]) => defineField({
    canonicalKey: `households.${index}.${key}` as `households.${typeof index}.${typeof key}`,
    label: `${label} — gospodarstwo ${displayIndex}`,
    type,
    group: 'household',
    question: `Podaj: ${label.toLocaleLowerCase('pl-PL')} dla gospodarstwa ${displayIndex}`,
    semanticDescription: description,
    semanticRole: `household.finances.${key}`,
    aliases: [label],
    exclude: ['kwota kredytu hipotecznego'],
    collection: collection(key, label),
    validation: { min: 0 },
  }))
})

const LIABILITY_FIELDS = LIABILITY_INDEXES.flatMap((index) => {
  const displayIndex = index + 1
  const collection = (relativeKey: string, label: string) => ({
    key: 'liabilities',
    index,
    displayIndex,
    relativeKey,
    label,
  })
  const common = {
    group: 'liabilities' as const,
    exclude: ['nowy kredyt hipoteczny'],
  }
  return [
    defineField({
      canonicalKey: `liabilities.${index}.type` as `liabilities.${typeof index}.type`,
      label: `Rodzaj zobowiązania ${displayIndex}`,
      type: 'text', ...common,
      question: `Podaj rodzaj zobowiązania ${displayIndex}`,
      semanticDescription: 'Rodzaj istniejącego zobowiązania przeznaczonego do spłaty.',
      semanticRole: 'liability.type', aliases: ['rodzaj zobowiązania'],
      collection: collection('type', 'Rodzaj'),
    }),
    defineField({
      canonicalKey: `liabilities.${index}.creditor` as `liabilities.${typeof index}.creditor`,
      label: `Instytucja kredytująca ${displayIndex}`,
      type: 'text', ...common,
      question: `Podaj instytucję dla zobowiązania ${displayIndex}`,
      semanticDescription: 'Nazwa instytucji będącej wierzycielem zobowiązania.',
      semanticRole: 'liability.creditor', aliases: ['instytucja kredytująca', 'wierzyciel'],
      collection: collection('creditor', 'Instytucja'),
    }),
    defineField({
      canonicalKey: `liabilities.${index}.contractDate` as `liabilities.${typeof index}.contractDate`,
      label: `Data umowy ${displayIndex}`,
      type: 'date', ...common,
      question: `Podaj datę zawarcia umowy zobowiązania ${displayIndex}`,
      semanticDescription: 'Data zawarcia umowy istniejącego zobowiązania.',
      semanticRole: 'liability.contract.date', aliases: ['data zawarcia umowy'],
      collection: collection('contractDate', 'Data umowy'),
    }),
    ...([
      ['outstandingAmount', 'Aktualne zadłużenie', 'Aktualne saldo albo przyznany limit zobowiązania.'],
      ['installmentAmount', 'Wysokość raty', 'Miesięczna rata istniejącego zobowiązania.'],
    ] as const).map(([key, label, description]) => defineField({
      canonicalKey: `liabilities.${index}.${key}` as `liabilities.${typeof index}.${typeof key}`,
      label: `${label} ${displayIndex}`,
      type: 'currency', ...common,
      question: `Podaj: ${label.toLocaleLowerCase('pl-PL')} dla zobowiązania ${displayIndex}`,
      semanticDescription: description,
      semanticRole: `liability.${key}`, aliases: [label],
      collection: collection(key, label), validation: { min: 0 },
    })),
    defineField({
      canonicalKey: `liabilities.${index}.contractNumber` as `liabilities.${typeof index}.contractNumber`,
      label: `Numer umowy ${displayIndex}`,
      type: 'text', ...common,
      question: `Podaj numer umowy zobowiązania ${displayIndex}`,
      semanticDescription: 'Numer umowy istniejącego zobowiązania.',
      semanticRole: 'liability.contract.number', aliases: ['numer umowy'],
      collection: collection('contractNumber', 'Numer umowy'),
    }),
    defineField({
      canonicalKey: `liabilities.${index}.currency` as `liabilities.${typeof index}.currency`,
      label: `Waluta zobowiązania ${displayIndex}`,
      type: 'text', ...common,
      question: `Podaj walutę zobowiązania ${displayIndex}`,
      semanticDescription: 'Waluta istniejącego zobowiązania.',
      semanticRole: 'liability.currency', aliases: ['waluta zobowiązania'],
      collection: collection('currency', 'Waluta'),
    }),
    defineField({
      canonicalKey: `liabilities.${index}.applicantNumbers` as `liabilities.${typeof index}.applicantNumbers`,
      label: `Wnioskodawcy zobowiązania ${displayIndex}`,
      type: 'text', ...common,
      question: `Podaj numery wnioskodawców związanych ze zobowiązaniem ${displayIndex}`,
      semanticDescription: 'Numery wnioskodawców, których dotyczy istniejące zobowiązanie.',
      semanticRole: 'liability.applicantNumbers', aliases: ['wnioskodawca zobowiązania'],
      collection: collection('applicantNumbers', 'Wnioskodawcy'),
    }),
  ]
})

const MORTGAGE_DISCHARGE_FIELDS = MORTGAGE_DISCHARGE_INDEXES.flatMap((index) => {
  const displayIndex = index + 1
  const collection = (relativeKey: string, label: string) => ({
    key: 'mortgageDischarges', index, displayIndex, relativeKey, label,
  })
  return [
    defineField({
      canonicalKey: `mortgageDischarges.${index}.mortgageNumber` as `mortgageDischarges.${typeof index}.mortgageNumber`,
      label: `Numer hipoteki ${displayIndex}`,
      type: 'text', group: 'liabilities',
      question: `Podaj numer hipoteki ${displayIndex}`,
      semanticDescription: 'Numer hipoteki podlegającej wykreśleniu lub spłacie.',
      semanticRole: 'mortgageDischarge.mortgageNumber', aliases: ['dotyczy hipoteki nr'], exclude: [],
      collection: collection('mortgageNumber', 'Numer hipoteki'),
    }),
    defineField({
      canonicalKey: `mortgageDischarges.${index}.landRegisterNumber` as `mortgageDischarges.${typeof index}.landRegisterNumber`,
      label: `Numer KW hipoteki ${displayIndex}`,
      type: 'text', group: 'liabilities',
      question: `Podaj numer księgi wieczystej dla hipoteki ${displayIndex}`,
      semanticDescription: 'Numer księgi wieczystej obciążonej wskazaną hipoteką.',
      semanticRole: 'mortgageDischarge.landRegisterNumber', aliases: ['KW hipoteki'], exclude: [],
      collection: collection('landRegisterNumber', 'Numer KW'),
    }),
    defineField({
      canonicalKey: `mortgageDischarges.${index}.settlementStatus` as `mortgageDischarges.${typeof index}.settlementStatus`,
      label: `Sposób rozliczenia hipoteki ${displayIndex}`,
      type: 'select', group: 'liabilities',
      question: `Wybierz sposób rozliczenia hipoteki ${displayIndex}`,
      semanticDescription: 'Deklarowany sposób spłaty lub wykreślenia istniejącej hipoteki.',
      semanticRole: 'mortgageDischarge.settlementStatus', aliases: ['deklaracja spłaty hipoteki'], exclude: [],
      options: MORTGAGE_SETTLEMENT_OPTIONS,
      collection: collection('settlementStatus', 'Sposób rozliczenia'),
    }),
  ]
})

const COLLATERAL_PROPERTY_FIELDS = COLLATERAL_PROPERTY_INDEXES.flatMap((index) => {
  const displayIndex = index + 1
  const collection = (relativeKey: string, label: string) => ({
    key: 'collateralProperties', index, displayIndex, relativeKey, label,
  })
  return [
    defineField({
      canonicalKey: `collateralProperties.${index}.relationshipToFinancedProperty` as `collateralProperties.${typeof index}.relationshipToFinancedProperty`,
      label: `Rodzaj nieruchomości pod hipotekę ${displayIndex}`,
      type: 'select', group: 'property',
      question: `Czy nieruchomość pod hipotekę ${displayIndex} jest nieruchomością kredytowaną?`,
      semanticDescription: 'Relacja nieruchomości stanowiącej zabezpieczenie do przedmiotu kredytowania.',
      semanticRole: 'property.collateral.relationshipToFinancedProperty',
      aliases: ['kredytowana lub inna nieruchomość'], exclude: [],
      options: COLLATERAL_RELATIONSHIP_OPTIONS,
      collection: collection('relationshipToFinancedProperty', 'Relacja'),
    }),
    defineField({
      canonicalKey: `collateralProperties.${index}.landRegisterNumber` as `collateralProperties.${typeof index}.landRegisterNumber`,
      label: `Numer KW nieruchomości ${displayIndex}`,
      type: 'text', group: 'property',
      question: `Podaj numer księgi wieczystej nieruchomości pod hipotekę ${displayIndex}`,
      semanticDescription: 'Numer księgi wieczystej nieruchomości stanowiącej zabezpieczenie.',
      semanticRole: 'property.collateral.landRegisterNumber', aliases: ['KW nieruchomości pod hipotekę'], exclude: [],
      collection: collection('landRegisterNumber', 'Numer KW'),
      visibleWhen: { canonicalKey: `collateralProperties.${index}.hasLandRegister`, equals: 'true' },
      requiredWhen: { canonicalKey: `collateralProperties.${index}.hasLandRegister`, equals: 'true' },
    }),
    defineField({
      canonicalKey: `collateralProperties.${index}.hasLandRegister` as `collateralProperties.${typeof index}.hasLandRegister`,
      label: `Założona KW nieruchomości ${displayIndex}`,
      type: 'boolean', group: 'property',
      question: `Czy nieruchomość pod hipotekę ${displayIndex} ma założoną księgę wieczystą?`,
      semanticDescription: 'Informacja, czy nieruchomość stanowiąca zabezpieczenie ma założoną księgę wieczystą.',
      semanticRole: 'property.collateral.hasLandRegister', aliases: ['brak założonej KW'], exclude: [],
      collection: collection('hasLandRegister', 'Założona KW'),
    }),
  ]
})

const STATIC_COMPUTED_BINDINGS = [
  {
    canonicalKey: 'application.placeAndDate',
    label: 'Miejscowość i data złożenia wniosku',
    type: 'text',
    group: 'application',
    semanticDescription: 'Łączna prezentacja miejscowości oraz daty formalnego złożenia wniosku.',
    semanticRole: 'application.submission.placeAndDate',
    aiMappingHints: {
      aliases: ['miejscowość i data', 'sporządzono dnia', 'miejsce, data'],
      exclude: ['miejsce i data urodzenia', 'adres i data zamieszkania'],
    },
    computed: true,
    valueFrom: ['application.place', 'application.date'],
    valueFormat: 'application.placeAndDate',
  },
  {
    canonicalKey: 'property.address.full',
    label: 'Pełny adres nieruchomości',
    type: 'text',
    group: 'property',
    semanticDescription: 'Pełny adres nieruchomości będącej przedmiotem finansowania lub zabezpieczenia.',
    semanticRole: 'property.address.full',
    aiMappingHints: {
      aliases: ['adres nieruchomości', 'położenie nieruchomości', 'adres inwestycji'],
      exclude: ['adres zamieszkania', 'adres korespondencyjny', 'adres banku'],
    },
    computed: true,
    valueFrom: [
      'property.address.street',
      'property.address.houseNumber',
      'property.address.unitNumber',
      'property.address.postalCode',
      'property.address.city',
      'property.address.county',
      'property.address.voivodeship',
    ],
    valueFormat: 'fullAddress',
  },
  {
    canonicalKey: 'property.address.houseAndUnit',
    label: 'Numer domu i lokalu nieruchomości',
    type: 'text',
    group: 'property',
    semanticDescription: 'Połączony numer budynku i lokalu w adresie nieruchomości.',
    semanticRole: 'property.address.houseAndUnit',
    aiMappingHints: {
      aliases: ['nr domu/lokalu', 'budynek i lokal', 'numer budynku i mieszkania'],
      exclude: ['numer księgi wieczystej', 'numer działki', 'adres zamieszkania'],
    },
    computed: true,
    valueFrom: [
      'property.address.houseNumber',
      'property.address.unitNumber',
    ],
    valueFormat: 'houseAndUnit',
  },
  {
    canonicalKey: 'property.address.streetHouseAndUnit',
    label: 'Ulica oraz numer domu i lokalu nieruchomości',
    type: 'text',
    group: 'property',
    semanticDescription: 'Ulica wraz z numerem budynku i lokalu, bez kodu pocztowego i miejscowości.',
    semanticRole: 'property.address.streetHouseAndUnit',
    aiMappingHints: {
      aliases: ['ulica, nr budynku/działki/lokalu', 'ulica i numer domu'],
      exclude: ['kod pocztowy', 'miejscowość'],
    },
    computed: true,
    valueFrom: [
      'property.address.street',
      'property.address.houseNumber',
      'property.address.unitNumber',
    ],
    valueFormat: 'streetHouseAndUnit',
  },
  {
    canonicalKey: 'investment.engagedOwnFundsTotal',
    label: 'Zaangażowane środki własne razem',
    type: 'currency',
    group: 'investment',
    semanticDescription: 'Suma środków własnych już wniesionych i wartości działki wniesionej do inwestycji.',
    semanticRole: 'investment.ownFunds.engagedTotal',
    aiMappingHints: {
      aliases: ['zaangażowane środki własne razem', 'wkład wniesiony razem'],
      exclude: ['środki do wniesienia'],
    },
    computed: true,
    valueFrom: ['investment.ownFundsPaid', 'investment.landValue'],
    valueFormat: 'currency.sum',
  },
  {
    canonicalKey: 'investment.ownFundsToContributeTotal',
    label: 'Środki własne do wniesienia razem',
    type: 'currency',
    group: 'investment',
    semanticDescription: 'Suma środków własnych planowanych przed wypłatą i w trakcie inwestycji.',
    semanticRole: 'investment.ownFunds.toContributeTotal',
    aiMappingHints: {
      aliases: ['środki własne do wniesienia razem', 'pozostały wkład własny razem'],
      exclude: ['wkład już wniesiony'],
    },
    computed: true,
    valueFrom: [
      'investment.ownFundsBeforeDisbursement',
      'investment.ownFundsDuringInvestment',
    ],
    valueFormat: 'currency.sum',
  },
] as const satisfies readonly CanonicalComputedBindingDefinition[]

export const CANONICAL_COMPUTED_BINDINGS = [
  ...APPLICANT_INDEXES.map(materializeApplicantFullName),
  ...APPLICANT_INDEXES.map(materializeApplicantAverageNetIncomeInWords),
  ...STATIC_COMPUTED_BINDINGS,
] as const

const DOMAIN_FIELDS = [
  defineField({
    canonicalKey: 'loan.program',
    label: 'Program kredytowy',
    type: 'select',
    group: 'loan',
    question: 'Wybierz program kredytowy',
    helpText: 'Wskaż standardowy kredyt hipoteczny albo Rodzinny Kredyt Mieszkaniowy.',
    semanticDescription: 'Program produktowy, w ramach którego składany jest wniosek hipoteczny.',
    semanticRole: 'loan.program',
    aliases: ['program kredytu', 'rodzinny kredyt mieszkaniowy', 'RKM'],
    exclude: ['cel kredytu', 'rodzaj oprocentowania'],
    options: [
      { value: 'standard', label: 'Standardowy kredyt hipoteczny' },
      { value: 'rkm', label: 'Rodzinny Kredyt Mieszkaniowy (RKM)' },
    ],
  }),
  defineField({
    canonicalKey: 'loan.rkmGuarantee',
    label: 'Gwarancja spłaty BGK w RKM',
    type: 'boolean',
    group: 'loan',
    question: 'Czy RKM korzysta z gwarancji spłaty BGK?',
    helpText: 'Odpowiedź steruje dołączeniem warunków gwarancji spłaty do kompletu Erste.',
    semanticDescription: 'Informacja, czy Rodzinny Kredyt Mieszkaniowy korzysta z gwarancji spłaty BGK.',
    semanticRole: 'loan.program.rkm.guarantee',
    aliases: ['gwarancja BGK', 'gwarancja spłaty RKM'],
    exclude: ['ubezpieczenie kredytu', 'poręczenie prywatne'],
    visibleWhen: { canonicalKey: 'loan.program', equals: 'rkm' },
    requiredWhen: { canonicalKey: 'loan.program', equals: 'rkm' },
  }),
  defineField({
    canonicalKey: 'loan.purpose',
    label: 'Cel kredytu',
    type: 'select',
    group: 'loan',
    question: 'Wybierz cel kredytu',
    helpText: 'Wskaż główny cel finansowania opisany w składanym wniosku.',
    semanticDescription: 'Główny biznesowy cel finansowania, o które wnioskują klienci.',
    semanticRole: 'loan.purpose',
    aliases: ['przeznaczenie kredytu', 'cel finansowania', 'wnioskuję o kredyt na'],
    exclude: ['rodzaj zabezpieczenia', 'typ nieruchomości'],
    options: PURPOSE_OPTIONS,
  }),
  defineField({
    canonicalKey: 'loan.mortgageLoanPurpose',
    label: 'Cel pożyczki hipotecznej',
    type: 'textarea',
    group: 'loan',
    question: 'Opisz cel pożyczki hipotecznej',
    semanticDescription: 'Dowolny konsumencki cel pożyczki hipotecznej, niezwiązany z działalnością gospodarczą.',
    semanticRole: 'loan.mortgageLoan.purpose',
    aliases: ['pożyczka hipoteczna cel', 'wpisz cel pożyczki'],
    exclude: ['cel kredytu mieszkaniowego'],
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'mortgage_loan' },
    requiredWhen: { canonicalKey: 'loan.purpose', equals: 'mortgage_loan' },
  }),
  defineField({
    canonicalKey: 'loan.purposeOther',
    label: 'Opisz inny cel kredytu',
    type: 'textarea',
    group: 'loan',
    question: 'Opisz inny cel kredytu',
    helpText: 'Uzupełnij tylko wtedy, gdy wybrano opcję „Inny cel”.',
    semanticDescription: 'Opis celu finansowania, gdy nie mieści się on w zamkniętym katalogu standardowych celów.',
    semanticRole: 'loan.purpose.other.description',
    aliases: ['inny cel jaki', 'opis innego celu', 'inne przeznaczenie'],
    exclude: ['uwagi banku', 'dodatkowe informacje niezwiązane z celem'],
    description: 'Opis zostanie wpisany obok zaznaczonej opcji „Inny cel” w każdym dokumencie, który go wymaga.',
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'other' },
    requiredWhen: { canonicalKey: 'loan.purpose', equals: 'other' },
  }),
  defineField({
    canonicalKey: 'loan.constructionMethod',
    label: 'Sposób realizacji budowy',
    type: 'select',
    group: 'loan',
    question: 'Wybierz sposób realizacji budowy',
    helpText: 'Określ, kto odpowiada za realizację inwestycji budowlanej.',
    semanticDescription: 'Organizacyjny sposób wykonania budowy finansowanej kredytem.',
    semanticRole: 'loan.construction.method',
    aliases: ['system budowy', 'budowa systemem', 'wykonawca budowy'],
    exclude: ['technologia budowy', 'rodzaj nieruchomości'],
    options: CONSTRUCTION_METHOD_OPTIONS,
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'construction' },
    requiredWhen: { canonicalKey: 'loan.purpose', equals: 'construction' },
  }),
  defineField({
    canonicalKey: 'loan.renovationPermit',
    label: 'Wariant remontu',
    type: 'select',
    group: 'loan',
    question: 'Czy remont wymaga pozwolenia na budowę?',
    helpText: 'Wybierz wariant zgodny z zakresem planowanych prac.',
    semanticDescription: 'Informacja, czy remont finansowany kredytem wymaga pozwolenia na budowę.',
    semanticRole: 'loan.renovation.permitRequirement',
    aliases: ['pozwolenie na remont', 'remont wymagający pozwolenia', 'remont bez pozwolenia'],
    exclude: ['pozwolenie na użytkowanie', 'pozwolenie na zakup'],
    options: RENOVATION_PERMIT_OPTIONS,
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    requiredWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
  }),
  defineField({
    canonicalKey: 'loan.amount',
    label: 'Kwota kredytu',
    type: 'currency',
    group: 'loan',
    question: 'Podaj wnioskowaną kwotę kredytu',
    helpText: 'Kwota finansowania, o którą wnioskują klienci.',
    semanticDescription: 'Łączna nominalna kwota kredytu wnioskowana w danej sprawie.',
    semanticRole: 'loan.amount.requested',
    aliases: ['wnioskowana kwota', 'kwota kredytu', 'kwota finansowania'],
    exclude: ['wartość nieruchomości', 'całkowity koszt inwestycji', 'wkład własny'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'loan.renovationAmount',
    label: 'Część kwoty kredytu przeznaczona na remont',
    type: 'currency',
    group: 'loan',
    question: 'Podaj część kredytu przeznaczoną na remont',
    helpText: 'Nie wpisuj całej kwoty kredytu, jeśli tylko jej część finansuje remont.',
    semanticDescription: 'Część wnioskowanej kwoty kredytu przeznaczona wyłącznie na remont lub wykończenie.',
    semanticRole: 'loan.amount.renovation',
    aliases: ['kwota na remont', 'część na wykończenie', 'środki na remont'],
    exclude: ['koszt remontu', 'cała kwota kredytu'],
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'loan.arbitraryPurposeAmount',
    label: 'Kwota kredytu na cel dowolny',
    type: 'currency',
    group: 'loan',
    question: 'Podaj część kredytu przeznaczoną na cel dowolny',
    semanticDescription: 'Część kwoty kredytu mieszkaniowego przeznaczona na cel dowolny.',
    semanticRole: 'loan.amount.arbitraryPurpose',
    aliases: ['kwota na cel dowolny'],
    exclude: ['kwota kredytu łącznie'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'loan.termMonths',
    label: 'Okres kredytowania w miesiącach',
    type: 'number',
    group: 'loan',
    question: 'Podaj okres kredytowania w miesiącach',
    helpText: 'Przelicz lata na miesiące, np. 25 lat to 300 miesięcy.',
    semanticDescription: 'Całkowity okres spłaty wnioskowanego kredytu wyrażony w miesiącach.',
    semanticRole: 'loan.term.months',
    aliases: ['okres kredytu', 'liczba miesięcy', 'okres spłaty'],
    exclude: ['liczba rat karencji', 'okres stałego oprocentowania'],
    validation: { min: 1, max: 600, integer: true },
  }),
  defineField({
    canonicalKey: 'loan.repaymentDay',
    label: 'Dzień spłaty raty',
    type: 'number',
    group: 'loan',
    question: 'Wybierz dzień miesiąca spłaty raty',
    helpText: 'Podaj numer dnia miesiąca od 1 do 31.',
    semanticDescription: 'Preferowany dzień miesiąca, w którym pobierana lub spłacana jest rata kredytu.',
    semanticRole: 'loan.repayment.dayOfMonth',
    aliases: ['dzień płatności raty', 'termin raty', 'dzień spłaty'],
    exclude: ['data pierwszej raty', 'termin wypłaty'],
    validation: { min: 1, max: 31, integer: true },
  }),
  defineField({
    canonicalKey: 'investment.totalCost',
    label: 'Cena zakupu lub całkowity koszt inwestycji',
    type: 'currency',
    group: 'investment',
    question: 'Podaj cenę zakupu lub całkowity koszt inwestycji',
    helpText: 'Wpisz pełny koszt przedsięwzięcia, a nie wyłącznie kwotę kredytu.',
    semanticDescription: 'Pełna cena zakupu albo całkowity koszt realizowanej inwestycji.',
    semanticRole: 'investment.cost.total',
    aliases: ['całkowity koszt inwestycji', 'cena zakupu', 'wartość inwestycji'],
    exclude: ['kwota kredytu', 'wartość rynkowa nieruchomości', 'koszt remontu'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'investment.renovationCost',
    label: 'Koszt remontu lub wykończenia',
    type: 'currency',
    group: 'investment',
    question: 'Podaj koszt remontu lub wykończenia',
    helpText: 'Podaj koszt całych prac, niezależnie od źródła ich finansowania.',
    semanticDescription: 'Całkowity koszt prac remontowych lub wykończeniowych w inwestycji.',
    semanticRole: 'investment.cost.renovation',
    aliases: ['koszt remontu', 'koszt wykończenia', 'nakłady remontowe'],
    exclude: ['kwota kredytu na remont', 'całkowity koszt inwestycji'],
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'investment.ownFundsPaid',
    label: 'Wkład własny już wniesiony',
    type: 'currency',
    group: 'investment',
    question: 'Podaj wkład własny już wniesiony',
    helpText: 'Uwzględnij środki faktycznie zapłacone przed złożeniem wniosku.',
    semanticDescription: 'Wartość środków własnych już zaangażowanych w inwestycję.',
    semanticRole: 'investment.ownFunds.paid',
    aliases: ['wkład już wniesiony', 'środki zaangażowane', 'zapłacony wkład własny'],
    exclude: ['wkład do wniesienia', 'wkład własny łącznie'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'investment.ownFundsBeforeDisbursement',
    label: 'Wkład własny do wniesienia przed wypłatą kredytu',
    type: 'currency',
    group: 'investment',
    question: 'Podaj wkład własny do wniesienia przed wypłatą kredytu',
    helpText: 'Kwota, którą klient wniesie przed uruchomieniem kredytu.',
    semanticDescription: 'Środki własne planowane do wniesienia przed pierwszą wypłatą kredytu.',
    semanticRole: 'investment.ownFunds.beforeDisbursement',
    aliases: ['wkład przed wypłatą', 'środki przed uruchomieniem', 'wkład do wniesienia przed kredytem'],
    exclude: ['wkład już wniesiony', 'wkład w trakcie inwestycji'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'investment.ownFundsDuringInvestment',
    label: 'Wkład własny do wniesienia w trakcie inwestycji',
    type: 'currency',
    group: 'investment',
    question: 'Podaj wkład własny do wniesienia w trakcie inwestycji',
    helpText: 'Kwota środków własnych uruchamianych w kolejnych etapach inwestycji.',
    semanticDescription: 'Środki własne planowane do wniesienia po uruchomieniu kredytu, w trakcie realizacji inwestycji.',
    semanticRole: 'investment.ownFunds.duringInvestment',
    aliases: ['wkład w trakcie inwestycji', 'środki w kolejnych etapach', 'wkład po uruchomieniu'],
    exclude: ['wkład już wniesiony', 'wkład przed wypłatą'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'investment.ownFundsContributionDates',
    label: 'Terminy wniesienia pozostałego wkładu własnego',
    type: 'text',
    group: 'investment',
    question: 'Podaj terminy wniesienia pozostałego wkładu własnego',
    helpText: 'Wymień daty lub etapy zgodnie z harmonogramem inwestycji.',
    semanticDescription: 'Daty albo etapy, w których klient wniesie jeszcze niewpłacone środki własne.',
    semanticRole: 'investment.ownFunds.contributionSchedule',
    aliases: ['terminy wkładu własnego', 'harmonogram wkładu', 'daty wniesienia środków'],
    exclude: ['harmonogram transz kredytu', 'termin raty'],
    validation: { maxLength: 25 },
  }),
  defineField({
    canonicalKey: 'investment.ownFunds',
    label: 'Środki własne łącznie',
    type: 'currency',
    group: 'investment',
    question: 'Podaj łączną kwotę środków własnych',
    helpText: 'Wartość może zostać obliczona z poszczególnych etapów wkładu własnego.',
    semanticDescription: 'Łączna wartość wszystkich środków własnych zaangażowanych i planowanych w inwestycji.',
    semanticRole: 'investment.ownFunds.total',
    aliases: ['wkład własny łącznie', 'środki własne ogółem', 'całkowity wkład'],
    exclude: ['wkład już wniesiony', 'wkład przed wypłatą', 'wkład w trakcie'],
    description: 'Wartość wyliczana automatycznie z etapów wniesienia wkładu własnego.',
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'loan.installmentType',
    label: 'Typ rat',
    type: 'select',
    group: 'loan',
    question: 'Wybierz typ rat',
    helpText: 'Wskaż raty równe albo malejące.',
    semanticDescription: 'Sposób kształtowania wysokości rat kapitałowo-odsetkowych w okresie spłaty.',
    semanticRole: 'loan.repayment.installmentType',
    aliases: ['rodzaj rat', 'formuła spłaty', 'raty równe lub malejące'],
    exclude: ['częstotliwość rat', 'dzień spłaty'],
    options: INSTALLMENT_OPTIONS,
  }),
  defineField({
    canonicalKey: 'loan.interestType',
    label: 'Rodzaj oprocentowania',
    type: 'select',
    group: 'loan',
    question: 'Wybierz rodzaj oprocentowania',
    helpText: 'Wskaż oprocentowanie zmienne albo okresowo stałe.',
    semanticDescription: 'Mechanizm zmienności oprocentowania wnioskowanego kredytu.',
    semanticRole: 'loan.interest.type',
    aliases: ['typ oprocentowania', 'oprocentowanie stałe', 'oprocentowanie zmienne'],
    exclude: ['wysokość oprocentowania', 'marża banku'],
    options: INTEREST_OPTIONS,
  }),
  defineField({
    canonicalKey: 'loan.disbursementType',
    label: 'Sposób wypłaty kredytu',
    type: 'select',
    group: 'loan',
    question: 'Wybierz sposób wypłaty kredytu',
    helpText: 'Wskaż wypłatę jednorazową albo w transzach.',
    semanticDescription: 'Sposób uruchamiania środków kredytu: jednorazowo lub etapami.',
    semanticRole: 'loan.disbursement.type',
    aliases: ['uruchomienie kredytu', 'wypłata w transzach', 'wypłata jednorazowa'],
    exclude: ['sposób spłaty', 'typ rat'],
    options: DISBURSEMENT_OPTIONS,
  }),
  defineField({
    canonicalKey: 'loan.commissionType',
    label: 'Sposób pokrycia prowizji',
    type: 'select',
    group: 'loan',
    question: 'Czy prowizja ma być kredytowana?',
    semanticDescription: 'Informacja, czy prowizja za udzielenie kredytu jest finansowana kredytem.',
    semanticRole: 'loan.commission.financing',
    aliases: ['prowizja kredytowana', 'prowizja niekredytowana'],
    exclude: ['wysokość prowizji'],
    options: COMMISSION_OPTIONS,
  }),
  defineField({
    canonicalKey: 'loan.gracePeriod',
    label: 'Karencja w spłacie kapitału',
    type: 'boolean',
    group: 'loan',
    question: 'Czy wnioskujesz o karencję w spłacie kapitału?',
    semanticDescription: 'Wybór karencji w spłacie kapitałowej części kredytu.',
    semanticRole: 'loan.repayment.gracePeriod.enabled',
    aliases: ['karencja tak nie'],
    exclude: ['okres kredytowania'],
  }),
  defineField({
    canonicalKey: 'loan.gracePeriodMonths',
    label: 'Okres karencji w miesiącach',
    type: 'number',
    group: 'loan',
    question: 'Podaj okres karencji w miesiącach',
    semanticDescription: 'Liczba miesięcy karencji w spłacie kapitału.',
    semanticRole: 'loan.repayment.gracePeriod.months',
    aliases: ['okres karencji'],
    exclude: ['okres kredytowania'],
    visibleWhen: { canonicalKey: 'loan.gracePeriod', equals: 'true' },
    requiredWhen: { canonicalKey: 'loan.gracePeriod', equals: 'true' },
    validation: { min: 1, max: 120, integer: true },
  }),
  defineField({
    canonicalKey: 'property.type',
    label: 'Typ nieruchomości',
    type: 'select',
    group: 'property',
    question: 'Wybierz typ nieruchomości',
    helpText: 'Wskaż nieruchomość stanowiącą przedmiot finansowania lub zabezpieczenia.',
    semanticDescription: 'Podstawowa kategoria nieruchomości związanej z wnioskiem kredytowym.',
    semanticRole: 'property.type',
    aliases: ['rodzaj nieruchomości', 'przedmiot kredytowania', 'nieruchomość'],
    exclude: ['cel kredytu', 'rynek pierwotny lub wtórny'],
    options: PROPERTY_TYPE_OPTIONS,
  }),
  defineField({
    canonicalKey: 'property.typeOther',
    label: 'Opisz inny typ nieruchomości',
    type: 'text',
    group: 'property',
    question: 'Opisz inny typ nieruchomości',
    helpText: 'Uzupełnij tylko wtedy, gdy wybrano „Inna nieruchomość”.',
    semanticDescription: 'Opis kategorii nieruchomości, gdy nie mieści się ona w standardowym katalogu.',
    semanticRole: 'property.type.other.description',
    aliases: ['inna nieruchomość jaka', 'opis rodzaju nieruchomości'],
    exclude: ['opis celu kredytu', 'opis stanu nieruchomości'],
    visibleWhen: { canonicalKey: 'property.type', equals: 'other' },
    requiredWhen: { canonicalKey: 'property.type', equals: 'other' },
  }),
  defineField({
    canonicalKey: 'property.address.street',
    label: 'Ulica',
    type: 'text',
    group: 'property',
    question: 'Podaj ulicę nieruchomości',
    helpText: 'Ulica położenia nieruchomości będącej przedmiotem sprawy.',
    semanticDescription: 'Nazwa ulicy w adresie nieruchomości związanej z finansowaniem.',
    semanticRole: 'property.address.street',
    aliases: ['ulica nieruchomości', 'adres nieruchomości ulica'],
    exclude: ['ulica zamieszkania wnioskodawcy', 'adres korespondencyjny'],
  }),
  defineField({
    canonicalKey: 'property.address.houseNumber',
    label: 'Numer domu',
    type: 'text',
    group: 'property',
    question: 'Podaj numer domu nieruchomości',
    helpText: 'Numer budynku w adresie finansowanej nieruchomości.',
    semanticDescription: 'Numer budynku w adresie nieruchomości związanej z finansowaniem.',
    semanticRole: 'property.address.houseNumber',
    aliases: ['nr domu', 'numer budynku', 'adres nieruchomości numer'],
    exclude: ['numer lokalu', 'numer domu zamieszkania wnioskodawcy'],
  }),
  defineField({
    canonicalKey: 'property.address.unitNumber',
    label: 'Numer lokalu',
    type: 'text',
    group: 'property',
    question: 'Podaj numer lokalu nieruchomości',
    helpText: 'Pozostaw puste, jeśli nieruchomość nie ma odrębnego numeru lokalu.',
    semanticDescription: 'Numer lokalu w adresie nieruchomości związanej z finansowaniem.',
    semanticRole: 'property.address.unitNumber',
    aliases: ['nr lokalu', 'numer mieszkania', 'lokal nr'],
    exclude: ['numer domu', 'numer lokalu zamieszkania wnioskodawcy'],
  }),
  defineField({
    canonicalKey: 'property.address.postalCode',
    label: 'Kod pocztowy',
    type: 'text',
    group: 'property',
    question: 'Podaj kod pocztowy nieruchomości',
    helpText: 'Kod w formacie 00-000 dla adresu finansowanej nieruchomości.',
    semanticDescription: 'Kod pocztowy adresu nieruchomości związanej z finansowaniem.',
    semanticRole: 'property.address.postalCode',
    aliases: ['kod pocztowy nieruchomości', 'kod adresu nieruchomości'],
    exclude: ['kod pocztowy zamieszkania', 'kod korespondencyjny'],
    validation: { pattern: '^\\d{2}-\\d{3}$' },
  }),
  defineField({
    canonicalKey: 'property.address.city',
    label: 'Miejscowość nieruchomości',
    type: 'text',
    group: 'property',
    question: 'Podaj miejscowość położenia nieruchomości',
    helpText: 'Nie podawaj miejscowości złożenia wniosku ani zamieszkania klienta.',
    semanticDescription: 'Miejscowość, w której znajduje się nieruchomość związana z finansowaniem.',
    semanticRole: 'property.address.city',
    aliases: ['miasto nieruchomości', 'miejscowość nieruchomości', 'położenie nieruchomości'],
    exclude: ['miejscowość złożenia wniosku', 'miejsce zamieszkania', 'miejsce urodzenia'],
  }),
  defineField({
    canonicalKey: 'property.address.county',
    label: 'Powiat',
    type: 'text',
    group: 'property',
    question: 'Podaj powiat położenia nieruchomości',
    helpText: 'Powiat właściwy dla adresu finansowanej nieruchomości.',
    semanticDescription: 'Powiat administracyjny, w którym znajduje się nieruchomość.',
    semanticRole: 'property.address.county',
    aliases: ['powiat nieruchomości', 'powiat położenia'],
    exclude: ['powiat zamieszkania wnioskodawcy'],
  }),
  defineField({
    canonicalKey: 'property.address.voivodeship',
    label: 'Województwo',
    type: 'text',
    group: 'property',
    question: 'Podaj województwo położenia nieruchomości',
    helpText: 'Województwo właściwe dla adresu finansowanej nieruchomości.',
    semanticDescription: 'Województwo, w którym znajduje się nieruchomość.',
    semanticRole: 'property.address.voivodeship',
    aliases: ['województwo nieruchomości', 'województwo położenia'],
    exclude: ['województwo zamieszkania wnioskodawcy'],
  }),
  defineField({
    canonicalKey: 'property.landRegisterNumber',
    label: 'Numer księgi wieczystej',
    type: 'text',
    group: 'property',
    question: 'Podaj numer księgi wieczystej nieruchomości',
    helpText: 'Wpisz pełny numer wraz z kodem wydziału i cyfrą kontrolną.',
    semanticDescription: 'Pełny identyfikator księgi wieczystej prowadzonej dla nieruchomości.',
    semanticRole: 'property.landRegister.identifier',
    aliases: ['KW', 'nr KW', 'księga wieczysta', 'numer księgi'],
    exclude: ['numer działki', 'numer aktu notarialnego', 'numer rachunku'],
  }),
  defineField({
    canonicalKey: 'property.marketValue',
    label: 'Wartość nieruchomości',
    type: 'currency',
    group: 'property',
    question: 'Podaj wartość rynkową nieruchomości',
    helpText: 'Wartość z wyceny lub przyjęta przez eksperta dla przedmiotu zabezpieczenia.',
    semanticDescription: 'Aktualna wartość rynkowa nieruchomości związanej z finansowaniem.',
    semanticRole: 'property.value.market',
    aliases: ['wartość rynkowa', 'wartość zabezpieczenia', 'wycena nieruchomości'],
    exclude: ['cena zakupu', 'kwota kredytu', 'całkowity koszt inwestycji'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'collateralProperty.sameAsFinancedProperty',
    label: 'Zabezpieczeniem jest finansowana nieruchomość',
    type: 'boolean',
    group: 'property',
    question: 'Czy zabezpieczeniem kredytu jest finansowana nieruchomość?',
    helpText: 'Jeśli wybierzesz „Tak”, dane zabezpieczenia zostaną skopiowane automatycznie.',
    semanticDescription: 'Relacja wskazująca, że nieruchomość finansowana jest jednocześnie zabezpieczeniem kredytu.',
    semanticRole: 'property.collateral.sameAsFinancedProperty',
    aliases: ['nieruchomość kredytowana jako zabezpieczenie', 'to samo zabezpieczenie'],
    exclude: ['inna nieruchomość jako zabezpieczenie'],
  }),
  defineField({
    canonicalKey: 'collateralProperty.type',
    label: 'Typ nieruchomości stanowiącej zabezpieczenie',
    type: 'select',
    group: 'property',
    question: 'Wybierz typ nieruchomości stanowiącej zabezpieczenie',
    semanticDescription: 'Typ odrębnej nieruchomości ustanawianej jako zabezpieczenie kredytu.',
    semanticRole: 'property.collateral.type',
    aliases: ['rodzaj nieruchomości zabezpieczenia'],
    exclude: ['nieruchomość kredytowana'],
    options: PROPERTY_TYPE_OPTIONS,
  }),
  defineField({
    canonicalKey: 'collateralProperty.typeOther',
    label: 'Inny typ nieruchomości stanowiącej zabezpieczenie',
    type: 'text',
    group: 'property',
    question: 'Opisz inny typ nieruchomości stanowiącej zabezpieczenie',
    semanticDescription: 'Opis niestandardowego typu nieruchomości stanowiącej zabezpieczenie.',
    semanticRole: 'property.collateral.type.other',
    aliases: ['inna nieruchomość zabezpieczenia'],
    exclude: ['nieruchomość kredytowana'],
    visibleWhen: { canonicalKey: 'collateralProperty.type', equals: 'other' },
    requiredWhen: { canonicalKey: 'collateralProperty.type', equals: 'other' },
  }),
  defineField({
    canonicalKey: 'collateralProperty.address',
    label: 'Adres nieruchomości stanowiącej zabezpieczenie',
    type: 'text',
    group: 'property',
    question: 'Podaj adres nieruchomości stanowiącej zabezpieczenie',
    semanticDescription: 'Pełny adres odrębnej nieruchomości stanowiącej zabezpieczenie kredytu.',
    semanticRole: 'property.collateral.address.full',
    aliases: ['adres zabezpieczenia'],
    exclude: ['adres nieruchomości kredytowanej'],
  }),
  defineField({
    canonicalKey: 'collateralProperty.landRegisterNumber',
    label: 'Księga wieczysta nieruchomości stanowiącej zabezpieczenie',
    type: 'text',
    group: 'property',
    question: 'Podaj numer księgi wieczystej nieruchomości stanowiącej zabezpieczenie',
    semanticDescription: 'Numer księgi wieczystej odrębnej nieruchomości stanowiącej zabezpieczenie.',
    semanticRole: 'property.collateral.landRegister',
    aliases: ['KW zabezpieczenia'],
    exclude: ['KW nieruchomości kredytowanej'],
  }),
  defineField({
    canonicalKey: 'collateralProperty.marketValue',
    label: 'Wartość nieruchomości stanowiącej zabezpieczenie',
    type: 'currency',
    group: 'property',
    question: 'Podaj wartość nieruchomości stanowiącej zabezpieczenie',
    semanticDescription: 'Cena lub wartość rynkowa odrębnej nieruchomości stanowiącej zabezpieczenie.',
    semanticRole: 'property.collateral.marketValue',
    aliases: ['wartość zabezpieczenia'],
    exclude: ['wartość nieruchomości kredytowanej'],
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'additionalProducts.enabled',
    label: 'Oferta z usługami dodatkowymi',
    type: 'boolean',
    group: 'loan',
    question: 'Czy wybierasz ofertę z usługami dodatkowymi?',
    semanticDescription: 'Wybór wariantu oferty kredytu hipotecznego z produktami dodatkowymi.',
    semanticRole: 'loan.additionalProducts.enabled',
    aliases: ['usługi dodatkowe tak nie'],
    exclude: [],
  }),
  ...([
    ['lifeInsurance', 'Ubezpieczenie na życie'],
    ['propertyInsurance', 'Ubezpieczenie nieruchomości'],
    ['personalAccount', 'Konto osobiste'],
    ['creditCard', 'Karta kredytowa'],
  ] as const).map(([key, label]) => defineField({
    canonicalKey: `additionalProducts.${key}`,
    label,
    type: 'boolean',
    group: 'loan',
    question: `Czy wybierasz: ${label.toLocaleLowerCase('pl-PL')}?`,
    semanticDescription: `Wybór produktu dodatkowego: ${label.toLocaleLowerCase('pl-PL')}.`,
    semanticRole: `loan.additionalProducts.${key}`,
    aliases: [label],
    exclude: [],
    visibleWhen: { canonicalKey: 'additionalProducts.enabled', equals: 'true' },
  })),
  defineField({
    canonicalKey: 'additionalProducts.creditCardApplicantIndex',
    label: 'Wnioskodawca karty kredytowej',
    type: 'select',
    group: 'loan',
    question: 'Wybierz wnioskodawcę nowej karty kredytowej',
    helpText: 'Wybierz osobę ze sprawy — imię i nazwisko zostanie wpisane do dokumentów automatycznie.',
    semanticDescription: 'Referencja do wnioskodawcy składającego wniosek o nową kartę kredytową.',
    semanticRole: 'loan.additionalProducts.creditCard.applicantReference',
    aliases: ['wybór wnioskodawcy karty'],
    exclude: ['imię wpisane ręcznie'],
    options: APPLICANT_REFERENCE_OPTIONS,
    visibleWhen: { canonicalKey: 'additionalProducts.creditCard', equals: 'true' },
    requiredWhen: { canonicalKey: 'additionalProducts.creditCard', equals: 'true' },
  }),
  defineField({
    canonicalKey: 'additionalProducts.creditCardApplicant',
    label: 'Wnioskodawca karty kredytowej',
    type: 'text',
    group: 'loan',
    question: 'Podaj imię i nazwisko wnioskodawcy nowej karty kredytowej',
    semanticDescription: 'Imię i nazwisko osoby składającej wniosek o nową kartę kredytową.',
    semanticRole: 'loan.additionalProducts.creditCard.applicant',
    aliases: ['karta kredytowa dla wnioskodawcy'],
    exclude: [],
    visibleWhen: { canonicalKey: 'additionalProducts.creditCard', equals: 'true' },
    requiredWhen: { canonicalKey: 'additionalProducts.creditCard', equals: 'true' },
  }),
  defineField({
    canonicalKey: 'additionalProducts.creditCardLimit',
    label: 'Limit nowej karty kredytowej',
    type: 'currency',
    group: 'loan',
    question: 'Podaj limit nowej karty kredytowej',
    semanticDescription: 'Wnioskowany limit kredytowy nowej karty.',
    semanticRole: 'loan.additionalProducts.creditCard.limit',
    aliases: ['limit kredytowy karty'],
    exclude: ['kwota kredytu hipotecznego'],
    visibleWhen: { canonicalKey: 'additionalProducts.creditCard', equals: 'true' },
    requiredWhen: { canonicalKey: 'additionalProducts.creditCard', equals: 'true' },
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'consents.earlyCreditDecision',
    label: 'Decyzja kredytowa przed 21. dniem',
    type: 'boolean',
    group: 'application',
    question: 'Czy zgadzasz się na przekazanie decyzji kredytowej przed 21. dniem?',
    semanticDescription: 'Zgoda na przekazanie decyzji kredytowej przed upływem 21 dni od otrzymania przez bank kompletnego wniosku, czyli kompletu danych i dokumentów wymaganych do oceny zdolności kredytowej.',
    semanticRole: 'application.consent.earlyDecision',
    aliases: ['decyzja przed 21 dniem'],
    exclude: [],
  }),
  defineField({
    canonicalKey: 'application.submissionChannel',
    label: 'Miejsce złożenia wniosku',
    type: 'select',
    group: 'application',
    question: 'Wybierz kanał złożenia wniosku',
    semanticDescription: 'Kanał, za pośrednictwem którego wniosek trafia do banku.',
    semanticRole: 'application.submission.channel',
    aliases: ['gdzie składasz wniosek'],
    exclude: ['miejscowość złożenia'],
    options: SUBMISSION_CHANNEL_OPTIONS,
  }),
  defineField({
    canonicalKey: 'intermediary.kind',
    label: 'Rodzaj podmiotu przyjmującego wniosek',
    type: 'select',
    group: 'application',
    question: 'Wybierz rodzaj pośrednika lub agenta',
    semanticDescription: 'Rodzaj podmiotu zewnętrznego przyjmującego wniosek.',
    semanticRole: 'application.intermediary.kind',
    aliases: ['pośrednik lub agent'],
    exclude: [],
    options: INTERMEDIARY_KIND_OPTIONS,
    visibleWhen: { canonicalKey: 'application.submissionChannel', equals: ['intermediary', 'agent_or_partner'] },
  }),
  ...([
    ['name', 'Nazwa pośrednika lub placówki', 'Podaj nazwę pośrednika lub placówki partnerskiej'],
    ['email', 'E-mail pośrednika lub placówki', 'Podaj adres e-mail pośrednika lub placówki'],
    ['phone', 'Telefon pośrednika lub placówki', 'Podaj telefon pośrednika lub placówki'],
    ['acceptingPerson', 'Osoba przyjmująca wniosek', 'Podaj imię i nazwisko osoby przyjmującej wniosek'],
    ['agentName', 'Imię i nazwisko agenta', 'Podaj imię i nazwisko agenta'],
  ] as const).map(([key, label, question]) => defineField({
    canonicalKey: `intermediary.${key}`,
    label,
    type: 'text',
    group: 'application',
    question,
    semanticDescription: `${label} uczestniczącego w przekazaniu wniosku do banku.`,
    semanticRole: `application.intermediary.${key}`,
    aliases: [label],
    exclude: [],
    visibleWhen: { canonicalKey: 'application.submissionChannel', equals: ['intermediary', 'agent_or_partner'] },
  })),
  defineField({
    canonicalKey: 'declarations.art17Information',
    label: 'Potwierdzenie przekazania informacji z art. 17',
    type: 'boolean',
    group: 'application',
    question: 'Czy przekazano informacje wymagane przez art. 17 ustawy o kredycie hipotecznym?',
    semanticDescription: 'Oświadczenie klienta o otrzymaniu informacji wymaganych przez art. 17.',
    semanticRole: 'application.declaration.art17Information',
    aliases: ['informacje art. 17'],
    exclude: [],
  }),
  defineField({
    canonicalKey: 'declarations.remunerationInformation',
    label: 'Potwierdzenie informacji o wynagrodzeniu',
    type: 'boolean',
    group: 'application',
    question: 'Czy przekazano informację o wynagrodzeniu pośrednika, agenta lub placówki?',
    semanticDescription: 'Oświadczenie o otrzymaniu informacji o wynagrodzeniu podmiotu pośredniczącego.',
    semanticRole: 'application.declaration.remunerationInformation',
    aliases: ['informacja o wynagrodzeniu'],
    exclude: [],
  }),
  defineField({
    canonicalKey: 'declarations.intermediaryTransfersToAgent',
    label: 'Przekazanie wniosku przez pośrednika do agenta',
    type: 'boolean',
    group: 'application',
    question: 'Czy pośrednik przekaże przyjęty wniosek do agenta?',
    semanticDescription: 'Oświadczenie, czy pośrednik przekaże wniosek współpracującemu agentowi.',
    semanticRole: 'application.declaration.intermediaryTransferToAgent',
    aliases: ['pośrednik przekaże wniosek agentowi'],
    exclude: [],
  }),
  defineField({
    canonicalKey: 'declarations.transferAgentName',
    label: 'Agent, któremu pośrednik przekaże wniosek',
    type: 'text',
    group: 'application',
    question: 'Podaj imię i nazwisko agenta, któremu pośrednik przekaże wniosek',
    semanticDescription: 'Imię i nazwisko agenta, który otrzyma wniosek od pośrednika.',
    semanticRole: 'application.declaration.transferAgentName',
    aliases: ['imię i nazwisko agenta'],
    exclude: [],
    visibleWhen: { canonicalKey: 'declarations.intermediaryTransfersToAgent', equals: 'true' },
    requiredWhen: { canonicalKey: 'declarations.intermediaryTransfersToAgent', equals: 'true' },
  }),
] as const

const ERSTE_SUPPLEMENTAL_FIELDS = [
  defineField({
    canonicalKey: 'consents.electronicDocumentDelivery',
    label: 'Elektroniczne przekazywanie dokumentów bankowych',
    type: 'boolean',
    group: 'declarations',
    question: 'Czy wszyscy wnioskodawcy zgadzają się na elektroniczne przekazywanie dokumentów bankowych?',
    helpText: 'Dokumenty trafią na wskazane adresy e-mail, a hasło dostępu na numer telefonu.',
    semanticDescription: 'Wspólna zgoda wszystkich wnioskodawców na przekazywanie formularza informacyjnego, regulacji, decyzji i projektu umowy drogą elektroniczną.',
    semanticRole: 'application.consent.electronicDocumentDelivery',
    aliases: ['zgoda dla formy kontaktu', 'zgoda wszystkich wnioskodawców na e-mail'],
    exclude: ['zgoda marketingowa', 'zgoda na decyzję przed terminem'],
  }),
  defineField({
    canonicalKey: 'investor.name',
    label: 'Nazwa inwestora',
    type: 'text',
    group: 'investment',
    question: 'Podaj nazwę inwestora lub dewelopera',
    semanticDescription: 'Nazwa podmiotu, który realizuje inwestycję i składa oświadczenie dla Erste.',
    semanticRole: 'investment.investor.name',
    aliases: ['nazwa inwestora', 'nazwa dewelopera'],
    exclude: ['imię i nazwisko wnioskodawcy', 'nazwa pośrednika'],
  }),
  defineField({
    canonicalKey: 'investor.buyerDetails',
    label: 'Dane nabywcy dla inwestora',
    type: 'text',
    group: 'investment',
    question: 'Podaj dane nabywcy wskazane w umowie rezerwacyjnej',
    helpText: 'Wpisz dane dokładnie tak, jak w umowie rezerwacyjnej.',
    semanticDescription: 'Dane nabywcy przywołane przez inwestora w związku z zawartą umową rezerwacyjną.',
    semanticRole: 'investment.investor.buyerDetails',
    aliases: ['dane nabywcy', 'nabywca z umowy rezerwacyjnej'],
    exclude: ['dane inwestora', 'dane pośrednika'],
  }),
  defineField({
    canonicalKey: 'investor.garageShareIncluded',
    label: 'Nabywany udział w lokalu niemieszkalnym',
    type: 'boolean',
    group: 'investment',
    question: 'Czy nabywany jest odrębny udział w lokalu niemieszkalnym, np. hali garażowej?',
    semanticDescription: 'Informacja, czy transakcja obejmuje odrębne prawo do udziału w lokalu niemieszkalnym.',
    semanticRole: 'investment.investor.garageShare.included',
    aliases: ['udział w hali garażowej', 'udział w lokalu niemieszkalnym'],
    exclude: ['miejsce postojowe jako część lokalu'],
  }),
  defineField({
    canonicalKey: 'investor.garageSharePrice',
    label: 'Cena udziału w lokalu niemieszkalnym',
    type: 'currency',
    group: 'investment',
    question: 'Podaj cenę udziału w lokalu niemieszkalnym',
    semanticDescription: 'Cena odrębnie nabywanego udziału w lokalu niemieszkalnym, np. hali garażowej.',
    semanticRole: 'investment.investor.garageShare.price',
    aliases: ['cena udziału w hali garażowej'],
    exclude: ['cena lokalu mieszkalnego'],
    visibleWhen: { canonicalKey: 'investor.garageShareIncluded', equals: 'true' },
    requiredWhen: { canonicalKey: 'investor.garageShareIncluded', equals: 'true' },
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'investor.otherSharesIncluded',
    label: 'Nabywane inne udziały',
    type: 'boolean',
    group: 'investment',
    question: 'Czy transakcja obejmuje inne odrębne udziały, np. w drodze lub działce?',
    semanticDescription: 'Informacja, czy inwestor sprzedaje wraz z nieruchomością inne odrębne prawa udziałowe.',
    semanticRole: 'investment.investor.otherShares.included',
    aliases: ['inne udziały', 'udział w drodze', 'naziemne miejsce postojowe'],
    exclude: ['udział w hali garażowej'],
  }),
  defineField({
    canonicalKey: 'investor.otherSharesPrice',
    label: 'Cena innych udziałów',
    type: 'currency',
    group: 'investment',
    question: 'Podaj łączną cenę innych odrębnie nabywanych udziałów',
    semanticDescription: 'Łączna cena innych praw udziałowych nabywanych od inwestora.',
    semanticRole: 'investment.investor.otherShares.price',
    aliases: ['cena innych udziałów'],
    exclude: ['cena udziału w hali garażowej'],
    visibleWhen: { canonicalKey: 'investor.otherSharesIncluded', equals: 'true' },
    requiredWhen: { canonicalKey: 'investor.otherSharesIncluded', equals: 'true' },
    validation: { min: 0 },
  }),
  defineField({
    canonicalKey: 'investor.paymentTiming',
    label: 'Termin zapłaty ceny inwestorowi',
    type: 'select',
    group: 'investment',
    question: 'Kiedy nabywca zapłaci cenę inwestorowi?',
    semanticDescription: 'Moment zapłaty ceny względem aktu notarialnego przenoszącego własność.',
    semanticRole: 'investment.investor.payment.timing',
    aliases: ['nabywca zapłaci cenę', 'zapłata przed lub po akcie notarialnym'],
    exclude: ['termin wypłaty kredytu'],
    options: INVESTOR_PAYMENT_TIMING_OPTIONS,
  }),
  defineField({
    canonicalKey: 'investor.houseTargetDescription',
    label: 'Docelowy opis działki zabudowanej domem',
    type: 'textarea',
    group: 'investment',
    question: 'Podaj numer i powierzchnię działki, miejscowość, ulicę i numer budynku',
    semanticDescription: 'Pełny opis docelowego adresu oraz parametrów działki zabudowanej domem nabywanej od inwestora.',
    semanticRole: 'investment.investor.targetAddress.house',
    aliases: ['docelowy adres działki zabudowanej domem'],
    exclude: ['adres lokalu mieszkalnego'],
    visibleWhen: { canonicalKey: 'property.type', equals: 'house' },
  }),
  defineField({
    canonicalKey: 'investor.garageShareTargetDescription',
    label: 'Opis docelowego udziału w hali garażowej',
    type: 'textarea',
    group: 'investment',
    question: 'Podaj wysokość udziału, adres i numer księgi wieczystej hali',
    semanticDescription: 'Opis odrębnie nabywanego udziału w hali garażowej wraz z adresem i numerem księgi wieczystej.',
    semanticRole: 'investment.investor.targetAddress.garageShare',
    aliases: ['wysokość udziału, adres i numer KW hali'],
    exclude: ['adres lokalu mieszkalnego'],
    visibleWhen: { canonicalKey: 'investor.garageShareIncluded', equals: 'true' },
  }),
  defineField({
    canonicalKey: 'investor.paymentScheduleType',
    label: 'Sposób zapłaty ceny inwestorowi',
    type: 'select',
    group: 'investment',
    question: 'Czy nabywca zapłaci jednorazowo, czy w transzach?',
    semanticDescription: 'Sposób realizacji harmonogramu płatności ceny dla inwestora.',
    semanticRole: 'investment.investor.payment.scheduleType',
    aliases: ['harmonogram płatności jednorazowo lub w transzach'],
    exclude: ['wypłata kredytu jednorazowo lub w transzach'],
    options: DISBURSEMENT_OPTIONS,
    visibleWhen: { canonicalKey: 'investor.paymentTiming', equals: 'before_notarial_deed' },
    requiredWhen: { canonicalKey: 'investor.paymentTiming', equals: 'before_notarial_deed' },
  }),
  defineField({
    canonicalKey: 'investor.plotNumbers',
    label: 'Numery działek inwestycji',
    type: 'text',
    group: 'investment',
    question: 'Podaj numery działek, na których realizowana jest inwestycja',
    semanticDescription: 'Numery ewidencyjne działki albo działek, na których inwestor realizuje przedsięwzięcie.',
    semanticRole: 'investment.investor.plotNumbers',
    aliases: ['inwestycję realizujemy na działce numer'],
    exclude: ['numer księgi wieczystej'],
  }),
  defineField({
    canonicalKey: 'investor.constructionProgressPercent',
    label: 'Zaawansowanie prac budowlanych',
    type: 'number',
    group: 'investment',
    question: 'Podaj procent wykonanych prac budowlanych',
    semanticDescription: 'Deklarowany przez inwestora procent wykonania prac związanych z budową.',
    semanticRole: 'investment.investor.constructionProgressPercent',
    aliases: ['procent wykonanych prac', 'zaawansowanie budowy'],
    exclude: ['udział własnościowy'],
    validation: { min: 0, max: 100 },
  }),
  defineField({
    canonicalKey: 'investor.expectedOwnershipTransferDate',
    label: 'Planowana data aktu przenoszącego własność',
    type: 'date',
    group: 'investment',
    question: 'Podaj planowaną datę podpisania aktu notarialnego przeniesienia własności',
    semanticDescription: 'Termin przewidywany przez inwestora na podpisanie aktu notarialnego przenoszącego własność nieruchomości.',
    semanticRole: 'investment.investor.expectedOwnershipTransferDate',
    aliases: ['termin podpisania aktu notarialnego przeniesienia własności'],
    exclude: ['data umowy rezerwacyjnej'],
  }),
] as const

const BANK_DOMAIN_FIELDS = [
  defineCompactField({
    canonicalKey: 'loan.productType',
    label: 'Rodzaj produktu kredytowego',
    type: 'select',
    group: 'loan',
    question: 'Wybierz produkt kredytowy, o który składają wniosek klienci',
    options: LOAN_PRODUCT_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'loan.productTypeOther',
    label: 'Inny produkt kredytowy',
    type: 'text',
    group: 'loan',
    question: 'Opisz inny produkt kredytowy',
    visibleWhen: { canonicalKey: 'loan.productType', equals: 'other' },
    requiredWhen: { canonicalKey: 'loan.productType', equals: 'other' },
  }),
  defineCompactField({
    canonicalKey: 'loan.productVariant',
    label: 'Wariant produktu bankowego',
    type: 'select',
    group: 'loan',
    question: 'Wybierz wariant produktu wskazany w ofercie banku',
    semanticDescription: 'Bankowy wariant wspólnego typu produktu; używany tylko w formularzach, które rozróżniają nazwane warianty oferty.',
    options: LOAN_PRODUCT_VARIANT_OPTIONS,
    visibleWhen: { canonicalKey: 'loan.productType', equals: 'mortgage' },
    requiredWhen: { canonicalKey: 'loan.productType', equals: 'mortgage' },
  }),
  defineCompactField({
    canonicalKey: 'loan.firstTrancheArbitraryPurposeEnabled',
    label: 'Cel dowolny w pierwszej transzy',
    type: 'boolean',
    group: 'loan',
    question: 'Czy część kredytu na cel dowolny ma zostać wypłacona w pierwszej transzy?',
  }),
  defineCompactField({
    canonicalKey: 'loan.firstTrancheArbitraryPurposeAmount',
    label: 'Kwota celu dowolnego w pierwszej transzy',
    type: 'currency',
    group: 'loan',
    visibleWhen: { canonicalKey: 'loan.firstTrancheArbitraryPurposeEnabled', equals: 'true' },
    requiredWhen: { canonicalKey: 'loan.firstTrancheArbitraryPurposeEnabled', equals: 'true' },
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'investment.landValue',
    label: 'Wartość działki jako wkład własny',
    type: 'currency',
    group: 'investment',
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'investment.financialSurplusEnabled',
    label: 'Nadwyżki finansowe jako przyszły wkład',
    type: 'boolean',
    group: 'investment',
  }),
  defineCompactField({
    canonicalKey: 'investment.financialSurplusAmount',
    label: 'Kwota nadwyżek finansowych',
    type: 'currency',
    group: 'investment',
    visibleWhen: { canonicalKey: 'investment.financialSurplusEnabled', equals: 'true' },
    requiredWhen: { canonicalKey: 'investment.financialSurplusEnabled', equals: 'true' },
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'loan.repaymentAccountType',
    label: 'Rachunek spłaty kredytu',
    type: 'select',
    group: 'loan',
    options: REPAYMENT_ACCOUNT_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'loan.repaymentAccountNumber',
    label: 'Numer rachunku do spłaty',
    type: 'text',
    group: 'loan',
    visibleWhen: { canonicalKey: 'loan.repaymentAccountType', equals: 'existing_personal_account' },
    requiredWhen: { canonicalKey: 'loan.repaymentAccountType', equals: 'existing_personal_account' },
    validation: { pattern: '^(?=(?:\\s*\\d){26}\\s*$)[\\d\\s]+$' },
  }),
  defineCompactField({
    canonicalKey: 'loan.totalDisbursementDate',
    label: 'Termin całkowitej wypłaty kredytu',
    type: 'date',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'investment.completionDate',
    label: 'Termin zakończenia inwestycji',
    type: 'date',
    group: 'investment',
  }),
  ...([
    ['outstandingAmount', 'Saldo refinansowanego kredytu', 'currency'],
    ['monthlyInstallment', 'Rata refinansowanego kredytu', 'currency'],
    ['currency', 'Waluta refinansowanego kredytu', 'text'],
    ['originationYear', 'Rok udzielenia refinansowanego kredytu', 'number'],
    ['originationMonth', 'Miesiąc udzielenia refinansowanego kredytu', 'number'],
  ] as const).map(([key, label, type]) => defineCompactField({
    canonicalKey: `refinancedLoan.${key}`,
    label,
    type,
    group: 'liabilities',
    visibleWhen: {
      canonicalKey: 'loan.purpose',
      equals: [
        'refinancing',
        'refinance_with_renovation_no_permit',
        'refinance_with_renovation_permit',
      ],
    },
    ...(
      key === 'originationMonth'
        ? { validation: { min: 1, max: 12, integer: true } }
        : key === 'originationYear'
          ? { validation: { min: 1900, max: 2100, integer: true } }
          : type === 'currency'
            ? { validation: { min: 0 } }
            : {}
    ),
  })),
  defineCompactField({
    canonicalKey: 'loan.constructionPermitRequired',
    label: 'Wymagane pozwolenie na budowę',
    type: 'boolean',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'loan.contractChangeRequested',
    label: 'Wnioskowana zmiana umowy',
    type: 'boolean',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'loan.contractChangeDescription',
    label: 'Opis wnioskowanej zmiany umowy',
    type: 'textarea',
    group: 'loan',
    visibleWhen: { canonicalKey: 'loan.contractChangeRequested', equals: 'true' },
    requiredWhen: { canonicalKey: 'loan.contractChangeRequested', equals: 'true' },
  }),
  ...([
    ['municipality', 'Gmina nieruchomości'],
    ['district', 'Dzielnica nieruchomości'],
  ] as const).map(([key, label]) => defineCompactField({
    canonicalKey: `property.address.${key}`,
    label,
    type: 'text',
    group: 'property',
  })),
  defineCompactField({
    canonicalKey: 'property.usableArea',
    label: 'Powierzchnia użytkowa nieruchomości',
    type: 'number',
    group: 'property',
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'property.hasBasement',
    label: 'Podpiwniczenie budynku',
    type: 'boolean',
    group: 'property',
  }),
  defineCompactField({
    canonicalKey: 'property.buildingFootprintArea',
    label: 'Powierzchnia zabudowy budynku',
    type: 'number',
    group: 'property',
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'property.totalArea',
    label: 'Powierzchnia całkowita budynku',
    type: 'number',
    group: 'property',
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'property.targetFinishStandard',
    label: 'Docelowy standard wykończenia',
    type: 'select',
    group: 'property',
    options: PEKAO_FINISH_STANDARD_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'property.aboveGroundFloors',
    label: 'Liczba kondygnacji nadziemnych',
    type: 'number',
    group: 'property',
    validation: { min: 1, max: 20, integer: true },
  }),
  defineCompactField({
    canonicalKey: 'property.buildingForm',
    label: 'Forma zabudowy budynku',
    type: 'select',
    group: 'property',
    options: BUILDING_FORM_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'property.preWorksValue',
    label: 'Wartość nieruchomości przed pracami',
    type: 'currency',
    group: 'property',
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'property.constructionYear',
    label: 'Rok budowy nieruchomości',
    type: 'number',
    group: 'property',
    validation: { min: 1800, max: 2100, integer: true },
  }),
  defineCompactField({
    canonicalKey: 'property.outdoorParkingSpaces',
    label: 'Liczba zewnętrznych miejsc postojowych',
    type: 'number',
    group: 'property',
    validation: { min: 0, integer: true },
  }),
  defineCompactField({
    canonicalKey: 'property.indoorParkingSpaces',
    label: 'Liczba miejsc postojowych w budynku',
    type: 'number',
    group: 'property',
    validation: { min: 0, integer: true },
  }),
  defineCompactField({
    canonicalKey: 'property.ownershipType',
    label: 'Forma prawna nieruchomości',
    type: 'select',
    group: 'property',
    options: PROPERTY_OWNERSHIP_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'property.ownershipSequence',
    label: 'Kolejność nabywanej nieruchomości',
    type: 'select',
    group: 'property',
    options: PROPERTY_OWNERSHIP_SEQUENCE_OPTIONS,
  }),
  ...([
    ['city', 'Miejscowość nieruchomości stanowiącej zabezpieczenie'],
    ['voivodeship', 'Województwo nieruchomości stanowiącej zabezpieczenie'],
    ['county', 'Powiat nieruchomości stanowiącej zabezpieczenie'],
    ['municipality', 'Gmina nieruchomości stanowiącej zabezpieczenie'],
    ['district', 'Dzielnica nieruchomości stanowiącej zabezpieczenie'],
    ['postalCode', 'Kod pocztowy nieruchomości stanowiącej zabezpieczenie'],
    ['street', 'Ulica nieruchomości stanowiącej zabezpieczenie'],
    ['houseAndUnit', 'Numer domu i lokalu nieruchomości stanowiącej zabezpieczenie'],
  ] as const).map(([key, label]) => defineCompactField({
    canonicalKey: `collateralProperty.address.${key}`,
    label,
    type: 'text',
    group: 'property',
    ...(key === 'postalCode' ? { validation: { pattern: '^\\d{2}-\\d{3}$' } } : {}),
  })),
  defineCompactField({
    canonicalKey: 'collateralProperty.usableArea',
    label: 'Powierzchnia użytkowa zabezpieczenia',
    type: 'number',
    group: 'property',
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'collateralProperty.constructionYear',
    label: 'Rok budowy nieruchomości stanowiącej zabezpieczenie',
    type: 'number',
    group: 'property',
    validation: { min: 1800, max: 2100, integer: true },
  }),
  defineCompactField({
    canonicalKey: 'loan.refinancedDepositAmount',
    label: 'Kwota refinansowanego zadatku',
    type: 'currency',
    group: 'loan',
    validation: { min: 0 },
  }),
  defineCompactField({
    canonicalKey: 'loan.currency',
    label: 'Waluta kredytu',
    type: 'text',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'loan.currencyIndex',
    label: 'Indeks walutowy kredytu',
    type: 'text',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'loan.cpiPremiumFinancing',
    label: 'Finansowanie składki ubezpieczenia CPI',
    type: 'select',
    group: 'loan',
    options: YES_NO_NOT_APPLICABLE_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'loan.paymentGraceMonths',
    label: 'Karencja w płatności rat w miesiącach',
    type: 'number',
    group: 'loan',
    validation: { min: 0, max: 120, integer: true },
  }),
  ...([
    ['bankAccounts', 'Środki na rachunkach bankowych'],
    ['investmentFunds', 'Środki w funduszach inwestycyjnych'],
    ['guaranteePremium', 'Środki na składkę gwarancyjną'],
    ['other', 'Inne źródło wkładu własnego'],
  ] as const).flatMap(([key, label]) => [
    defineCompactField({
      canonicalKey: `investment.ownFundsSources.${key}.selected`,
      label: `${label} — wybrane`,
      type: 'boolean',
      group: 'investment',
      question: `Czy źródłem wkładu własnego są: ${label.toLocaleLowerCase('pl-PL')}?`,
    }),
    defineCompactField({
      canonicalKey: `investment.ownFundsSources.${key}.amount`,
      label: `${label} — kwota`,
      type: 'currency',
      group: 'investment',
      visibleWhen: { canonicalKey: `investment.ownFundsSources.${key}.selected`, equals: 'true' },
      requiredWhen: { canonicalKey: `investment.ownFundsSources.${key}.selected`, equals: 'true' },
      validation: { min: 0 },
    }),
  ]),
  ...([
    ['financedPropertyMortgage', 'Hipoteka na kredytowanej nieruchomości'],
    ['otherPropertyMortgage', 'Hipoteka na innej nieruchomości'],
    ['lifeInsurance', 'Ubezpieczenie na życie jako zabezpieczenie'],
    ['bankInsurance', 'Ubezpieczenie banku jako zabezpieczenie'],
  ] as const).map(([key, label]) => defineCompactField({
    canonicalKey: `loan.securities.${key}`,
    label,
    type: 'boolean',
    group: 'loan',
  })),
  defineCompactField({
    canonicalKey: 'loan.securities.otherDescription',
    label: 'Inne zabezpieczenie kredytu',
    type: 'textarea',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'loan.mortgageEstablishmentMode',
    label: 'Sposób ustanowienia hipoteki',
    type: 'select',
    group: 'loan',
    options: MORTGAGE_ESTABLISHMENT_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'property.publicRoadAccessType',
    label: 'Dostęp do drogi publicznej',
    type: 'select',
    group: 'property',
    options: PUBLIC_ROAD_ACCESS_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'property.accessRoadLandRegisterNumber',
    label: 'Numer KW drogi dojazdowej',
    type: 'text',
    group: 'property',
  }),
  defineCompactField({
    canonicalKey: 'property.accessRoadShareMortgage',
    label: 'Hipoteka na udziale w drodze dojazdowej',
    type: 'boolean',
    group: 'property',
  }),
  defineCompactField({
    canonicalKey: 'property.accessRoadShare',
    label: 'Udział w nieruchomości drogowej',
    type: 'text',
    group: 'property',
    helpText: 'Podaj udział jako ułamek, na przykład 1/8.',
    validation: { pattern: '^\\s*\\d+\\s*/\\s*\\d+\\s*$' },
  }),
  defineCompactField({
    canonicalKey: 'property.appraiserChoice',
    label: 'Wybór rzeczoznawcy majątkowego',
    type: 'select',
    group: 'property',
    options: APPRAISER_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'property.appraiserDetails',
    label: 'Dane innego rzeczoznawcy',
    type: 'text',
    group: 'property',
    visibleWhen: { canonicalKey: 'property.appraiserChoice', equals: 'other' },
    requiredWhen: { canonicalKey: 'property.appraiserChoice', equals: 'other' },
  }),
  defineCompactField({
    canonicalKey: 'property.appraisalSource',
    label: 'Źródło operatu szacunkowego',
    type: 'select',
    group: 'property',
    options: APPRAISAL_SOURCE_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'additionalProducts.systematicAccountInflows',
    label: 'Systematyczne wpływy na rachunek',
    type: 'boolean',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'additionalProducts.cpiInterested',
    label: 'Zainteresowanie ubezpieczeniem CPI',
    type: 'boolean',
    group: 'loan',
  }),
  defineCompactField({
    canonicalKey: 'declarations.otherEnabled',
    label: 'Inne wnioski lub deklaracje',
    type: 'boolean',
    group: 'declarations',
  }),
  defineCompactField({
    canonicalKey: 'declarations.otherLine1',
    label: 'Inne wnioski lub deklaracje — wiersz 1',
    type: 'text',
    group: 'declarations',
    visibleWhen: { canonicalKey: 'declarations.otherEnabled', equals: 'true' },
  }),
  defineCompactField({
    canonicalKey: 'declarations.otherLine2',
    label: 'Inne wnioski lub deklaracje — wiersz 2',
    type: 'text',
    group: 'declarations',
    visibleWhen: { canonicalKey: 'declarations.otherEnabled', equals: 'true' },
  }),
  defineCompactField({
    canonicalKey: 'declarations.ownContributionFromCredit',
    label: 'Wkład własny pochodzi z kredytu, pożyczki lub dotacji',
    type: 'boolean',
    group: 'declarations',
  }),
  defineCompactField({
    canonicalKey: 'declarations.riskAwareness',
    label: 'Świadomość ryzyka stopy procentowej i cen zabezpieczeń',
    type: 'boolean',
    group: 'declarations',
  }),
  defineCompactField({
    canonicalKey: 'declarations.sellerIsCloseRelative',
    label: 'Sprzedający jest osobą blisko spokrewnioną',
    type: 'boolean',
    group: 'declarations',
  }),
  defineCompactField({
    canonicalKey: 'declarations.selectedLoanRiskVariant',
    label: 'Wariant ryzyka kredytowego objęty oświadczeniem',
    type: 'select',
    group: 'declarations',
    question: 'Wybierz wariant kredytu, którego dotyczy oświadczenie o ryzyku',
    semanticDescription: 'Wariant produktu wskazany w oświadczeniu klienta o ryzyku stopy procentowej albo indeksacji walutowej.',
    options: LOAN_RISK_VARIANT_OPTIONS,
  }),
  defineCompactField({
    canonicalKey: 'consents.interbankInformationSharing',
    label: 'Zgoda na wymianę informacji między bankami grupy',
    type: 'boolean',
    group: 'declarations',
  }),
  defineCompactField({
    canonicalKey: 'consents.receiveContractDraft',
    label: 'Zgoda na otrzymanie projektu umowy',
    type: 'boolean',
    group: 'declarations',
  }),
  defineCompactField({
    canonicalKey: 'consents.creditDecisionByEmail',
    label: 'Decyzja kredytowa pocztą elektroniczną',
    type: 'boolean',
    group: 'declarations',
  }),
  defineCompactField({
    canonicalKey: 'consents.creditDecisionEmail',
    label: 'Adres e-mail do decyzji kredytowej',
    type: 'text',
    group: 'declarations',
    visibleWhen: { canonicalKey: 'consents.creditDecisionByEmail', equals: 'true' },
    requiredWhen: { canonicalKey: 'consents.creditDecisionByEmail', equals: 'true' },
    validation: { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
  }),
  ...([
    ['pekao24', 'Powiadomienia w Pekao24'],
    ['email', 'Powiadomienia pocztą elektroniczną'],
    ['postal', 'Powiadomienia pocztą tradycyjną'],
  ] as const).map(([key, label]) => defineCompactField({
    canonicalKey: `notifications.${key}`,
    label,
    type: 'boolean',
    group: 'declarations',
  })),
] as const

export const CANONICAL_FIELDS = [
  ...APPLICATION_FIELDS,
  ...APPLICANT_FIELDS,
  ...KIK_APPLICANT_FIELDS,
  ...KIK_APPLICANT_LIABILITY_FIELDS,
  ...INCOME_APPLICANT_FIELDS,
  ...TRANCHE_FIELDS,
  ...INVESTOR_PAYMENT_FIELDS,
  ...ERSTE_PRELIMINARY_APPLICANT_FIELDS,
  ...EXTENDED_APPLICANT_FIELDS,
  ...HOUSEHOLD_FIELDS,
  ...LIABILITY_FIELDS,
  ...MORTGAGE_DISCHARGE_FIELDS,
  ...COLLATERAL_PROPERTY_FIELDS,
  ...DOMAIN_FIELDS,
  ...ERSTE_SUPPLEMENTAL_FIELDS,
  ...BANK_DOMAIN_FIELDS,
] satisfies readonly CanonicalFieldDefinition[]

export type CanonicalFieldKey = typeof CANONICAL_FIELDS[number]['canonicalKey']
export type CanonicalComputedBindingKey = typeof CANONICAL_COMPUTED_BINDINGS[number]['canonicalKey']
export type CanonicalBindingKey = CanonicalFieldKey | CanonicalComputedBindingKey
