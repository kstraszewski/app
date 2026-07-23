import type {
  CanonicalCollectionDefinition,
  CanonicalFieldDefinition,
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

export const CANONICAL_COLLECTIONS = [
  {
    key: 'applicants',
    label: 'Wnioskodawcy',
    itemLabel: 'Wnioskodawca',
    minItems: 1,
    maxItems: 2,
    requiredRelativeKeys: ['firstName', 'lastName', 'pesel'],
  },
] as const satisfies readonly CanonicalCollectionDefinition[]

function applicantField(index: 0 | 1, relativeKey: string, label: string) {
  return {
    key: 'applicants',
    index,
    relativeKey,
    label,
  }
}

export const CANONICAL_FIELDS = [
  { canonicalKey: 'application.place', label: 'Miejscowość złożenia wniosku', type: 'text', group: 'application' },
  { canonicalKey: 'application.date', label: 'Data złożenia wniosku', type: 'date', group: 'application' },
  { canonicalKey: 'applicants.0.firstName', label: 'Wnioskodawca 1 - imię', type: 'text', group: 'applicants', collection: applicantField(0, 'firstName', 'Imię') },
  { canonicalKey: 'applicants.0.lastName', label: 'Wnioskodawca 1 - nazwisko', type: 'text', group: 'applicants', collection: applicantField(0, 'lastName', 'Nazwisko') },
  {
    canonicalKey: 'applicants.0.pesel',
    label: 'Wnioskodawca 1 - PESEL',
    type: 'text',
    group: 'applicants',
    collection: applicantField(0, 'pesel', 'PESEL'),
    validation: { pattern: '^\\d{11}$' },
  },
  { canonicalKey: 'applicants.1.firstName', label: 'Wnioskodawca 2 - imię', type: 'text', group: 'applicants', collection: applicantField(1, 'firstName', 'Imię') },
  { canonicalKey: 'applicants.1.lastName', label: 'Wnioskodawca 2 - nazwisko', type: 'text', group: 'applicants', collection: applicantField(1, 'lastName', 'Nazwisko') },
  {
    canonicalKey: 'applicants.1.pesel',
    label: 'Wnioskodawca 2 - PESEL',
    type: 'text',
    group: 'applicants',
    collection: applicantField(1, 'pesel', 'PESEL'),
    validation: { pattern: '^\\d{11}$' },
  },
  { canonicalKey: 'loan.purpose', label: 'Cel kredytu', type: 'select', group: 'loan', options: PURPOSE_OPTIONS },
  {
    canonicalKey: 'loan.purposeOther',
    label: 'Opisz inny cel kredytu',
    type: 'textarea',
    group: 'loan',
    description: 'Opis zostanie wpisany obok zaznaczonej opcji „Inny cel” w każdym dokumencie, który go wymaga.',
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'other' },
    requiredWhen: { canonicalKey: 'loan.purpose', equals: 'other' },
  },
  {
    canonicalKey: 'loan.constructionMethod',
    label: 'Sposób realizacji budowy',
    type: 'select',
    group: 'loan',
    options: CONSTRUCTION_METHOD_OPTIONS,
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'construction' },
    requiredWhen: { canonicalKey: 'loan.purpose', equals: 'construction' },
  },
  {
    canonicalKey: 'loan.renovationPermit',
    label: 'Wariant remontu',
    type: 'select',
    group: 'loan',
    options: RENOVATION_PERMIT_OPTIONS,
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    requiredWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
  },
  { canonicalKey: 'loan.amount', label: 'Kwota kredytu', type: 'currency', group: 'loan', validation: { min: 0 } },
  {
    canonicalKey: 'loan.renovationAmount',
    label: 'Część kwoty kredytu przeznaczona na remont',
    type: 'currency',
    group: 'loan',
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    validation: { min: 0 },
  },
  { canonicalKey: 'loan.termMonths', label: 'Okres kredytowania w miesiącach', type: 'number', group: 'loan', validation: { min: 1, max: 600, integer: true } },
  { canonicalKey: 'loan.repaymentDay', label: 'Dzień spłaty raty', type: 'number', group: 'loan', validation: { min: 1, max: 31, integer: true } },
  { canonicalKey: 'investment.totalCost', label: 'Cena zakupu lub całkowity koszt inwestycji', type: 'currency', group: 'investment', validation: { min: 0 } },
  {
    canonicalKey: 'investment.renovationCost',
    label: 'Koszt remontu lub wykończenia',
    type: 'currency',
    group: 'investment',
    visibleWhen: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    validation: { min: 0 },
  },
  {
    canonicalKey: 'investment.ownFundsPaid',
    label: 'Wkład własny już wniesiony',
    type: 'currency',
    group: 'investment',
    validation: { min: 0 },
  },
  {
    canonicalKey: 'investment.ownFundsBeforeDisbursement',
    label: 'Wkład własny do wniesienia przed wypłatą kredytu',
    type: 'currency',
    group: 'investment',
    validation: { min: 0 },
  },
  {
    canonicalKey: 'investment.ownFundsDuringInvestment',
    label: 'Wkład własny do wniesienia w trakcie inwestycji',
    type: 'currency',
    group: 'investment',
    validation: { min: 0 },
  },
  {
    canonicalKey: 'investment.ownFundsContributionDates',
    label: 'Terminy wniesienia pozostałego wkładu własnego',
    type: 'text',
    group: 'investment',
  },
  {
    canonicalKey: 'investment.ownFunds',
    label: 'Środki własne łącznie',
    type: 'currency',
    group: 'investment',
    description: 'Wartość wyliczana automatycznie z etapów wniesienia wkładu własnego.',
    validation: { min: 0 },
  },
  { canonicalKey: 'loan.installmentType', label: 'Typ rat', type: 'select', group: 'loan', options: INSTALLMENT_OPTIONS },
  { canonicalKey: 'loan.interestType', label: 'Rodzaj oprocentowania', type: 'select', group: 'loan', options: INTEREST_OPTIONS },
  { canonicalKey: 'loan.disbursementType', label: 'Sposób wypłaty kredytu', type: 'select', group: 'loan', options: DISBURSEMENT_OPTIONS },
  { canonicalKey: 'property.type', label: 'Typ nieruchomości', type: 'select', group: 'property', options: PROPERTY_TYPE_OPTIONS },
  {
    canonicalKey: 'property.typeOther',
    label: 'Opisz inny typ nieruchomości',
    type: 'text',
    group: 'property',
    visibleWhen: { canonicalKey: 'property.type', equals: 'other' },
    requiredWhen: { canonicalKey: 'property.type', equals: 'other' },
  },
  { canonicalKey: 'property.address.street', label: 'Ulica', type: 'text', group: 'property' },
  { canonicalKey: 'property.address.houseNumber', label: 'Numer domu', type: 'text', group: 'property' },
  { canonicalKey: 'property.address.unitNumber', label: 'Numer lokalu', type: 'text', group: 'property' },
  {
    canonicalKey: 'property.address.postalCode',
    label: 'Kod pocztowy',
    type: 'text',
    group: 'property',
    validation: { pattern: '^\\d{2}-\\d{3}$' },
  },
  { canonicalKey: 'property.address.city', label: 'Miejscowość nieruchomości', type: 'text', group: 'property' },
  { canonicalKey: 'property.address.county', label: 'Powiat', type: 'text', group: 'property' },
  { canonicalKey: 'property.address.voivodeship', label: 'Województwo', type: 'text', group: 'property' },
  { canonicalKey: 'property.landRegisterNumber', label: 'Numer księgi wieczystej', type: 'text', group: 'property' },
  { canonicalKey: 'property.marketValue', label: 'Wartość nieruchomości', type: 'currency', group: 'property', validation: { min: 0 } },
] as const satisfies readonly CanonicalFieldDefinition[]

export type CanonicalFieldKey = typeof CANONICAL_FIELDS[number]['canonicalKey']
