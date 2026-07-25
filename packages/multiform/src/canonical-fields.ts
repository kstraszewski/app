import type {
  CanonicalCollectionDefinition,
  CanonicalComputedBindingDefinition,
  CanonicalFieldDefinition,
  CanonicalFieldType,
} from './types.ts'

const PURPOSE_OPTIONS = [
  { value: 'purchase_primary', label: 'Zakup na rynku pierwotnym' },
  { value: 'purchase_secondary', label: 'Zakup na rynku wtórnym' },
  { value: 'construction', label: 'Budowa domu' },
  { value: 'renovation', label: 'Remont lub wykończenie' },
  { value: 'refinancing', label: 'Refinansowanie lub spłata kredytu' },
  { value: 'other', label: 'Inny cel' },
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

const PROPERTY_TYPE_OPTIONS = [
  { value: 'house', label: 'Dom' },
  { value: 'apartment', label: 'Mieszkanie' },
  { value: 'plot', label: 'Działka' },
  { value: 'other', label: 'Inna nieruchomość' },
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

export const APPLICANT_INDEXES = [0, 1, 2, 3, 4] as const
export const MAX_APPLICANTS = APPLICANT_INDEXES.length

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

export const CANONICAL_COLLECTIONS = [
  {
    key: 'applicants',
    label: 'Wnioskodawcy',
    itemLabel: 'Wnioskodawca',
    minItems: 1,
    maxItems: MAX_APPLICANTS,
    requiredRelativeKeys: ['firstName', 'lastName', 'pesel'],
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
] as const satisfies readonly CanonicalComputedBindingDefinition[]

export const CANONICAL_COMPUTED_BINDINGS = [
  ...APPLICANT_INDEXES.map(materializeApplicantFullName),
  ...STATIC_COMPUTED_BINDINGS,
] as const

const DOMAIN_FIELDS = [
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
] as const

export const CANONICAL_FIELDS = [
  ...APPLICATION_FIELDS,
  ...APPLICANT_FIELDS,
  ...DOMAIN_FIELDS,
] satisfies readonly CanonicalFieldDefinition[]

export type CanonicalFieldKey = typeof CANONICAL_FIELDS[number]['canonicalKey']
export type CanonicalComputedBindingKey = typeof CANONICAL_COMPUTED_BINDINGS[number]['canonicalKey']
export type CanonicalBindingKey = CanonicalFieldKey | CanonicalComputedBindingKey
