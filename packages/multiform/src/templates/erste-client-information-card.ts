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
  height = 17,
): PreciseOverlayTarget => ({
  kind: 'overlay',
  rendererVersion: 2,
  page,
  box: { x, y, width, height },
  coordinateSpace: COORDINATE_SPACE,
  appearance: textAppearance(fontSizePt),
})

const text = (
  canonicalKey: string,
  page: number,
  x: number,
  y: number,
  width: number,
  fontSizePt = 9,
  height = 17,
): TemplateBinding => ({
  canonicalKey,
  reviewStatus: 'ready',
  target: textTarget(page, x, y, width, fontSizePt, height),
})

const mark = (
  canonicalKey: string,
  equals: string,
  page: number,
  y: number,
  x = 62.5,
): TemplateBinding => ({
  canonicalKey,
  condition: { canonicalKey, equals },
  reviewStatus: 'ready',
  target: {
    kind: 'overlay',
    rendererVersion: 2,
    page,
    box: { x, y, width: 17, height: 17 },
    coordinateSpace: COORDINATE_SPACE,
    appearance: markAppearance,
  },
})

const booleanMarks = (
  canonicalKey: string,
  page: number,
  yesY: number,
  noY: number,
  x = 62.5,
): TemplateBinding[] => [
  mark(canonicalKey, 'true', page, yesY, x),
  mark(canonicalKey, 'false', page, noY, x),
]

const selectMarks = (
  canonicalKey: string,
  page: number,
  options: readonly (readonly [string, number])[],
  x = 62.5,
): TemplateBinding[] => options.map(([value, y]) => mark(canonicalKey, value, page, y, x))

interface LiabilityPlacement {
  institution: readonly [number, number, number, number]
  type: readonly [readonly [number, number], readonly [number, number], readonly [number, number]]
  product: readonly [readonly [number, number], readonly [number, number], readonly [number, number]]
  amount: readonly [number, number, number, number]
  payment: readonly [number, number, number, number]
  currency: readonly [number, number, number, number]
  party: readonly [readonly [number, number], readonly [number, number]]
}

function liabilityBindings(index: 0 | 1 | 2 | 3 | 4, placement: LiabilityPlacement): TemplateBinding[] {
  const prefix = `applicants.0.liabilities.${index}`
  const [institutionPage, institutionX, institutionY, institutionWidth] = placement.institution
  const [amountPage, amountX, amountY, amountWidth] = placement.amount
  const [paymentPage, paymentX, paymentY, paymentWidth] = placement.payment
  const [currencyPage, currencyX, currencyY, currencyWidth] = placement.currency

  return [
    text(`${prefix}.institution`, institutionPage, institutionX, institutionY, institutionWidth, 8.5),
    ...placement.type.map(([page, y], optionIndex) => mark(
      `${prefix}.obligationType`,
      ['obligation', 'guarantee', 'secured_obligation'][optionIndex]!,
      page,
      y,
    )),
    ...placement.product.map(([page, y], optionIndex) => mark(
      `${prefix}.productType`,
      ['consumer_credit', 'mortgage_secured_credit', 'business'][optionIndex]!,
      page,
      y,
    )),
    text(`${prefix}.outstandingAmount`, amountPage, amountX, amountY, amountWidth, 8.5),
    text(`${prefix}.monthlyPayment`, paymentPage, paymentX, paymentY, paymentWidth, 8.5),
    text(`${prefix}.currency`, currencyPage, currencyX, currencyY, currencyWidth, 8.5),
    mark(`${prefix}.burdenedParty`, 'applicant', placement.party[0][0], placement.party[0][1]),
    mark(`${prefix}.burdenedParty`, 'spouse', placement.party[1][0], placement.party[1][1]),
  ]
}

const BINDINGS: TemplateBinding[] = [
  text('applicants.0.firstName', 1, 160.7, 246, 164),
  text('applicants.0.middleName', 1, 327.7, 246, 205.8),
  text('applicants.0.lastName', 1, 121.2, 269, 410.4),
  text('applicants.0.pesel', 1, 144, 293, 387.3),
  {
    ...text('applicants.0.birthDate', 1, 280.1, 316, 252),
    valueFormat: 'date.ddMMyyyy',
  },
  text('applicants.0.identityDocumentType', 1, 153.8, 340, 378.7),
  text('applicants.0.identityDocumentNumber', 1, 276.1, 363, 257.4),
  text('applicants.0.birthPlace', 1, 170.8, 386, 361.4),
  text('applicants.0.countryOfResidence', 1, 165.2, 409, 367.2),
  text('applicants.0.citizenship', 1, 147.7, 433, 384.5),
  text('applicants.0.phone', 1, 154.2, 456, 378.7),
  text('applicants.0.email', 1, 224.7, 479, 306.7),
  text('applicants.0.residentialAddress', 1, 61.6, 526, 470.8, 8.5),
  text('applicants.0.correspondenceAddress', 1, 61.6, 572, 470.8, 8.5),
  ...selectMarks('applicants.0.maritalStatus', 1, [
    ['single', 705.4],
    ['married', 728.8],
    ['divorced', 752.1],
  ], 62.5),

  ...selectMarks('applicants.0.maritalStatus', 2, [
    ['separated', 132.2],
    ['widowed', 155.5],
  ], 62.5),
  ...booleanMarks('applicants.0.maritalPropertyCommunity', 2, 211.4, 234.4, 62.5),
  ...selectMarks('applicants.0.housingStatus', 2, [
    ['cooperative_tenancy', 290.2],
    ['municipal_or_tbs', 313.7],
    ['owner', 337.1],
    ['cooperative_ownership', 360.1],
    ['rental', 383.5],
    ['with_family', 406.8],
    ['other', 430.1],
  ], 62.5),
  mark('applicants.0.ownsMultiFamilyHouse', 'true', 2, 485.7, 62.5),
  mark('applicants.0.ownsSingleFamilyHouse', 'true', 2, 509, 62.5),
  mark('applicants.0.ownsApartment', 'true', 2, 532.2, 62.5),
  mark('applicants.0.ownsPlot', 'true', 2, 555.4, 62.5),
  mark('applicants.0.ownsOtherProperty', 'true', 2, 579.2, 62.5),
  text('applicants.0.householdSize', 2, 479.6, 611, 47.5),
  text('applicants.0.childBenefitCount', 2, 334.4, 654, 194.4),
  text('applicants.0.childBenefitBirthDate1', 2, 82.9, 724, 450.6),
  text('applicants.0.childBenefitBirthDate2', 2, 82.9, 751, 450.6),

  text('applicants.0.childBenefitBirthDate3', 3, 82.9, 132, 450.6),
  text('applicants.0.childBenefitBirthDate4', 3, 82.9, 158, 450.6),
  text('applicants.0.childBenefitBirthDate5', 3, 82.9, 185, 450.6),
  text('applicants.0.childBenefitBirthDate6', 3, 82.9, 211, 450.6),
  ...selectMarks('applicants.0.education', 3, [
    ['primary', 326.5],
    ['vocational', 349.5],
    ['secondary', 372.7],
    ['bachelor', 396.1],
    ['higher', 419.5],
    ['other', 442.7],
  ], 62.5),
  text('applicants.0.occupation', 3, 254.9, 475, 277.9),
  ...selectMarks('applicants.0.employmentCategory', 3, [
    ['public_budget', 530.9],
    ['local_or_state_admin', 554.1],
    ['state_enterprise', 577.4],
    ['joint_stock_company', 600.6],
    ['limited_liability_company', 624],
    ['private_enterprise', 647.4],
    ['cooperative', 670.5],
    ['freelance', 693.9],
    ['farmer', 717],
    ['pensioner', 740.1],
    ['student', 763.8],
  ], 62.5),

  ...selectMarks('applicants.0.employmentCategory', 4, [
    ['unemployed', 132.5],
    ['other', 155.4],
    ['self_employed', 179.2],
  ], 62.5),
  mark('applicants.0.employmentCategory', 'self_employed', 4, 202.3, 62.5),
  {
    ...text('applicants.0.businessLegalForm', 4, 371.1, 179, 151.1, 8.5),
    condition: { canonicalKey: 'applicants.0.employmentCategory', equals: 'self_employed' },
  },
  {
    ...text('applicants.0.pkdCode', 4, 140, 202, 171.3, 8.5),
    condition: { canonicalKey: 'applicants.0.employmentCategory', equals: 'self_employed' },
  },
  ...selectMarks('applicants.0.employmentTenure', 4, [
    ['up_to_6_months', 257.9],
    ['up_to_1_year', 281],
    ['up_to_2_years', 304.6],
    ['up_to_5_years', 327.6],
    ['up_to_10_years', 351],
    ['over_10_years', 374.4],
  ], 62.5),
  ...booleanMarks('applicants.0.businessActiveOrRecentlySuspended', 4, 470.8, 494.3, 62.5),

  ...liabilityBindings(0, {
    institution: [5, 226.3, 217, 280.8],
    type: [[5, 272.7], [5, 295.9], [5, 319.3]],
    product: [[5, 366], [5, 389.2], [5, 412.6]],
    amount: [5, 249.8, 439, 257.7],
    payment: [5, 157.4, 462, 349.9],
    currency: [5, 186.6, 486, 321.1],
    party: [[5, 534.9], [5, 558.4]],
  }),
  ...liabilityBindings(1, {
    institution: [5, 222.3, 591, 283.7],
    type: [[5, 640.5], [5, 663.8], [5, 687.2]],
    product: [[5, 736.9], [5, 760], [6, 132.3]],
    amount: [6, 249.8, 159, 257.7],
    payment: [6, 157.4, 182, 349.9],
    currency: [6, 186.6, 205, 321.1],
    party: [[6, 255], [6, 278.3]],
  }),
  ...liabilityBindings(2, {
    institution: [6, 226.4, 311, 280.8],
    type: [[6, 360.4], [6, 383.7], [6, 406.9]],
    product: [[6, 456.7], [6, 479.9], [6, 503.4]],
    amount: [6, 249.8, 530, 257.7],
    payment: [6, 157.4, 553, 349.9],
    currency: [6, 186.6, 576, 321.1],
    party: [[6, 625.7], [6, 649.2]],
  }),
  ...liabilityBindings(3, {
    institution: [6, 226.4, 673, 280.8],
    type: [[6, 719.4], [6, 742.7], [6, 765.8]],
    product: [[7, 155.5], [7, 179.1], [7, 202.4]],
    amount: [7, 249.8, 229, 257.7],
    payment: [7, 157.4, 252, 349.9],
    currency: [7, 186.6, 275, 321.1],
    party: [[7, 324.8], [7, 348]],
  }),
  ...liabilityBindings(4, {
    institution: [7, 226.4, 381, 280.8],
    type: [[7, 430.3], [7, 453.7], [7, 476.9]],
    product: [[7, 526.5], [7, 549.8], [7, 573.3]],
    amount: [7, 249.8, 600, 257.7],
    payment: [7, 157.4, 623, 349.9],
    currency: [7, 186.6, 646, 321.1],
    party: [[7, 695.7], [7, 719.1]],
  }),

  text('applicants.0.monthlyMaintenanceCosts', 8, 154.6, 255, 358.5),
  text('applicants.0.alimonyAndLegalBurdens', 8, 326.5, 275, 188.6),
  ...booleanMarks('applicants.0.collectionProceedings', 8, 331.4, 354.4, 62.5),
  {
    ...text('applicants.0.collectedDebtAmount', 8, 284.5, 331, 70.6),
    condition: { canonicalKey: 'applicants.0.collectionProceedings', equals: 'true' },
  },
  {
    canonicalKey: 'application.placeAndDate',
    computed: true,
    valueFrom: ['application.place', 'application.date'],
    valueFormat: 'application.placeAndDate',
    reviewStatus: 'ready',
    target: textTarget(8, 61.5, 651.5, 226.7, 9, 42.5),
  },
  {
    canonicalKey: 'application.placeAndDate',
    computed: true,
    valueFrom: ['application.place', 'application.date'],
    valueFormat: 'application.placeAndDate',
    condition: { canonicalKey: 'applicants.0.maritalStatus', equals: 'married' },
    reviewStatus: 'ready',
    target: textTarget(9, 61.5, 278.2, 226.7, 9, 42.5),
  },
]

export const ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'erste-client-information-card-2026',
  bank: 'erste',
  label: 'Erste - Karta Informacyjna Klienta',
  version: 2,
  fillMethod: { kind: 'pdf_overlay' },
  source: {
    fileName: 'erste-karta-informacyjna-klienta-2026-04-25.pdf',
    sha256: 'a68efa15f28eb014a76cf47896d0fdf68c41852d8889ccb5c8d9b72e70b5b860',
    pageCount: 9,
    formKind: 'overlay',
    pages: Array.from({ length: 9 }, (_, index) => ({
      page: index + 1,
      mediaBox: { x: 0, y: 0, width: 594.96, height: 843 },
      cropBox: { x: 0, y: 0, width: 594.96, height: 843 },
      rotation: 0,
      userUnit: 1,
    })),
  },
  coverage: {
    status: 'complete',
    inScopeTargetCount: 140,
    mappedTargetCount: 140,
    manualUserActionCount: 2,
    excludedTargetCount: 0,
    notes: [
      'Pełny audyt oficjalnej 9-stronicowej Karty Informacyjnej Klienta Erste obowiązującej od 25.04.2026.',
      'Źródło nie zawiera AcroForm ani widgetów, dlatego 140 targetów klienta jest wypełnianych precyzyjnym overlayem.',
      'Każdy aktywny wnioskodawca otrzymuje osobny egzemplarz karty; wspólne koszty nie mogą być deklarowane podwójnie.',
      'Podpis klienta na stronie 8 oraz warunkowy podpis współmałżonka na stronie 9 pozostają czynnościami ręcznymi.',
    ],
  },
  repeatFor: {
    collection: 'applicants',
    templateIndex: 0,
    maxInstances: 5,
    itemLabel: 'Wnioskodawca',
  },
  requiredCanonicalKeys: [
    'applicants.0.firstName',
    'applicants.0.lastName',
    'applicants.0.pesel',
    'applicants.0.birthDate',
    'applicants.0.identityDocumentType',
    'applicants.0.identityDocumentNumber',
    'applicants.0.birthPlace',
    'applicants.0.countryOfResidence',
    'applicants.0.citizenship',
    'applicants.0.phone',
    'applicants.0.email',
    'applicants.0.residentialAddress',
    'applicants.0.correspondenceSameAsResidential',
    'applicants.0.correspondenceAddress',
    'applicants.0.maritalStatus',
    'applicants.0.housingStatus',
    'applicants.0.householdSize',
    'applicants.0.childBenefitCount',
    'applicants.0.education',
    'applicants.0.occupation',
    'applicants.0.employmentCategory',
    'applicants.0.employmentTenure',
    'applicants.0.businessActiveOrRecentlySuspended',
    'applicants.0.monthlyMaintenanceCosts',
    'applicants.0.alimonyAndLegalBurdens',
    'applicants.0.collectionProceedings',
  ],
  bindings: BINDINGS,
}
