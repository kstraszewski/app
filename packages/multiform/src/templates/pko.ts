import type { DocumentTemplate, TemplateBinding } from '../types.ts'

const acro = (
  canonicalKey: string,
  field: string,
  valueMap?: Readonly<Record<string, string>>,
): TemplateBinding => ({
  canonicalKey,
  reviewStatus: 'ready',
  target: { kind: 'acroform', field, ...(valueMap ? { valueMap } : {}) },
})

const ADDRESS_PARTS = [
  'property.address.street',
  'property.address.houseNumber',
  'property.address.unitNumber',
  'property.address.postalCode',
  'property.address.city',
  'property.address.county',
  'property.address.voivodeship',
] as const

const OWN_FUNDS_PARTS = [
  'investment.ownFundsPaid',
  'investment.ownFundsBeforeDisbursement',
  'investment.ownFundsDuringInvestment',
] as const

const OWN_FUNDS_TO_CONTRIBUTE = [
  'investment.ownFundsBeforeDisbursement',
  'investment.ownFundsDuringInvestment',
] as const

export const PKO_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'pko-bp-mortgage-2022',
  bank: 'pko-bp',
  label: 'PKO BP - wniosek o udzielenie kredytu lub pożyczki',
  version: 1,
  source: {
    fileName: 'pko-bp-wniosek-o-kredyt-hipoteczny.pdf',
    sha256: 'c6ee2244dee8959613b4fc1ae07e1a49878b47a0ba28f1a97aee7e164de6af3c',
    pageCount: 4,
    formKind: 'acroform',
    pages: Array.from({ length: 4 }, (_, index) => ({
      page: index + 1,
      mediaBox: { x: 0, y: 0, width: 595.2, height: 841.6 },
      cropBox: { x: 0, y: 0, width: 595.2, height: 841.6 },
      rotation: 0,
      userUnit: 1,
    })),
  },
  coverage: {
    status: 'incomplete',
    inScopeTargetCount: 144,
    mappedTargetCount: 43,
    manualUserActionCount: 4,
    excludedTargetCount: 38,
    notes: [
      'Pełny audyt AcroForm: 138 edytowalnych pól klienta i 6 pól wyliczanych.',
      '38 przycisków technicznych PDF wyłączono z pokrycia.',
    ],
  },
  bindings: [
    acro('application.place', 'miejscowosc'),
    { ...acro('application.date', 'data'), valueFormat: 'date.ddMMyyyy' },
    acro('applicants.0.firstName', 'imie1'),
    acro('applicants.0.lastName', 'nazwisko1'),
    acro('applicants.0.pesel', 'pesel1'),
    acro('applicants.1.firstName', 'imie2'),
    acro('applicants.1.lastName', 'nazwisko2'),
    acro('applicants.1.pesel', 'pesel2'),

    acro('loan.purpose', 'nabycie', { purchase_primary: 'tak', purchase_secondary: 'tak' }),
    acro('loan.purpose', 'budowa', { construction: 'tak' }),
    acro('loan.purpose', 'remont', { renovation: 'tak' }),
    acro('loan.purpose', 'refinansowanie', { refinancing: 'tak' }),
    acro('loan.purpose', 'inny_cel', { other: 'tak' }),
    {
      ...acro('loan.purposeOther', 'inny_cel_opis'),
      condition: { canonicalKey: 'loan.purpose', equals: 'other' },
    },
    acro('loan.amount', 'wnioskowany_kredyt'),
    {
      ...acro('loan.amount', 'inny_cel_kredyt'),
      condition: { canonicalKey: 'loan.purpose', equals: 'other' },
    },
    acro('loan.termMonths', 'okres_kredytowania'),
    acro('loan.repaymentDay', 'dzien_splaty'),
    {
      ...acro('investment.totalCost', 'nabycie_koszt'),
      condition: { canonicalKey: 'loan.purpose', equals: ['purchase_primary', 'purchase_secondary'] },
    },
    {
      ...acro('investment.totalCost', 'budowa_koszt'),
      condition: { canonicalKey: 'loan.purpose', equals: 'construction' },
    },
    {
      ...acro('investment.totalCost', 'inny_cel_koszt'),
      condition: { canonicalKey: 'loan.purpose', equals: 'other' },
    },
    acro('investment.renovationCost', 'wykonczenie_koszt'),
    {
      canonicalKey: 'investment.ownFunds',
      computed: true,
      valueFrom: OWN_FUNDS_PARTS,
      valueFormat: 'currency.sum',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'wlasne_razem' },
    },
    {
      canonicalKey: 'investment.ownFunds',
      computed: true,
      valueFrom: OWN_FUNDS_TO_CONTRIBUTE,
      valueFormat: 'currency.sum',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'wlasne_do_wniesienia_razem' },
    },
    acro('investment.ownFundsPaid', 'wlasne_zaangazowane'),
    acro('investment.ownFundsBeforeDisbursement', 'wlasne_do_wniesienia_przed'),
    acro('investment.ownFundsDuringInvestment', 'wlasne_do_wniesienia_po'),
    acro('loan.installmentType', 'formula_splaty_0', { equal: 'rowne' }),
    acro('loan.installmentType', 'formula_splaty_1', { decreasing: 'malejace' }),
    acro('loan.interestType', 'oprocentowanie_0', { variable: 'zmienne' }),
    acro('loan.interestType', 'oprocentowanie_1', { periodically_fixed: 'zmienne_ze_stala' }),
    acro('loan.disbursementType', 'uruchomienie_0', { tranches: 'transze' }),
    acro('loan.disbursementType', 'uruchomienie_1', { single: 'jednorazowe' }),
    acro('property.type', 'rodzaj_nieruchomosci_dom_jednorodzinny', { house: 'tak' }),
    acro('property.type', 'rodzaj_nieruchomosci_lokal', { apartment: 'tak' }),
    acro('property.type', 'rodzaj_nieruchomosci_dzialka_budowlana', { plot: 'tak' }),
    acro('property.type', 'rodzaj_nieruchomosci_inna', { other: 'tak' }),
    {
      ...acro('property.typeOther', 'rodzaj_nieruchomosci_inny'),
      condition: { canonicalKey: 'property.type', equals: 'other' },
    },
    {
      canonicalKey: 'property.address.full',
      computed: true,
      valueFrom: ADDRESS_PARTS,
      valueFormat: 'fullAddress',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'adres_inwestycji' },
    },
    {
      canonicalKey: 'property.landRegisterNumber',
      valueFormat: 'landRegister.part1',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'hipoteka_nieruchomosc1_kw1' },
    },
    {
      canonicalKey: 'property.landRegisterNumber',
      valueFormat: 'landRegister.part2',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'hipoteka_nieruchomosc1_kw2' },
    },
    {
      canonicalKey: 'property.landRegisterNumber',
      valueFormat: 'landRegister.part3',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'hipoteka_nieruchomosc1_kw3' },
    },
    acro('property.marketValue', 'docelowa_wartosc'),
  ],
}
