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

const conditioned = (
  binding: TemplateBinding,
  canonicalKey: string,
  equals: string | readonly string[],
): TemplateBinding => ({
  ...binding,
  condition: { canonicalKey, equals },
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
  index: 2 | 3,
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
  version: 2,
  fillMethod: { kind: 'pdf_overlay' },
  source: {
    fileName: 'erste-wniosek-o-kredyt-hipoteczny-2026-07-20.pdf',
    sha256: '8f43ba0fe5f1557b1c2d35d44142aa364a79773500ea94944fe1ff9913d668d7',
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
    inScopeTargetCount: 102,
    mappedTargetCount: 102,
    manualUserActionCount: 4,
    excludedTargetCount: 4,
    notes: [
      'Pełny audyt wersji obowiązującej od 20.07.2026: 102 targety klienta otrzymały zatwierdzone mapowania.',
      'Źródło zawiera pusty słownik /AcroForm/Fields i zero widgetów /Widget, dlatego jest poprawnie wypełniane metodą overlay.',
      'Cztery podpisy pozostają osobnymi krokami użytkownika i nie wchodzą do mianownika pokrycia PDF.',
      'Numer wniosku, data wpływu i dwa pola pracownika banku są wyłączone z automatycznego wypełniania.',
    ],
  },
  requiredCanonicalKeys: [
    'loan.gracePeriod',
    'additionalProducts.enabled',
    'consents.earlyCreditDecision',
    'application.submissionChannel',
  ],
  bindings: [
    text('application.place', 1, 143, 226, 88),
    {
      ...text('application.date', 1, 446, 226, 72),
      valueFormat: 'date.ddMMyyyy',
    },
    {
      canonicalKey: 'applicants.0.fullName',
      computed: true,
      valueFrom: ['applicants.0.firstName', 'applicants.0.lastName'],
      valueFormat: 'fullName',
      reviewStatus: 'ready',
      target: textTarget(1, 155, 481, 374),
    },
    text('applicants.0.pesel', 1, 104, 502, 425),
    {
      canonicalKey: 'applicants.1.fullName',
      computed: true,
      valueFrom: ['applicants.1.firstName', 'applicants.1.lastName'],
      valueFormat: 'fullName',
      reviewStatus: 'ready',
      target: textTarget(1, 155, 542, 374),
    },
    text('applicants.1.pesel', 1, 104, 563, 425),
    ...applicantBindings(2, 603, 624),
    ...applicantBindings(3, 664, 685),

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
    mark('loan.purpose', 'family_purchase_primary', 2, 566),
    mark('loan.purpose', 'family_purchase_secondary', 2, 587),
    mark('loan.purpose', 'family_construction', 2, 607),
    mark('loan.purpose', 'family_renovation', 2, 627),
    mark('loan.purpose', 'mortgage_loan', 2, 680),
    conditioned(
      text('loan.mortgageLoanPurpose', 2, 87, 690, 442, 8.5),
      'loan.purpose',
      'mortgage_loan',
    ),

    text('investment.totalCost', 3, 247, 237, 269),
    text('investment.renovationCost', 3, 250, 257, 266),
    {
      canonicalKey: 'investment.ownFunds',
      computed: true,
      valueFrom: OWN_FUNDS_PARTS,
      valueFormat: 'currency.sum',
      reviewStatus: 'ready',
      target: textTarget(3, 148, 278, 368),
    },
    text('loan.amount', 3, 151, 366, 365),
    text('loan.arbitraryPurposeAmount', 3, 244, 406, 272),
    text('loan.termMonths', 3, 308, 458, 208),
    text('loan.repaymentDay', 3, 318, 488, 198),
    mark('loan.interestType', 'periodically_fixed', 3, 543),
    mark('loan.interestType', 'variable', 3, 566),
    mark('loan.disbursementType', 'single', 3, 619),
    mark('loan.disbursementType', 'tranches', 3, 642),

    ...[722, 762].flatMap((dateY, index) => [
      conditioned(
        text(`tranches.${index}.date`, 3, 93, dateY - 8, 84, 8.5),
        'loan.disbursementType',
        'tranches',
      ),
      conditioned(
        text(`tranches.${index}.amount`, 3, 281, dateY - 8, 108, 8.5),
        'loan.disbursementType',
        'tranches',
      ),
      conditioned(
        text(`tranches.${index}.accountOwner`, 3, 180, dateY + 12, 209, 8.5),
        'loan.disbursementType',
        'tranches',
      ),
    ]),
    ...[151, 192, 233, 274].flatMap((dateY, rowIndex) => {
      const index = rowIndex + 2
      return [
        conditioned(
          text(`tranches.${index}.date`, 4, 93, dateY - 7, 84, 8.5),
          'loan.disbursementType',
          'tranches',
        ),
        conditioned(
          text(`tranches.${index}.amount`, 4, 281, dateY - 7, 108, 8.5),
          'loan.disbursementType',
          'tranches',
        ),
        conditioned(
          text(`tranches.${index}.accountOwner`, 4, 180, dateY + 13, 209, 8.5),
          'loan.disbursementType',
          'tranches',
        ),
      ]
    }),
    mark('loan.installmentType', 'equal', 4, 347),
    mark('loan.installmentType', 'decreasing', 4, 371),
    mark('loan.gracePeriod', 'true', 4, 423),
    conditioned(
      text('loan.gracePeriodMonths', 4, 218, 438, 311, 8.5),
      'loan.gracePeriod',
      'true',
    ),
    mark('loan.gracePeriod', 'false', 4, 461),

    mark('property.type', 'house', 4, 578),
    mark('property.type', 'apartment', 4, 602),
    mark('property.type', 'plot', 4, 625),
    mark('property.type', 'other', 4, 648),
    {
      ...text('property.typeOther', 4, 279, 644, 250, 8.5),
      condition: { canonicalKey: 'property.type', equals: 'other' },
    },
    {
      canonicalKey: 'property.address.full',
      computed: true,
      valueFrom: ADDRESS_PARTS,
      valueFormat: 'fullAddress',
      reviewStatus: 'ready',
      target: textTarget(4, 101, 674, 428, 8.5),
    },
    text('property.landRegisterNumber', 4, 205, 704, 324),
    text('property.marketValue', 4, 330, 733, 186),

    mark('collateralProperty.type', 'house', 5, 239),
    mark('collateralProperty.type', 'apartment', 5, 263),
    mark('collateralProperty.type', 'plot', 5, 286),
    mark('collateralProperty.type', 'other', 5, 309),
    {
      ...text('collateralProperty.typeOther', 5, 279, 305, 250, 8.5),
      condition: { canonicalKey: 'collateralProperty.type', equals: 'other' },
    },
    text('collateralProperty.address', 5, 63, 354, 466, 8.5),
    text('collateralProperty.landRegisterNumber', 5, 205, 378, 324, 8.5),
    text('collateralProperty.marketValue', 5, 330, 403, 186, 8.5),

    mark('additionalProducts.enabled', 'true', 5, 526),
    mark('additionalProducts.enabled', 'false', 5, 550),
    mark('additionalProducts.lifeInsurance', 'true', 5, 617),
    mark('additionalProducts.propertyInsurance', 'true', 5, 655),
    mark('additionalProducts.personalAccount', 'true', 5, 675),
    mark('additionalProducts.creditCard', 'true', 5, 695),

    conditioned(
      text('additionalProducts.creditCardApplicant', 6, 405, 130, 124, 8.5),
      'additionalProducts.creditCard',
      'true',
    ),
    conditioned(
      text('additionalProducts.creditCardLimit', 6, 430, 152, 86, 8.5),
      'additionalProducts.creditCard',
      'true',
    ),
    mark('consents.earlyCreditDecision', 'true', 6, 363),
    mark('consents.earlyCreditDecision', 'false', 6, 386),

    mark('application.submissionChannel', 'branch', 7, 206),
    mark('application.submissionChannel', 'intermediary', 7, 229),
    mark('application.submissionChannel', 'agent_or_partner', 7, 252),
    mark('intermediary.kind', 'intermediary_or_partner', 7, 414),
    conditioned(
      text('intermediary.name', 7, 167, 430, 362, 8.5),
      'intermediary.kind',
      'intermediary_or_partner',
    ),
    conditioned(
      text('intermediary.email', 7, 252, 448, 277, 8.5),
      'intermediary.kind',
      'intermediary_or_partner',
    ),
    conditioned(
      text('intermediary.phone', 7, 134, 464, 395, 8.5),
      'intermediary.kind',
      'intermediary_or_partner',
    ),
    conditioned(
      text('intermediary.acceptingPerson', 7, 365, 481, 164, 8.5),
      'intermediary.kind',
      'intermediary_or_partner',
    ),
    mark('intermediary.kind', 'bank_agent', 7, 504),
    conditioned(
      text('intermediary.agentName', 7, 216, 521, 313, 8.5),
      'intermediary.kind',
      'bank_agent',
    ),
    mark('declarations.art17Information', 'true', 7, 631),
    mark('declarations.art17Information', 'false', 7, 654),

    mark('declarations.remunerationInformation', 'true', 7, 738),
    mark('declarations.remunerationInformation', 'false', 7, 762),
    mark('declarations.intermediaryTransfersToAgent', 'false', 8, 202),
    mark('declarations.intermediaryTransfersToAgent', 'true', 8, 226),
    conditioned(
      text('declarations.transferAgentName', 8, 279, 222, 250, 8.5),
      'declarations.intermediaryTransfersToAgent',
      'true',
    ),
  ],
}
