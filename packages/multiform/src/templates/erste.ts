import type {
  DocumentTemplate,
  PdfMarkAppearance,
  PdfTextAppearance,
  PreciseOverlayTarget,
  TemplateBinding,
} from '../types.ts'

const COORDINATE_SPACE = {
  units: 'pt',
  referenceBox: 'crop',
  origin: 'top-left',
  orientation: 'visual',
} as const

const BLACK = { space: 'rgb', red: 0, green: 0, blue: 0 } as const

const textAppearance = (fontSizePt: number): PdfTextAppearance => ({
  kind: 'text',
  fontId: 'dm-sans-regular',
  fontSizePt,
  minFontSizePt: 6,
  letterSpacingPt: 0,
  lineHeightPt: Number((fontSizePt * 1.2).toFixed(2)),
  wrap: 'none',
  overflow: 'shrink',
  horizontalAlign: 'left',
  verticalAlign: 'middle',
  distribution: { kind: 'flow' },
  color: BLACK,
  opacity: 1,
  paddingPt: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
})

const markAppearance: PdfMarkAppearance = {
  kind: 'mark',
  role: 'checkbox',
  glyph: 'x',
  color: BLACK,
  opacity: 1,
  insetPt: 3.4,
  strokeWidthPt: 1.15,
}

const textTarget = (
  page: number,
  x: number,
  y: number,
  width: number,
  fontSizePt = 9,
): PreciseOverlayTarget => ({
  kind: 'overlay',
  rendererVersion: 2,
  page,
  box: { x, y, width, height: 17 },
  coordinateSpace: COORDINATE_SPACE,
  appearance: textAppearance(fontSizePt),
})

const text = (
  canonicalKey: string,
  page: number,
  x: number,
  y: number,
  width: number,
  fontSize = 9,
): TemplateBinding => ({
  canonicalKey,
  reviewStatus: 'ready',
  target: textTarget(page, x, y, width, fontSize),
})

const mark = (
  canonicalKey: string,
  when: string | readonly string[],
  page: number,
  y: number,
  reviewStatus: 'ready' | 'needsReview' = 'ready',
): TemplateBinding => ({
  canonicalKey,
  condition: { canonicalKey, equals: when },
  reviewStatus,
  target: {
    kind: 'overlay',
    rendererVersion: 2,
    page,
    box: { x: 63, y, width: 17, height: 17 },
    coordinateSpace: COORDINATE_SPACE,
    appearance: markAppearance,
  },
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

function applicantBindings(
  index: 2 | 3 | 4,
  fullNameY: number,
  peselY: number,
): TemplateBinding[] {
  const displayIndex = index + 1
  const mappingEvidence = {
    origin: 'manual' as const,
    rationale: `Pozycja wyznaczona z etykiet „Wnioskodawca ${displayIndex}”, „imię i nazwisko” oraz „PESEL” na pierwszej stronie dokumentu.`,
  }
  return [
    {
      canonicalKey: `applicants.${index}.fullName`,
      computed: true,
      valueFrom: [`applicants.${index}.firstName`, `applicants.${index}.lastName`],
      valueFormat: 'fullName',
      reviewStatus: 'ready',
      mappingEvidence,
      target: textTarget(1, 155, fullNameY, 374),
    },
    {
      canonicalKey: `applicants.${index}.pesel`,
      reviewStatus: 'ready',
      mappingEvidence,
      target: textTarget(1, 104, peselY, 425),
    },
  ]
}

export const ERSTE_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'erste-mortgage-2026',
  bank: 'erste',
  label: 'Erste - wniosek o udzielenie kredytu hipotecznego',
  version: 1,
  fillMethod: { kind: 'pdf_overlay' },
  source: {
    fileName: 'erste-wniosek-o-kredyt-hipoteczny.pdf',
    sha256: '9306c74080327f7114dfb0c55a57db875cbecdad6e8442d0b69f02ceb44a449d',
    pageCount: 9,
    formKind: 'overlay',
    pages: Array.from({ length: 9 }, (_, index) => ({
      page: index + 1,
      mediaBox: { x: 0, y: 0, width: 596.66, height: 840.47 },
      cropBox: { x: 0, y: 0, width: 596.66, height: 840.47 },
      rotation: 0,
      userUnit: 1,
    })),
  },
  coverage: {
    status: 'complete',
    inScopeTargetCount: 106,
    mappedTargetCount: 106,
    manualUserActionCount: 5,
    excludedTargetCount: 4,
    notes: [
      'Pełny audyt 9 stron: 106 targetów klienta otrzymało zatwierdzone mapowania.',
      'Pięć podpisów pozostaje osobnymi krokami użytkownika i nie wchodzi do mianownika pokrycia PDF.',
      'Numer wniosku, data wpływu i dwa pola pracownika banku są wyłączone z automatycznego wypełniania.',
    ],
  },
  bindings: [
    text('application.place', 1, 143, 238, 88),
    {
      ...text('application.date', 1, 446, 238, 72),
      valueFormat: 'date.ddMMyyyy',
    },
    {
      canonicalKey: 'applicants.0.fullName',
      computed: true,
      valueFrom: ['applicants.0.firstName', 'applicants.0.lastName'],
      valueFormat: 'fullName',
      reviewStatus: 'ready',
      target: textTarget(1, 155, 499, 374),
    },
    text('applicants.0.pesel', 1, 104, 520, 425),
    {
      canonicalKey: 'applicants.1.fullName',
      computed: true,
      valueFrom: ['applicants.1.firstName', 'applicants.1.lastName'],
      valueFormat: 'fullName',
      reviewStatus: 'ready',
      target: textTarget(1, 155, 560, 374),
    },
    text('applicants.1.pesel', 1, 104, 581, 425),
    ...applicantBindings(2, 622, 642),
    ...applicantBindings(3, 683, 703),
    ...applicantBindings(4, 744, 765),

    mark('loan.purpose', 'purchase_primary', 2, 245),
    mark('loan.purpose', 'purchase_secondary', 2, 266),
    mark('loan.purpose', 'construction', 2, 286),
    mark('loan.purpose', 'renovation', 2, 307),
    mark('loan.purpose', 'refinancing', 2, 327),
    mark('loan.purpose', 'repayment_other_bank', 2, 348),
    mark('loan.purpose', 'other', 2, 368),
    {
      ...text('loan.purposeOther', 2, 153, 383, 376, 8.5),
      condition: { canonicalKey: 'loan.purpose', equals: 'other' },
    },
    mark('loan.purpose', 'arbitrary_purpose', 2, 406),
    mark('loan.purpose', 'family_purchase_primary', 2, 590),
    mark('loan.purpose', 'family_purchase_secondary', 2, 611),
    mark('loan.purpose', 'family_construction', 2, 631),
    mark('loan.purpose', 'family_renovation', 2, 651),
    mark('loan.purpose', 'mortgage_loan', 2, 704),
    text('loan.mortgageLoanPurpose', 2, 87, 714, 442, 8.5),

    text('investment.totalCost', 3, 245, 237, 271),
    text('investment.renovationCost', 3, 249, 257, 267),
    {
      canonicalKey: 'investment.ownFunds',
      computed: true,
      valueFrom: OWN_FUNDS_PARTS,
      valueFormat: 'currency.sum',
      reviewStatus: 'ready',
      target: textTarget(3, 147, 278, 369),
    },
    text('loan.amount', 3, 307, 366, 209),
    text('loan.arbitraryPurposeAmount', 3, 244, 406, 272),
    text('loan.termMonths', 3, 308, 458, 208),
    text('loan.repaymentDay', 3, 318, 488, 198),
    mark('loan.commissionType', 'financed', 3, 543),
    mark('loan.commissionType', 'not_financed', 3, 566),

    mark('loan.interestType', 'periodically_fixed', 3, 619),
    mark('loan.interestType', 'variable', 3, 642),
    mark('loan.disbursementType', 'single', 3, 695),
    mark('loan.disbursementType', 'tranches', 3, 718),

    ...[151, 192, 233, 274, 315, 355].flatMap((dateY, index) => [
      text(`tranches.${index}.date`, 4, 93, dateY - 7, 84, 8.5),
      text(`tranches.${index}.amount`, 4, 281, dateY - 7, 108, 8.5),
      text(`tranches.${index}.accountOwner`, 4, 180, dateY + 13, 209, 8.5),
    ]),
    mark('loan.installmentType', 'equal', 4, 427),
    mark('loan.installmentType', 'decreasing', 4, 447),
    mark('loan.gracePeriod', 'true', 4, 503),
    text('loan.gracePeriodMonths', 4, 218, 518, 311, 8.5),
    mark('loan.gracePeriod', 'false', 4, 544),

    mark('property.type', 'house', 4, 661),
    mark('property.type', 'apartment', 4, 684),
    mark('property.type', 'plot', 4, 708),
    mark('property.type', 'other', 4, 731),
    {
      ...text('property.typeOther', 4, 279, 727, 250, 8.5),
      condition: { canonicalKey: 'property.type', equals: 'other' },
    },
    {
      canonicalKey: 'property.address.full',
      computed: true,
      valueFrom: ADDRESS_PARTS,
      valueFormat: 'fullAddress',
      reviewStatus: 'ready',
      target: textTarget(4, 101, 758, 428, 8.5),
    },
    text('property.landRegisterNumber', 5, 205, 129, 324),
    text('property.marketValue', 5, 330, 158, 186),

    mark('collateralProperty.type', 'house', 5, 298),
    mark('collateralProperty.type', 'apartment', 5, 321),
    mark('collateralProperty.type', 'plot', 5, 345),
    mark('collateralProperty.type', 'other', 5, 369),
    {
      ...text('collateralProperty.typeOther', 5, 279, 365, 250, 8.5),
      condition: { canonicalKey: 'collateralProperty.type', equals: 'other' },
    },
    text('collateralProperty.address', 5, 100, 392, 429, 8.5),
    text('collateralProperty.landRegisterNumber', 5, 205, 421, 324, 8.5),
    text('collateralProperty.marketValue', 5, 330, 450, 186, 8.5),

    mark('additionalProducts.enabled', 'true', 5, 568),
    mark('additionalProducts.enabled', 'false', 5, 591),
    mark('additionalProducts.lifeInsurance', 'true', 5, 658),
    mark('additionalProducts.propertyInsurance', 'true', 5, 696),
    mark('additionalProducts.personalAccount', 'true', 5, 716),
    mark('additionalProducts.creditCard', 'true', 5, 737),

    text('additionalProducts.creditCardApplicant', 6, 405, 168, 124, 8.5),
    text('additionalProducts.creditCardLimit', 6, 430, 190, 86, 8.5),
    mark('consents.earlyCreditDecision', 'true', 6, 406),
    mark('consents.earlyCreditDecision', 'false', 6, 430),

    mark('application.submissionChannel', 'branch', 7, 298),
    mark('application.submissionChannel', 'intermediary', 7, 320),
    mark('application.submissionChannel', 'agent_or_partner', 7, 342),
    mark('intermediary.kind', 'intermediary_or_partner', 7, 508),
    text('intermediary.name', 7, 167, 525, 362, 8.5),
    text('intermediary.email', 7, 252, 543, 277, 8.5),
    text('intermediary.phone', 7, 134, 560, 395, 8.5),
    text('intermediary.acceptingPerson', 7, 365, 578, 164, 8.5),
    mark('intermediary.kind', 'bank_agent', 7, 601),
    text('intermediary.agentName', 7, 216, 619, 313, 8.5),
    mark('declarations.art17Information', 'true', 7, 738),
    mark('declarations.art17Information', 'false', 7, 761),

    mark('declarations.remunerationInformation', 'true', 8, 190),
    mark('declarations.remunerationInformation', 'false', 8, 214),
    mark('declarations.intermediaryTransfersToAgent', 'false', 8, 319),
    mark('declarations.intermediaryTransfersToAgent', 'true', 8, 343),
    text('declarations.transferAgentName', 8, 279, 339, 250, 8.5),
  ],
}
