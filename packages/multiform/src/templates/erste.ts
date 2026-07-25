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

function unreviewedApplicantBindings(
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
      reviewStatus: 'needsReview',
      mappingEvidence,
      target: textTarget(1, 155, fullNameY, 374),
    },
    {
      canonicalKey: `applicants.${index}.pesel`,
      reviewStatus: 'needsReview',
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
    status: 'incomplete',
    inScopeTargetCount: 106,
    mappedTargetCount: 33,
    manualUserActionCount: 5,
    excludedTargetCount: 4,
    notes: [
      'Pełny audyt 9 stron: 98 pól danych klienta i 8 zgód lub oświadczeń.',
      'Podpisy są osobnymi krokami użytkownika i nie wchodzą do mianownika pokrycia PDF.',
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
    ...unreviewedApplicantBindings(2, 622, 642),
    ...unreviewedApplicantBindings(3, 683, 703),
    ...unreviewedApplicantBindings(4, 744, 765),

    mark('loan.purpose', 'purchase_primary', 2, 245),
    mark('loan.purpose', 'purchase_secondary', 2, 266),
    mark('loan.purpose', 'construction', 2, 286),
    mark('loan.purpose', 'renovation', 2, 307),
    mark('loan.purpose', 'refinancing', 2, 348),
    mark('loan.purpose', 'other', 2, 368),
    {
      ...text('loan.purposeOther', 2, 153, 383, 376, 8.5),
      condition: { canonicalKey: 'loan.purpose', equals: 'other' },
    },

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
    text('loan.termMonths', 3, 308, 458, 208),
    text('loan.repaymentDay', 3, 318, 488, 198),

    mark('loan.interestType', 'periodically_fixed', 3, 619),
    mark('loan.interestType', 'variable', 3, 642),
    mark('loan.disbursementType', 'single', 3, 695),
    mark('loan.disbursementType', 'tranches', 3, 718),
    mark('loan.installmentType', 'equal', 4, 427),
    mark('loan.installmentType', 'decreasing', 4, 447),

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
  ],
}
