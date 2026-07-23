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

export const PEKAO_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'pekao-mortgage-2025',
  bank: 'pekao',
  label: 'Bank Pekao - wniosek o udzielenie kredytu mieszkaniowego',
  version: 1,
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
    status: 'incomplete',
    inScopeTargetCount: 278,
    mappedTargetCount: 34,
    manualUserActionCount: 4,
    excludedTargetCount: 9,
    notes: [
      'Pełny audyt AcroForm: 258 pól danych lub wyborów, 19 zgód i 1 pole wyliczane.',
      '9 pól bankowych lub systemowych wyłączono z pokrycia klienta.',
    ],
  },
  bindings: [
    {
      canonicalKey: 'application.placeAndDate',
      computed: true,
      valueFrom: ['application.place', 'application.date'],
      valueFormat: 'application.placeAndDate',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'Text Field 119' },
    },
    acro('applicants.0.firstName', 'Text Field 4'),
    acro('applicants.0.lastName', 'Text Field 13'),
    acro('applicants.1.firstName', 'Text Field 15'),
    acro('applicants.1.lastName', 'Text Field 16'),

    acro('loan.purpose', 'C9', { purchase_primary: 'Yes', purchase_secondary: 'Yes' }),
    {
      ...acro('loan.constructionMethod', 'C17', { self_performed: 'Yes' }),
      condition: { canonicalKey: 'loan.purpose', equals: 'construction' },
    },
    {
      ...acro('loan.constructionMethod', 'C18', { developer_or_cooperative: 'Yes' }),
      condition: { canonicalKey: 'loan.purpose', equals: 'construction' },
    },
    {
      ...acro('loan.renovationPermit', 'C19', { required: 'Yes' }),
      condition: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    },
    {
      ...acro('loan.renovationPermit', 'C20', { not_required: 'Yes' }),
      condition: { canonicalKey: 'loan.purpose', equals: 'renovation' },
    },
    acro('loan.purpose', 'C11', { refinancing: 'Yes' }),
    acro('loan.purpose', 'C31', { other: 'Yes' }),
    {
      ...acro('loan.purposeOther', 'Text Field 29'),
      condition: { canonicalKey: 'loan.purpose', equals: 'other' },
    },
    acro('loan.amount', 'Text Field 52'),
    acro('loan.termMonths', 'Text Field 141'),
    acro('loan.repaymentDay', 'Text Field 59'),
    acro('investment.totalCost', 'Text Field 60'),
    acro('loan.renovationAmount', 'Text Field 53'),
    acro('investment.ownFundsPaid', 'Text Field 61'),
    acro('investment.ownFundsBeforeDisbursement', 'Text Field 62'),
    acro('investment.ownFundsDuringInvestment', 'Text Field 63'),
    acro('investment.ownFundsContributionDates', 'Text Field 64'),
    acro('loan.installmentType', 'C45', { decreasing: 'Yes' }),
    acro('loan.installmentType', 'C46', { equal: 'Yes' }),
    acro('loan.interestType', 'C47', { variable: 'Yes' }),
    acro('loan.interestType', 'C48', { periodically_fixed: 'Yes' }),

    acro('property.address.street', 'Text Field 35'),
    {
      canonicalKey: 'property.address.houseAndUnit',
      computed: true,
      valueFrom: ['property.address.houseNumber', 'property.address.unitNumber'],
      valueFormat: 'houseAndUnit',
      reviewStatus: 'ready',
      target: { kind: 'acroform', field: 'Text Field 36' },
    },
    acro('property.address.postalCode', 'Text Field 34'),
    acro('property.address.city', 'Text Field 31'),
    acro('property.address.county', 'Text Field 33'),
    acro('property.address.voivodeship', 'Text Field 32'),
    acro('property.landRegisterNumber', 'Text Field 40'),
    acro('property.marketValue', 'Text Field 39'),
  ],
}
