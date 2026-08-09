import type { DocumentTemplate, TemplateBinding, ValueFormat } from '../types.ts'
import { pkoAcroTarget } from './pko-widgets.ts'

type ConditionValue = string | readonly string[]

const acro = (
  canonicalKey: string,
  field: string,
  valueMap?: Readonly<Record<string, string>>,
): TemplateBinding => ({
  canonicalKey,
  reviewStatus: 'ready',
  target: pkoAcroTarget(field, valueMap),
})

const choice = (
  canonicalKey: string,
  field: string,
  values: ConditionValue,
  exportValue = 'tak',
): TemplateBinding => acro(
  canonicalKey,
  field,
  Object.fromEntries((Array.isArray(values) ? values : [values]).map(value => [value, exportValue])),
)

const booleanChoice = (
  canonicalKey: string,
  field: string,
  expected: boolean,
  exportValue = expected ? 'tak' : 'nie',
): TemplateBinding => acro(canonicalKey, field, { [String(expected)]: exportValue })

const conditioned = (
  canonicalKey: string,
  field: string,
  conditionKey: string,
  equals: ConditionValue,
): TemplateBinding => ({
  ...acro(canonicalKey, field),
  condition: { canonicalKey: conditionKey, equals },
})

const formatted = (
  canonicalKey: string,
  field: string,
  valueFormat: ValueFormat,
): TemplateBinding => ({
  ...acro(canonicalKey, field),
  valueFormat,
})

const computed = (
  canonicalKey: string,
  field: string,
  valueFrom: readonly string[],
  valueFormat: ValueFormat,
): TemplateBinding => ({
  canonicalKey,
  computed: true,
  valueFrom,
  valueFormat,
  reviewStatus: 'ready',
  target: pkoAcroTarget(field),
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

const PURCHASE_PURPOSES = [
  'purchase_primary',
  'purchase_secondary',
  'family_purchase_primary',
  'family_purchase_secondary',
] as const

const RENOVATION_PURPOSES = [
  'renovation',
  'family_renovation',
] as const

const CONSTRUCTION_PURPOSES = [
  'construction',
  'family_construction',
] as const

const DIRECT_INVESTMENT_PURPOSES = [
  ...PURCHASE_PURPOSES,
  'finishing',
  ...RENOVATION_PURPOSES,
  ...CONSTRUCTION_PURPOSES,
  'extension',
  'conversion_to_residential',
  'other',
] as const

const applicantBindings = [0, 1, 2, 3].flatMap(index => [
  acro(`applicants.${index}.firstName`, `imie${index + 1}`),
  acro(`applicants.${index}.lastName`, `nazwisko${index + 1}`),
  acro(`applicants.${index}.pesel`, `pesel${index + 1}`),
])

const occupyingApplicantBindings = [0, 1, 2, 3].map(index => acro(
  `applicants.${index}.willOccupyFinancedProperty`,
  `wnioskodawca_zamieszkujacy${index + 1}`,
))

const collateralPropertyBindings = [0, 1, 2].flatMap(index => {
  const fieldIndex = index + 1
  const key = `collateralProperties.${index}`
  const field = `hipoteka_nieruchomosc${fieldIndex}`

  return [
    choice(`${key}.relationshipToFinancedProperty`, `${field}_0`, 'financed', 'kredytowana'),
    choice(`${key}.relationshipToFinancedProperty`, `${field}_1`, 'other', 'inna'),
    formatted(`${key}.landRegisterNumber`, `${field}_kw1`, 'landRegister.part1'),
    formatted(`${key}.landRegisterNumber`, `${field}_kw2`, 'landRegister.part2'),
    formatted(`${key}.landRegisterNumber`, `${field}_kw3`, 'landRegister.part3'),
    booleanChoice(`${key}.hasLandRegister`, `${field}_brak_kw`, false, 'tak'),
  ]
})

const lifeInsuranceApplicantBindings = [0, 1, 2, 3].map(index => acro(
  `additionalProducts.lifeInsuranceApplicant.${index}`,
  `ubezpieczenie_na_zycie_wnioskodawca${index + 1}`,
))

export const PKO_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'pko-bp-mortgage-2022',
  bank: 'pko-bp',
  label: 'PKO BP - wniosek o udzielenie kredytu lub pożyczki',
  version: 3,
  fillMethod: { kind: 'pdf_acroform' },
  source: {
    fileName: 'pko-bp-wniosek-o-kredyt-hipoteczny-2025-09-30.pdf',
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
    status: 'complete',
    inScopeTargetCount: 144,
    mappedTargetCount: 144,
    manualUserActionCount: 4,
    excludedTargetCount: 38,
    notes: [
      'Pełny audyt AcroForm: wszystkie 144 pola klienta mają zatwierdzone mapowania semantyczne.',
      'Cztery podpisy pozostają osobnymi krokami użytkownika i nie wchodzą do mianownika pokrycia PDF.',
      '38 przycisków technicznych, informacyjnych i walidacyjnych PDF wyłączono z pokrycia.',
    ],
  },
  bindings: [
    choice('loan.productVariant', 'wniosek_0', 'own_home_mortgage', 'wlasny_kat'),
    choice('loan.productVariant', 'wniosek_1', 'mix_mortgage', 'mix'),
    choice('loan.productType', 'wniosek_2', 'mortgage_loan', 'pozyczka'),
    ...applicantBindings,

    choice('loan.purpose', 'nabycie', PURCHASE_PURPOSES),
    conditioned('investment.totalCost', 'nabycie_koszt', 'loan.purpose', PURCHASE_PURPOSES),
    conditioned('loan.amount', 'nabycie_kredyt', 'loan.purpose', PURCHASE_PURPOSES),
    choice('loan.purpose', 'wykonczenie', 'finishing'),
    choice('loan.purpose', 'remont', RENOVATION_PURPOSES),
    conditioned(
      'investment.renovationCost',
      'wykonczenie_koszt',
      'loan.purpose',
      ['finishing', ...RENOVATION_PURPOSES],
    ),
    conditioned(
      'loan.renovationAmount',
      'wykonczenie_kredyt',
      'loan.purpose',
      ['finishing', ...RENOVATION_PURPOSES],
    ),
    choice('loan.purpose', 'budowa', CONSTRUCTION_PURPOSES),
    choice('loan.purpose', 'nadbudowa', 'extension'),
    conditioned(
      'investment.totalCost',
      'budowa_koszt',
      'loan.purpose',
      [...CONSTRUCTION_PURPOSES, 'extension'],
    ),
    conditioned(
      'loan.amount',
      'budowa_kredyt',
      'loan.purpose',
      [...CONSTRUCTION_PURPOSES, 'extension'],
    ),
    choice('loan.purpose', 'przebudowa', 'conversion_to_residential'),
    conditioned(
      'investment.totalCost',
      'przebudowa_koszt',
      'loan.purpose',
      'conversion_to_residential',
    ),
    conditioned(
      'loan.amount',
      'przebudowa_kredyt',
      'loan.purpose',
      'conversion_to_residential',
    ),
    choice('loan.purpose', 'inny_cel', 'other'),
    conditioned('loan.purposeOther', 'inny_cel_opis', 'loan.purpose', 'other'),
    conditioned('investment.totalCost', 'inny_cel_koszt', 'loan.purpose', 'other'),
    conditioned('loan.amount', 'inny_cel_kredyt', 'loan.purpose', 'other'),
    conditioned(
      'investment.totalCost',
      'razem_koszt',
      'loan.purpose',
      DIRECT_INVESTMENT_PURPOSES,
    ),
    conditioned('loan.amount', 'razem_kredyt', 'loan.purpose', DIRECT_INVESTMENT_PURPOSES),
    choice('loan.purpose', 'refinansowanie', 'refinancing'),
    conditioned('loan.amount', 'refinansowanie_kredyt', 'loan.purpose', 'refinancing'),
    choice('loan.purpose', 'splata_zobowiazan', 'repayment_other_bank'),
    conditioned(
      'loan.amount',
      'splata_zobowiazan_kredyt',
      'loan.purpose',
      'repayment_other_bank',
    ),
    choice('loan.productType', 'pozyczka', 'mortgage_loan'),
    choice('loan.purpose', 'dowolny_cel', 'arbitrary_purpose'),
    conditioned(
      'loan.amount',
      'pozyczka_kredyt',
      'loan.purpose',
      ['arbitrary_purpose', 'mortgage_loan'],
    ),
    acro('loan.firstTrancheArbitraryPurposeEnabled', 'pierwsza_transza'),
    conditioned(
      'loan.firstTrancheArbitraryPurposeAmount',
      'pierwsza_transza_kredyt',
      'loan.firstTrancheArbitraryPurposeEnabled',
      'true',
    ),
    acro('loan.amount', 'wnioskowany_kredyt'),
    acro('investment.ownFundsPaid', 'wlasne_zaangazowane'),
    acro('investment.landValue', 'wartosci_dzialki'),
    computed(
      'investment.engagedOwnFundsTotal',
      'wlasne_razem',
      ['investment.ownFundsPaid', 'investment.landValue'],
      'currency.sum',
    ),
    computed(
      'investment.ownFundsToContributeTotal',
      'wlasne_do_wniesienia_razem',
      ['investment.ownFundsBeforeDisbursement', 'investment.ownFundsDuringInvestment'],
      'currency.sum',
    ),
    acro('investment.ownFundsBeforeDisbursement', 'wlasne_do_wniesienia_przed'),
    acro('investment.ownFundsDuringInvestment', 'wlasne_do_wniesienia_po'),
    acro('investment.financialSurplusEnabled', 'nadwyzki_finansowe'),
    conditioned(
      'investment.financialSurplusAmount',
      'nadwyzki_finansowe_kwota',
      'investment.financialSurplusEnabled',
      'true',
    ),

    choice('loan.interestType', 'oprocentowanie_0', 'variable', 'zmienne'),
    choice('loan.interestType', 'oprocentowanie_1', 'periodically_fixed', 'zmienne_ze_stala'),
    acro('loan.termMonths', 'okres_kredytowania'),
    acro('loan.gracePeriodMonths', 'karencja'),
    acro('loan.repaymentDay', 'dzien_splaty'),
    choice('loan.installmentType', 'formula_splaty_0', 'equal', 'rowne'),
    choice('loan.installmentType', 'formula_splaty_1', 'decreasing', 'malejace'),
    choice('loan.disbursementType', 'uruchomienie_0', 'tranches', 'transze'),
    choice('loan.disbursementType', 'uruchomienie_1', 'single', 'jednorazowe'),
    choice(
      'loan.repaymentAccountType',
      'rachunek_splaty_0',
      'existing_personal_account',
      'ror',
    ),
    choice(
      'loan.repaymentAccountType',
      'rachunek_splaty_1',
      'new_personal_account',
      'nowy_ror',
    ),
    choice(
      'loan.repaymentAccountType',
      'rachunek_splaty_2',
      'technical_account',
      'techniczny',
    ),
    {
      ...formatted('loan.repaymentAccountNumber', 'nr_rachunku', 'bankAccount.nrb'),
      condition: {
        canonicalKey: 'loan.repaymentAccountType',
        equals: 'existing_personal_account',
      },
    },
    formatted('loan.totalDisbursementDate', 'termin_wyplaty1', 'date.day'),
    formatted('loan.totalDisbursementDate', 'termin_wyplaty2', 'date.month'),
    formatted('loan.totalDisbursementDate', 'termin_wyplaty3', 'date.year'),
    formatted('investment.completionDate', 'termin_zakonczenia_inwestycji1', 'date.month'),
    formatted('investment.completionDate', 'termin_zakonczenia_inwestycji2', 'date.year'),
    computed('property.address.full', 'adres_inwestycji', ADDRESS_PARTS, 'fullAddress'),
    ...occupyingApplicantBindings,

    choice('collateralProperty.type', 'rodzaj_nieruchomosci_dom_jednorodzinny', 'house'),
    choice('collateralProperty.type', 'rodzaj_nieruchomosci_lokal', 'apartment'),
    choice('collateralProperty.type', 'rodzaj_nieruchomosci_garaz', 'garage'),
    choice('collateralProperty.type', 'rodzaj_nieruchomosci_miejsce_postojowe', 'parking_space'),
    choice('collateralProperty.type', 'rodzaj_nieruchomosci_grunty_rolne', 'agricultural_land'),
    choice(
      'collateralProperty.type',
      'rodzaj_nieruchomosci_dom_wielomieszkaniowy',
      'multi_family_building',
    ),
    choice('collateralProperty.type', 'rodzaj_nieruchomosci_dzialka_budowlana', 'plot'),
    choice(
      'collateralProperty.type',
      'rodzaj_nieruchomosci_dzialka_rekreacyjna',
      'recreational_plot',
    ),
    choice('collateralProperty.type', 'rodzaj_nieruchomosci_inna', 'other'),
    conditioned(
      'collateralProperty.typeOther',
      'rodzaj_nieruchomosci_inny',
      'collateralProperty.type',
      'other',
    ),
    acro('collateralProperty.marketValue', 'docelowa_wartosc'),
    ...collateralPropertyBindings,
    choice('property.publicRoadAccessType', 'droga_publiczna_0', 'direct', 'bezposrednio'),
    choice('property.publicRoadAccessType', 'droga_publiczna_1', 'easement', 'sluzebnosc'),
    choice(
      'property.publicRoadAccessType',
      'droga_publiczna_2',
      'road_property_share',
      'udzial',
    ),
    formatted(
      'property.accessRoadLandRegisterNumber',
      'dojazd_nieruchomosc_kw1',
      'landRegister.part1',
    ),
    formatted(
      'property.accessRoadLandRegisterNumber',
      'dojazd_nieruchomosc_kw2',
      'landRegister.part2',
    ),
    formatted(
      'property.accessRoadLandRegisterNumber',
      'dojazd_nieruchomosc_kw3',
      'landRegister.part3',
    ),
    acro('property.accessRoadShareMortgage', 'hipoteka_udzialy'),
    formatted('property.accessRoadShare', 'hipoteka_udzialy_wielkosc1', 'fraction.numerator'),
    formatted('property.accessRoadShare', 'hipoteka_udzialy_wielkosc2', 'fraction.denominator'),

    booleanChoice('additionalProducts.creditCard', 'karta_kredytowa_0', true),
    booleanChoice('additionalProducts.creditCard', 'karta_kredytowa_1', false),
    conditioned(
      'additionalProducts.creditCardLimit',
      'karta_kredytowa_limit',
      'additionalProducts.creditCard',
      'true',
    ),
    conditioned(
      'additionalProducts.creditCardApplicant',
      'karta_kredytowa_imie_nazwisko',
      'additionalProducts.creditCard',
      'true',
    ),
    booleanChoice('additionalProducts.personalAccount', 'ror_0', true),
    booleanChoice('additionalProducts.personalAccount', 'ror_1', false),
    booleanChoice('additionalProducts.lifeInsurance', 'ubezpieczenie_na_zycie_0', true),
    booleanChoice('additionalProducts.lifeInsurance', 'ubezpieczenie_na_zycie_1', false),
    ...lifeInsuranceApplicantBindings,
    booleanChoice('additionalProducts.systematicAccountInflows', 'systematyczne_wplywy_0', true),
    booleanChoice('additionalProducts.systematicAccountInflows', 'systematyczne_wplywy_1', false),
    acro('declarations.otherEnabled', 'inne_deklaracje'),
    conditioned('declarations.otherLine1', 'inne_deklaracje1', 'declarations.otherEnabled', 'true'),
    conditioned('declarations.otherLine2', 'inne_deklaracje2', 'declarations.otherEnabled', 'true'),

    booleanChoice('declarations.ownContributionFromCredit', 'wklad_wlasny_z_kredytu_0', true),
    booleanChoice('declarations.ownContributionFromCredit', 'wklad_wlasny_z_kredytu_1', false),
    booleanChoice('consents.earlyCreditDecision', 'zgoda_wczesniejsza_decyzja_0', true),
    booleanChoice('consents.earlyCreditDecision', 'zgoda_wczesniejsza_decyzja_1', false),
    booleanChoice(
      'consents.interbankInformationSharing',
      'zgoda_przekazywanie_informacji_0',
      true,
    ),
    booleanChoice(
      'consents.interbankInformationSharing',
      'zgoda_przekazywanie_informacji_1',
      false,
    ),
    booleanChoice('declarations.riskAwareness', 'swiadomosc_ryzyk_0', true),
    booleanChoice('declarations.riskAwareness', 'swiadomosc_ryzyk_1', false),

    acro('application.place', 'miejscowosc'),
    formatted('application.date', 'data', 'date.ddMMyyyy'),
    choice(
      'property.appraiserChoice',
      'rzeczoznawca_0',
      'bank_partner_network',
      'wspolpracujacy',
    ),
    choice('property.appraiserChoice', 'rzeczoznawca_1', 'other', 'inny'),
    conditioned(
      'property.appraiserDetails',
      'inny_rzeczoznawca',
      'property.appraiserChoice',
      'other',
    ),
  ],
}
