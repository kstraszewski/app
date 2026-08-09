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

const textAppearance = (
  fontSizePt: number,
  wrap: PdfTextAppearance['wrap'] = 'none',
): PdfTextAppearance => ({
  kind: 'text',
  fontId: 'dm-sans-regular',
  fontSizePt,
  minFontSizePt: 6,
  letterSpacingPt: 0,
  lineHeightPt: Number((fontSizePt * 1.2).toFixed(2)),
  wrap,
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
  wrap: PdfTextAppearance['wrap'] = 'none',
): PreciseOverlayTarget => ({
  kind: 'overlay',
  rendererVersion: 2,
  page,
  box: { x, y, width, height },
  coordinateSpace: COORDINATE_SPACE,
  appearance: textAppearance(fontSizePt, wrap),
})

const text = (
  canonicalKey: string,
  page: number,
  x: number,
  y: number,
  width: number,
  fontSizePt = 9,
  height = 17,
  wrap: PdfTextAppearance['wrap'] = 'none',
): TemplateBinding => ({
  canonicalKey,
  reviewStatus: 'ready',
  target: textTarget(page, x, y, width, fontSizePt, height, wrap),
})

const computedText = (
  canonicalKey: string,
  valueFrom: readonly string[],
  valueFormat: NonNullable<TemplateBinding['valueFormat']>,
  page: number,
  x: number,
  y: number,
  width: number,
  fontSizePt = 9,
  height = 17,
  wrap: PdfTextAppearance['wrap'] = 'none',
): TemplateBinding => ({
  canonicalKey,
  computed: true,
  valueFrom,
  valueFormat,
  reviewStatus: 'ready',
  target: textTarget(page, x, y, width, fontSizePt, height, wrap),
})

const conditioned = (
  binding: TemplateBinding,
  canonicalKey: string,
  equals: string | readonly string[],
): TemplateBinding => ({
  ...binding,
  condition: { canonicalKey, equals },
})

const markAt = (
  canonicalKey: string,
  equals: string | readonly string[],
  page: number,
  x: number,
  y: number,
  width = 17.03,
  height = 16.96,
): TemplateBinding => ({
  canonicalKey,
  condition: { canonicalKey, equals },
  reviewStatus: 'ready',
  target: {
    kind: 'overlay',
    rendererVersion: 2,
    page,
    box: { x, y, width, height },
    coordinateSpace: COORDINATE_SPACE,
    appearance: markAppearance,
  },
})

const preliminaryMark = (
  canonicalKey: string,
  equals: string | readonly string[],
  page: number,
  y: number,
) => markAt(canonicalKey, equals, page, 61.63, y)

const PROPERTY_ADDRESS_PARTS = [
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

function applicantIdentityBindings(
  index: 0 | 1 | 2 | 3,
  fullNameY: number,
  peselY: number,
): TemplateBinding[] {
  return [
    computedText(
      `applicants.${index}.fullName`,
      [`applicants.${index}.firstName`, `applicants.${index}.lastName`],
      'fullName',
      1,
      153,
      fullNameY,
      376,
    ),
    text(`applicants.${index}.pesel`, 1, 103, peselY, 426),
  ]
}

function postContractConsentBindings(
  index: 0 | 1 | 2 | 3,
  yesY: number,
  noY: number,
): TemplateBinding[] {
  const key = `applicants.${index}.postContractDataProcessingConsent`
  return [
    preliminaryMark(key, 'true', 6, yesY),
    preliminaryMark(key, 'false', 6, noY),
  ]
}

/**
 * Official static Erste form effective from 20.07.2026.
 * Source audit: no /AcroForm dictionary, no /Widget annotations and therefore
 * no widget /AP streams. All customer targets use reviewed overlay geometry.
 */
export const ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'erste-preliminary-conditions-2026',
  bank: 'erste',
  label: 'Erste - wniosek o określenie wstępnych warunków kredytu hipotecznego',
  version: 1,
  fillMethod: { kind: 'pdf_overlay' },
  source: {
    fileName: 'erste-wniosek-o-warunki-wstepne-kredytu-hipotecznego-2026-07-20.pdf',
    sha256: '009bc99152508b2b4e4f05a504ac785fc0cb7c3331e3c89a5b719a366f9ff2a5',
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
    inScopeTargetCount: 91,
    mappedTargetCount: 91,
    manualUserActionCount: 4,
    excludedTargetCount: 2,
    notes: [
      'Pełny audyt 9 stron oficjalnej wersji obowiązującej od 20.07.2026: 91 targetów klienta ma zatwierdzone mapowanie.',
      'Źródło nie zawiera słownika /AcroForm ani widgetów /Widget, dlatego formularz jest poprawnie wypełniany metodą overlay.',
      'Cztery podpisy wnioskodawców pozostają działaniami ręcznymi.',
      'Data przyjęcia i podpis osoby przyjmującej wniosek są polami bankowymi wyłączonymi z automatycznego wypełniania.',
    ],
  },
  requiredCanonicalKeys: [
    'loan.gracePeriod',
    'additionalProducts.enabled',
    'consents.electronicDocumentDelivery',
    'applicants.0.postContractDataProcessingConsent',
    'application.submissionChannel',
  ],
  bindings: [
    text('application.place', 1, 141, 241, 168),
    {
      ...text('application.date', 1, 398, 241, 99),
      valueFormat: 'date.ddMMyyyy',
    },
    ...applicantIdentityBindings(0, 485, 506),
    ...applicantIdentityBindings(1, 546, 566),
    ...applicantIdentityBindings(2, 607, 627),
    ...applicantIdentityBindings(3, 668, 688),

    preliminaryMark('loan.purpose', 'purchase_primary', 2, 239.53),
    preliminaryMark('loan.purpose', 'purchase_secondary', 2, 259.75),
    preliminaryMark('loan.purpose', 'construction', 2, 280.03),
    preliminaryMark('loan.purpose', 'renovation', 2, 300.51),
    preliminaryMark('loan.purpose', 'refinancing', 2, 320.99),
    preliminaryMark('loan.purpose', 'repayment_other_bank', 2, 341.07),
    preliminaryMark('loan.purpose', 'other', 2, 361.75),
    conditioned(text('loan.purposeOther', 2, 154, 376, 375, 8.5), 'loan.purpose', 'other'),
    preliminaryMark('loan.purpose', 'arbitrary_purpose', 2, 399.41),
    preliminaryMark('loan.purpose', 'family_purchase_primary', 2, 554.03),
    preliminaryMark('loan.purpose', 'family_purchase_secondary', 2, 574.41),
    preliminaryMark('loan.purpose', 'family_construction', 2, 594.79),
    preliminaryMark('loan.purpose', 'family_renovation', 2, 615.11),
    preliminaryMark('loan.purpose', 'mortgage_loan', 2, 664.95),
    conditioned(text('loan.mortgageLoanPurpose', 2, 90, 678, 376, 8.5), 'loan.purpose', 'mortgage_loan'),

    text('investment.totalCost', 3, 245, 222, 266),
    text('investment.renovationCost', 3, 249, 242, 262),
    computedText('investment.ownFunds', OWN_FUNDS_PARTS, 'currency.sum', 3, 146, 263, 365),
    text('loan.amount', 3, 149, 347, 362),
    text('loan.arbitraryPurposeAmount', 3, 241, 385, 270),
    text('loan.termMonths', 3, 306, 441, 208),
    preliminaryMark('loan.interestType', 'periodically_fixed', 3, 487.71),
    preliminaryMark('loan.interestType', 'variable', 3, 511.03),
    preliminaryMark('loan.disbursementType', 'single', 3, 557.97),
    preliminaryMark('loan.disbursementType', 'tranches', 3, 581.44),
    preliminaryMark('loan.installmentType', 'equal', 3, 634.17),
    preliminaryMark('loan.installmentType', 'decreasing', 3, 657.64),
    preliminaryMark('loan.gracePeriod', 'true', 3, 704.14),
    conditioned(text('loan.gracePeriodMonths', 3, 220, 718, 301, 8.5), 'loan.gracePeriod', 'true'),
    preliminaryMark('loan.gracePeriod', 'false', 3, 744.94),

    preliminaryMark('property.type', 'house', 4, 216.36),
    preliminaryMark('property.type', 'apartment', 4, 239.11),
    preliminaryMark('property.type', 'plot', 4, 262.31),
    preliminaryMark('property.type', 'other', 4, 285.16),
    conditioned(text('property.typeOther', 4, 277, 282, 252, 8.5), 'property.type', 'other'),
    computedText('property.address.full', PROPERTY_ADDRESS_PARTS, 'fullAddress', 4, 99, 303, 430, 8.5),
    text('property.landRegisterNumber', 4, 203, 323, 326, 8.5),
    text('property.marketValue', 4, 327, 343, 191, 8.5),
    preliminaryMark('collateralProperty.type', 'house', 4, 481.26),
    preliminaryMark('collateralProperty.type', 'apartment', 4, 504.61),
    preliminaryMark('collateralProperty.type', 'plot', 4, 527.65),
    preliminaryMark('collateralProperty.type', 'other', 4, 550.60),
    conditioned(text('collateralProperty.typeOther', 4, 277, 547, 252, 8.5), 'collateralProperty.type', 'other'),
    text('collateralProperty.address', 4, 223, 570, 306, 8.5),
    text('collateralProperty.landRegisterNumber', 4, 203, 610, 326, 8.5),
    text('collateralProperty.marketValue', 4, 327, 630, 191, 8.5),
    preliminaryMark('additionalProducts.enabled', 'true', 4, 743.98),
    preliminaryMark('additionalProducts.enabled', 'false', 4, 765.14),

    preliminaryMark('additionalProducts.lifeInsurance', 'true', 5, 169.32),
    preliminaryMark('additionalProducts.propertyInsurance', 'true', 5, 206.93),
    preliminaryMark('additionalProducts.personalAccount', 'true', 5, 227.41),
    preliminaryMark('additionalProducts.creditCard', 'true', 5, 247.89),
    conditioned(text('additionalProducts.creditCardApplicant', 5, 62, 351, 467, 8.5), 'additionalProducts.creditCard', 'true'),
    conditioned(text('additionalProducts.creditCardLimit', 5, 430, 375, 88, 8.5), 'additionalProducts.creditCard', 'true'),

    preliminaryMark('consents.electronicDocumentDelivery', 'true', 6, 192.64),
    preliminaryMark('consents.electronicDocumentDelivery', 'false', 6, 216.01),
    ...postContractConsentBindings(0, 477.89, 501.11),
    ...postContractConsentBindings(1, 547.85, 571.32),
    ...postContractConsentBindings(2, 617.92, 641.44),
    ...postContractConsentBindings(3, 688.08, 711.45),

    preliminaryMark('application.submissionChannel', 'branch', 7, 492.57),
    preliminaryMark('application.submissionChannel', 'intermediary', 7, 515.94),
    preliminaryMark('application.submissionChannel', 'agent_or_partner', 7, 539.31),

    preliminaryMark('intermediary.kind', 'intermediary_or_partner', 8, 174.52),
    conditioned(text('intermediary.name', 8, 167, 191, 342, 8.5), 'intermediary.kind', 'intermediary_or_partner'),
    conditioned(text('intermediary.email', 8, 252, 208, 257, 8.5), 'intermediary.kind', 'intermediary_or_partner'),
    conditioned(text('intermediary.phone', 8, 134, 225, 375, 8.5), 'intermediary.kind', 'intermediary_or_partner'),
    conditioned(text('intermediary.acceptingPerson', 8, 365, 242, 144, 8.5), 'intermediary.kind', 'intermediary_or_partner'),
    preliminaryMark('intermediary.kind', 'bank_agent', 8, 268.36),
    conditioned(text('intermediary.agentName', 8, 216, 288, 293, 8.5), 'intermediary.kind', 'bank_agent'),
    preliminaryMark('declarations.art17Information', 'true', 8, 394.51),
    preliminaryMark('declarations.art17Information', 'false', 8, 417.88),
    preliminaryMark('declarations.remunerationInformation', 'true', 8, 496.45),
    preliminaryMark('declarations.remunerationInformation', 'false', 8, 519.47),
    preliminaryMark('declarations.intermediaryTransfersToAgent', 'false', 8, 622.13),
    preliminaryMark('declarations.intermediaryTransfersToAgent', 'true', 8, 645.50),
    conditioned(text('declarations.transferAgentName', 8, 279, 642, 243, 8.5), 'declarations.intermediaryTransfersToAgent', 'true'),
  ],
}

const INVESTOR_PAYMENT_ROWS = [
  536.5,
  562.4,
  588.3,
  614.3,
  640.2,
  666.1,
  692.1,
  718.0,
] as const

function investorPaymentBindings(index: number, y: number): TemplateBinding[] {
  return [
    conditioned({
      ...text(`investorPayments.${index}.date`, 2, 64, y, 160, 7.2, 22),
      valueFormat: 'date.ddMMyyyy',
    }, 'investor.paymentScheduleType', 'tranches'),
    conditioned(
      text(`investorPayments.${index}.amount`, 2, 231, y, 150, 7.2, 22),
      'investor.paymentScheduleType',
      'tranches',
    ),
    conditioned(
      text(`investorPayments.${index}.purpose`, 2, 387, y, 157, 7.2, 22, 'word'),
      'investor.paymentScheduleType',
      'tranches',
    ),
  ]
}

/** Official static investor statement effective from 25.04.2026. */
export const ERSTE_INVESTOR_STATEMENT_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'erste-investor-statement-2026',
  bank: 'erste',
  label: 'Erste - oświadczenie inwestora',
  version: 1,
  fillMethod: { kind: 'pdf_overlay' },
  includeWhen: {
    canonicalKey: 'loan.purpose',
    equals: 'purchase_primary',
  },
  source: {
    fileName: 'erste-oswiadczenie-inwestora-2026-04-25.pdf',
    sha256: '2e92bf86367b182432901544d15ee4fa01e50607e7b6caeffd94f5df5c5289c7',
    pageCount: 3,
    formKind: 'overlay',
    pages: Array.from({ length: 3 }, (_, index) => ({
      page: index + 1,
      mediaBox: { x: 0, y: 0, width: 595.56, height: 842.04 },
      cropBox: { x: 0, y: 0, width: 595.56, height: 842.04 },
      rotation: 0,
      userUnit: 1,
    })),
  },
  coverage: {
    status: 'complete',
    inScopeTargetCount: 48,
    mappedTargetCount: 48,
    manualUserActionCount: 2,
    excludedTargetCount: 0,
    notes: [
      'Pełny audyt 3 stron oficjalnej wersji obowiązującej od 25.04.2026: 48 targetów klienta ma zatwierdzone mapowanie.',
      'Źródło nie zawiera słownika /AcroForm ani widgetów /Widget, dlatego formularz jest poprawnie wypełniany metodą overlay.',
      'Podpis i pieczątka inwestora pozostają działaniami ręcznymi; data podpisu jest uzupełniana z daty wniosku.',
      'Szablon jest dołączany wyłącznie dla zakupu na rynku pierwotnym.',
    ],
  },
  requiredCanonicalKeys: [
    'investor.name',
    'investor.buyerDetails',
    'investor.garageShareIncluded',
    'investor.otherSharesIncluded',
    'investor.paymentTiming',
    'investor.plotNumbers',
    'investor.constructionProgressPercent',
    'investor.expectedOwnershipTransferDate',
  ],
  bindings: [
    text('investor.name', 1, 165, 181, 367, 8.5),
    text('investor.buyerDetails', 1, 208, 261, 320, 8.5),
    markAt('property.type', 'apartment', 1, 99.91, 328.95, 16.98, 16.98),
    conditioned(text('investment.totalCost', 1, 235, 326, 282, 8.5), 'property.type', 'apartment'),
    markAt('property.type', 'house', 1, 100, 351.39, 16.98, 16.98),
    conditioned(text('investment.totalCost', 1, 304, 348, 217, 8.5), 'property.type', 'house'),
    markAt('investor.garageShareIncluded', 'true', 1, 100, 396.17, 16.98, 16.98),
    conditioned(text('investor.garageSharePrice', 1, 126, 416, 391, 8.5), 'investor.garageShareIncluded', 'true'),
    markAt('investor.otherSharesIncluded', 'true', 1, 100, 440.48, 16.98, 16.98),
    conditioned(text('investor.otherSharesPrice', 1, 323, 458, 192, 8.5), 'investor.otherSharesIncluded', 'true'),
    markAt('investor.paymentTiming', 'before_notarial_deed', 1, 81.53, 505.39, 16.98, 16.98),
    markAt('investor.paymentTiming', 'after_notarial_deed', 1, 81.53, 527.42, 16.98, 16.98),
    markAt('property.type', 'apartment', 1, 81.53, 639.60, 16.98, 16.98),
    conditioned(
      computedText('property.address.full', PROPERTY_ADDRESS_PARTS, 'fullAddress', 1, 104, 658, 428, 8, 56, 'word'),
      'property.type',
      'apartment',
    ),
    markAt('property.type', 'house', 1, 81.73, 721.55, 16.98, 16.98),
    conditioned(text('investor.houseTargetDescription', 1, 104, 759, 428, 8, 20, 'word'), 'property.type', 'house'),
    markAt('investor.garageShareIncluded', 'true', 2, 81.68, 174.22, 16.98, 16.98),
    conditioned(text('investor.garageShareTargetDescription', 2, 104, 211, 428, 8, 54, 'word'), 'investor.garageShareIncluded', 'true'),
    markAt('investor.paymentScheduleType', 'single', 2, 81.68, 401.68, 16.98, 16.98),
    markAt('investor.paymentScheduleType', 'tranches', 2, 81.53, 424.20, 16.98, 16.98),
    ...INVESTOR_PAYMENT_ROWS.flatMap((y, index) => investorPaymentBindings(index, y)),
    text('investor.plotNumbers', 2, 80, 763, 452, 8.5),
    text('investor.constructionProgressPercent', 3, 298, 128, 74, 8.5),
    {
      ...text('investor.expectedOwnershipTransferDate', 3, 80, 211, 452, 8.5),
      valueFormat: 'date.ddMMyyyy',
    },
    {
      ...text('application.date', 3, 64, 396, 220, 9, 37),
      valueFormat: 'date.ddMMyyyy',
    },
  ],
}
