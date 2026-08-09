import type { DocumentTemplate, TemplateBinding } from '../types.ts'
import { pekaoAcroTarget } from './pekao-field-snapshots.ts'

const acro = (
  canonicalKey: string,
  field: string,
  valueMap?: Readonly<Record<string, string>>,
): TemplateBinding => ({
  canonicalKey,
  reviewStatus: 'ready',
  target: pekaoAcroTarget(field, valueMap),
})

const choice = (canonicalKey: string, field: string, canonicalValue: string) => (
  acro(canonicalKey, field, { [canonicalValue]: 'Yes' })
)

const yes = (canonicalKey: string, field: string) => choice(canonicalKey, field, 'true')

const yesNo = (canonicalKey: string, yesField: string, noField: string) => [
  choice(canonicalKey, yesField, 'true'),
  choice(canonicalKey, noField, 'false'),
]

const APPLICANT_BINDINGS = Array.from({ length: 4 }, (_, index) => {
  const textFields = index === 0
    ? ['Text Field 4', 'Text Field 13', 'Text Field 14']
    : index === 1
      ? ['Text Field 15', 'Text Field 16', 'Text Field 17']
      : index === 2
        ? ['Text Field 18', 'Text Field 19', 'Text Field 20']
        : ['Text Field 21', 'Text Field 22', 'Text Field 23']

  return [
    acro(`applicants.${index}.firstName`, textFields[0]!),
    acro(`applicants.${index}.lastName`, textFields[1]!),
    yes(`applicants.${index}.targetPropertyOwner`, `C${index + 1}`),
    acro(`applicants.${index}.sharedHouseholdWithApplicantNumber`, textFields[2]!),
  ]
}).flat()

const HOUSEHOLD_BINDINGS = [
  ['Text Field 70', 'Text Field 71', 'Text Field 73', 'Text Field 74', 'Text Field 75'],
  ['Text Field 76', 'Text Field 77', 'Text Field 78', 'Text Field 79', 'Text Field 80'],
  ['Text Field 81', 'Text Field 82', 'Text Field 83', 'Text Field 84', 'Text Field 85'],
].flatMap((fields, index) => [
  acro(`households.${index}.monthlyDebtInstallments`, fields[0]!),
  acro(`households.${index}.outstandingDebt`, fields[1]!),
  acro(`households.${index}.otherFixedExpenses`, fields[2]!),
  acro(`households.${index}.externalCreditLimits`, fields[3]!),
  acro(`households.${index}.householdExpenses`, fields[4]!),
])

const LIABILITY_COLUMNS = [
  'type',
  'creditor',
  'contractDate',
  'outstandingAmount',
  'contractNumber',
  'installmentAmount',
  'currency',
  'applicantNumbers',
] as const

function liabilityField(row: number, column: number) {
  const sequential = 87 + row * LIABILITY_COLUMNS.length + column
  return sequential <= 109
    ? `Text Field ${sequential}`
    : `Text Field 10${sequential - 100}`
}

const LIABILITY_BINDINGS = Array.from({ length: 11 }, (_, row) => (
  LIABILITY_COLUMNS.map((column, columnIndex) => (
    acro(`liabilities.${row}.${column}`, liabilityField(row, columnIndex))
  ))
)).flat()

const MORTGAGE_TEXT_FIELDS = [
  ['Text Field 110', 'Text Field 111'],
  ['Text Field 135', 'Text Field 136'],
  ['Text Field 137', 'Text Field 138'],
  ['Text Field 139', 'Text Field 140'],
] as const

const MORTGAGE_STATUS_VALUES = [
  'paid_docs_delivered',
  'paid_docs_not_delivered',
  'repay_own_funds',
  'repay_credit',
  'repay_own_and_credit',
  'not_repaid',
] as const

const MORTGAGE_DISCHARGE_BINDINGS = MORTGAGE_TEXT_FIELDS.flatMap((fields, index) => [
  acro(`mortgageDischarges.${index}.mortgageNumber`, fields[0]),
  acro(`mortgageDischarges.${index}.landRegisterNumber`, fields[1]),
  ...MORTGAGE_STATUS_VALUES.map((value, statusIndex) => (
    choice(
      `mortgageDischarges.${index}.settlementStatus`,
      `C${59 + index * MORTGAGE_STATUS_VALUES.length + statusIndex}`,
      value,
    )
  )),
])

const PEKAO_BINDINGS: readonly TemplateBinding[] = [
  // Page 1: applicants, product and the exact purpose of financing.
  ...APPLICANT_BINDINGS,
  choice('loan.productType', 'C5', 'mortgage'),
  choice('loan.productType', 'C6', 'construction_mortgage'),
  choice('loan.productType', 'C7', 'other'),
  {
    ...acro('loan.productTypeOther', 'Text Field 127'),
    condition: { canonicalKey: 'loan.productType', equals: 'other' },
  },

  acro('loan.purpose', 'C9', { purchase_primary: 'Yes', purchase_secondary: 'Yes' }),
  choice('loan.purpose', 'C10', 'purchase_land'),
  choice('loan.purpose', 'C11', 'refinancing'),
  choice('loan.purpose', 'C12', 'convert_cooperative_right'),
  choice('loan.purpose', 'C13', 'municipal_purchase'),
  choice('loan.purpose', 'C14', 'garage_purchase'),
  choice('loan.purpose', 'C15', 'acquire_rights_from_individual'),
  choice('loan.purpose', 'C16', 'purchase_share'),
  {
    ...choice('loan.constructionMethod', 'C17', 'self_performed'),
    condition: { canonicalKey: 'loan.purpose', equals: 'construction' },
  },
  {
    ...choice('loan.constructionMethod', 'C18', 'developer_or_cooperative'),
    condition: { canonicalKey: 'loan.purpose', equals: 'construction' },
  },
  {
    ...choice('loan.renovationPermit', 'C19', 'required'),
    condition: { canonicalKey: 'loan.purpose', equals: 'renovation' },
  },
  {
    ...choice('loan.renovationPermit', 'C20', 'not_required'),
    condition: { canonicalKey: 'loan.purpose', equals: 'renovation' },
  },
  choice('loan.purpose', 'C21', 'adaptation_to_residential'),
  choice('loan.purpose', 'C22', 'purchase_with_renovation'),
  choice('loan.purpose', 'C23', 'acquire_construction_rights'),
  choice('loan.purpose', 'C24', 'refinance_with_renovation_no_permit'),
  choice('loan.purpose', 'C25', 'refinance_with_renovation_permit'),
  choice('loan.purpose', 'C26', 'share_purchase_with_renovation_no_permit'),
  choice('loan.purpose', 'C27', 'share_purchase_with_renovation_permit'),
  choice('loan.purpose', 'C31', 'other'),
  {
    ...acro('loan.purposeOther', 'Text Field 29'),
    condition: { canonicalKey: 'loan.purpose', equals: 'other' },
  },

  acro('refinancedLoan.outstandingAmount', 'Text Field 24'),
  acro('refinancedLoan.monthlyInstallment', 'Text Field 25'),
  acro('refinancedLoan.currency', 'Text Field 26'),
  acro('refinancedLoan.originationYear', 'Text Field 27'),
  acro('refinancedLoan.originationMonth', 'Text Field 28'),
  ...yesNo('loan.constructionPermitRequired', 'C28', 'C29'),
  yes('loan.contractChangeRequested', 'C30'),
  {
    ...acro('loan.contractChangeDescription', 'Text Field 30'),
    condition: { canonicalKey: 'loan.contractChangeRequested', equals: 'true' },
  },

  // Page 2: financed and collateral properties.
  acro('property.address.city', 'Text Field 31'),
  acro('property.address.voivodeship', 'Text Field 32'),
  acro('property.address.county', 'Text Field 33'),
  acro('property.address.municipality', 'Text Field 131'),
  acro('property.address.district', 'Text Field 132'),
  acro('property.address.postalCode', 'Text Field 34'),
  acro('property.address.street', 'Text Field 35'),
  {
    canonicalKey: 'property.address.houseAndUnit',
    computed: true,
    valueFrom: ['property.address.houseNumber', 'property.address.unitNumber'],
    valueFormat: 'houseAndUnit',
    reviewStatus: 'ready',
    target: pekaoAcroTarget('Text Field 36'),
  },
  acro('property.usableArea', 'Text Field 37'),
  acro('property.constructionYear', 'Text Field 38'),
  acro('property.outdoorParkingSpaces', 'Text Field 128'),
  acro('property.indoorParkingSpaces', 'Text Field 130'),
  choice('property.ownershipType', 'C35', 'apartment_ownership'),
  choice('property.ownershipType', 'C36', 'house_ownership'),
  choice('property.ownershipType', 'C37', 'land_right'),
  choice('property.ownershipType', 'C38', 'cooperative_ownership_right'),
  choice('property.ownershipType', 'C39', 'municipal_or_company'),
  choice('property.ownershipSequence', 'C40', 'first'),
  choice('property.ownershipSequence', 'C41', 'next'),
  acro('property.marketValue', 'Text Field 39'),
  acro('property.landRegisterNumber', 'Text Field 40'),

  acro('collateralProperty.address.city', 'Text Field 41'),
  acro('collateralProperty.address.voivodeship', 'Text Field 42'),
  acro('collateralProperty.address.county', 'Text Field 43'),
  acro('collateralProperty.address.municipality', 'Text Field 133'),
  acro('collateralProperty.address.district', 'Text Field 134'),
  acro('collateralProperty.address.postalCode', 'Text Field 44'),
  acro('collateralProperty.address.street', 'Text Field 45'),
  acro('collateralProperty.address.houseAndUnit', 'Text Field 46'),
  acro('collateralProperty.usableArea', 'Text Field 47'),
  acro('collateralProperty.constructionYear', 'Text Field 48'),
  acro('collateralProperty.marketValue', 'Text Field 49'),
  acro('collateralProperty.landRegisterNumber', 'Text Field 50'),

  // Page 2: requested financing and securities.
  acro('loan.amount', 'Text Field 52'),
  acro('loan.renovationAmount', 'Text Field 53'),
  acro('loan.refinancedDepositAmount', 'Text Field 56'),
  acro('loan.arbitraryPurposeAmount', 'Text Field 57'),
  acro('loan.currency', 'Text Field 54'),
  acro('loan.currencyIndex', 'Text Field 55'),
  choice('loan.commissionType', 'C44', 'financed'),
  choice('loan.commissionType', 'C43', 'not_financed'),
  choice('loan.commissionType', 'C42', 'not_applicable'),
  choice('loan.cpiPremiumFinancing', 'C105', 'yes'),
  choice('loan.cpiPremiumFinancing', 'C104', 'no'),
  choice('loan.cpiPremiumFinancing', 'C103', 'not_applicable'),
  acro('loan.termMonths', 'Text Field 141'),
  acro('loan.gracePeriodMonths', 'Text Field 142'),
  acro('loan.paymentGraceMonths', 'Text Field 143'),
  acro('loan.repaymentDay', 'Text Field 59'),
  choice('loan.installmentType', 'C45', 'decreasing'),
  choice('loan.installmentType', 'C46', 'equal'),
  acro('investment.totalCost', 'Text Field 60'),
  choice('loan.interestType', 'C47', 'variable'),
  choice('loan.interestType', 'C48', 'periodically_fixed'),
  acro('investment.ownFundsPaid', 'Text Field 61'),
  acro('investment.ownFundsBeforeDisbursement', 'Text Field 62'),
  acro('investment.ownFundsDuringInvestment', 'Text Field 63'),
  acro('investment.ownFundsContributionDates', 'Text Field 64'),
  yes('investment.ownFundsSources.bankAccounts.selected', 'C49'),
  yes('investment.ownFundsSources.investmentFunds.selected', 'C50'),
  yes('investment.ownFundsSources.guaranteePremium.selected', 'C51'),
  yes('investment.ownFundsSources.other.selected', 'C52'),
  acro('investment.ownFundsSources.bankAccounts.amount', 'Text Field 65'),
  acro('investment.ownFundsSources.investmentFunds.amount', 'Text Field 66'),
  acro('investment.ownFundsSources.guaranteePremium.amount', 'Text Field 67'),
  acro('investment.ownFundsSources.other.amount', 'Text Field 68'),
  yes('loan.securities.financedPropertyMortgage', 'C53'),
  yes('loan.securities.otherPropertyMortgage', 'C54'),
  yes('loan.securities.lifeInsurance', 'C55'),
  yes('loan.securities.bankInsurance', 'C56'),
  acro('loan.securities.otherDescription', 'Text Field 69'),
  choice('loan.mortgageEstablishmentMode', 'C57', 'notarial_deed'),
  choice('loan.mortgageEstablishmentMode', 'C58', 'banking_law_article_95'),

  // Page 3: household summary and eleven liabilities declared for repayment.
  ...HOUSEHOLD_BINDINGS,
  ...LIABILITY_BINDINGS,

  // Page 4: four mortgages and their intended settlement method.
  ...MORTGAGE_DISCHARGE_BINDINGS,

  // Page 5: statements, consents and communication preferences.
  choice('property.appraisalSource', 'C83', 'bank_provider'),
  choice('property.appraisalSource', 'C84', 'self_provided'),
  ...yesNo('additionalProducts.cpiInterested', 'C85', 'C86'),
  yes('declarations.art17Information', 'C87'),
  choice('declarations.selectedLoanRiskVariant', 'C88', 'variable_interest'),
  choice('declarations.selectedLoanRiskVariant', 'C89', 'currency_indexed'),
  choice('declarations.selectedLoanRiskVariant', 'C90', 'periodically_fixed'),
  ...yesNo('declarations.sellerIsCloseRelative', 'C91', 'C92'),
  ...yesNo('consents.earlyCreditDecision', 'C93', 'C94'),
  ...yesNo('consents.receiveContractDraft', 'C95', 'C96'),
  yes('consents.creditDecisionByEmail', 'C97'),
  {
    ...acro('consents.creditDecisionEmail', 'Text Field 118'),
    condition: { canonicalKey: 'consents.creditDecisionByEmail', equals: 'true' },
  },
  yes('notifications.pekao24', 'C98'),
  yes('notifications.email', 'C99'),
  yes('notifications.postal', 'C100'),

  // Page 6: the only customer-facing AcroForm field on the signature page.
  {
    canonicalKey: 'application.placeAndDate',
    computed: true,
    valueFrom: ['application.place', 'application.date'],
    valueFormat: 'application.placeAndDate',
    reviewStatus: 'ready',
    target: pekaoAcroTarget('Text Field 119'),
  },
]

export const PEKAO_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'pekao-mortgage-2025',
  bank: 'pekao',
  label: 'Bank Pekao - wniosek o udzielenie kredytu mieszkaniowego',
  version: 3,
  fillMethod: { kind: 'pdf_acroform' },
  source: {
    fileName: 'pekao-wniosek-o-kredyt-mieszkaniowy.pdf',
    sha256: 'f9d16ec8fc7810c9b8e6301eeb8e0b9c190d9ebc3f29acb356648bf1f06f79bc',
    pageCount: 6,
    formKind: 'acroform',
    pages: Array.from({ length: 6 }, (_, index) => ({
      page: index + 1,
      mediaBox: { x: 0, y: 0, width: 595.28, height: 841.89 },
      cropBox: { x: 0, y: 0, width: 595.28, height: 841.89 },
      rotation: 0,
      userUnit: 1,
    })),
  },
  coverage: {
    status: 'complete',
    inScopeTargetCount: 278,
    mappedTargetCount: 278,
    manualUserActionCount: 4,
    excludedTargetCount: 9,
    notes: [
      'Pełny audyt źródła: 287 widgetów AcroForm, w tym 278 pól klienta przypisanych semantycznie.',
      '9 pól numeru wniosku, oddziału i obsługi bankowej wyłączono z pokrycia klienta.',
      '4 podpisy wnioskodawców pozostają świadomą czynnością ręczną poza polami AcroForm.',
    ],
  },
  bindings: PEKAO_BINDINGS,
}
