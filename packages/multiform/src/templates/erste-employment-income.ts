import type {
  DocumentTemplate,
  FieldCondition,
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
  paddingPt: { top: 1.25, right: 1.5, bottom: 1.25, left: 1.5 },
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
  height = 18,
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
  height = 18,
): TemplateBinding => ({
  canonicalKey,
  reviewStatus: 'ready',
  target: textTarget(page, x, y, width, fontSizePt, height),
})

const mark = (
  canonicalKey: string,
  equals: FieldCondition['equals'],
  page: number,
  x: number,
  y: number,
): TemplateBinding => ({
  canonicalKey,
  condition: { canonicalKey, equals },
  reviewStatus: 'ready',
  target: {
    kind: 'overlay',
    rendererVersion: 2,
    page,
    box: { x, y, width: 18, height: 18 },
    coordinateSpace: COORDINATE_SPACE,
    appearance: markAppearance,
  },
})

const booleanMarks = (
  canonicalKey: string,
  page: number,
  yesY: number,
  noY: number,
): TemplateBinding[] => [
  mark(canonicalKey, 'true', page, 62, yesY),
  mark(canonicalKey, 'false', page, 62, noY),
]

const BINDINGS: TemplateBinding[] = [
  {
    canonicalKey: 'applicants.0.fullName',
    computed: true,
    valueFrom: ['applicants.0.firstName', 'applicants.0.lastName'],
    valueFormat: 'fullName',
    reviewStatus: 'ready',
    target: textTarget(1, 153, 323, 378),
  },
  text('applicants.0.residentialAddress', 1, 62, 370, 469, 8.5),
  text('applicants.0.pesel', 1, 143, 393, 388),
  {
    ...text('applicants.0.birthDate', 1, 376, 416, 155),
    valueFormat: 'date.ddMMyyyy',
  },
  text('applicants.0.employerName', 1, 176, 470, 355),
  text('applicants.0.employerNip', 1, 85, 493, 182),
  text('applicants.0.employerRegon', 1, 316, 493, 215),
  text('applicants.0.employerRegistryNumber', 1, 455, 516, 76, 7.5),
  text('applicants.0.employerAddress', 1, 62, 560, 469, 8.5),
  text('applicants.0.employmentBenefitType', 1, 182, 606, 349, 8.5),
  {
    ...text('applicants.0.employmentStartDate', 1, 147, 653, 382),
    valueFormat: 'date.ddMMyyyy',
  },
  mark('applicants.0.employmentContractDuration', 'indefinite', 1, 62, 720),
  mark('applicants.0.employmentContractDuration', 'fixed_term', 1, 62, 744),
  {
    ...text('applicants.0.employmentEndDate', 1, 362, 742, 167),
    valueFormat: 'date.ddMMyyyy',
    condition: { canonicalKey: 'applicants.0.employmentContractDuration', equals: 'fixed_term' },
  },
  text('applicants.0.jobTitle', 1, 303, 766, 228),

  mark('applicants.0.incomeSource', 'retirement', 2, 62, 186),
  mark('applicants.0.incomeSource', ['employment', 'civil_contract'], 2, 62, 209),
  text('applicants.0.averageNetIncome', 2, 100, 252, 195),
  text('applicants.0.incomeCurrency', 2, 408, 252, 123),
  text('applicants.0.averageNetIncomeInWords', 2, 153, 276, 378, 8.5),
  mark('applicants.0.salaryPaymentMethod', 'bank_transfer', 2, 62, 326),
  mark('applicants.0.salaryPaymentMethod', 'cash', 2, 62, 349),
  ...booleanMarks('applicants.0.salaryGarnished', 2, 419, 443),
  {
    ...text('applicants.0.salaryGarnishmentAmount', 2, 149, 418, 125),
    condition: { canonicalKey: 'applicants.0.salaryGarnished', equals: 'true' },
  },
  ...booleanMarks('applicants.0.adverseEmploymentCircumstances', 2, 553, 577),
  {
    canonicalKey: 'application.placeAndDate',
    computed: true,
    valueFrom: ['application.place', 'application.date'],
    valueFormat: 'application.placeAndDate',
    reviewStatus: 'ready',
    target: textTarget(2, 62, 737, 285),
  },
]

export const ERSTE_EMPLOYMENT_INCOME_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'erste-employment-income-2026',
  bank: 'erste',
  label: 'Erste - Zaświadczenie albo oświadczenie o zatrudnieniu i zarobkach',
  version: 1,
  fillMethod: { kind: 'pdf_overlay' },
  source: {
    fileName: 'erste-zaswiadczenie-albo-oswiadczenie-o-zatrudnieniu-i-zarobkach-2026-04-25.pdf',
    sha256: '3d57673da0959a1764e9a7014842c75534740d1e6be6c9a8638bc9ac017df0ef',
    pageCount: 3,
    formKind: 'overlay',
    pages: Array.from({ length: 3 }, (_, index) => ({
      page: index + 1,
      mediaBox: { x: 0, y: 0, width: 594.96, height: 842.52 },
      cropBox: { x: 0, y: 0, width: 594.96, height: 842.52 },
      rotation: 0,
      userUnit: 1,
    })),
  },
  coverage: {
    status: 'complete',
    inScopeTargetCount: 28,
    mappedTargetCount: 28,
    manualUserActionCount: 3,
    excludedTargetCount: 1,
    notes: [
      'Pełny audyt oficjalnego 3-stronicowego formularza Erste obowiązującego od 25.04.2026.',
      'Formularz jest ważny przez 30 dni od wystawienia.',
      'Reklamowany słownik AcroForm nie zawiera pól ani widgetów, dlatego 28 pól klienta i pracodawcy jest wypełnianych precyzyjnym overlayem.',
      'Każdy aktywny wnioskodawca z umową o pracę, umową cywilnoprawną albo emeryturą lub rentą otrzymuje osobny egzemplarz.',
      'Podpis klienta oraz warunkowe podpis i pieczątka pracodawcy pozostają czynnościami ręcznymi; numer wniosku wypełnia pracownik banku.',
    ],
  },
  repeatFor: {
    collection: 'applicants',
    templateIndex: 0,
    maxInstances: 5,
    itemLabel: 'Wnioskodawca',
  },
  includeWhen: {
    canonicalKey: 'applicants.0.incomeSource',
    equals: ['employment', 'civil_contract', 'retirement'],
  },
  requiredCanonicalKeys: [
    'applicants.0.firstName',
    'applicants.0.lastName',
    'applicants.0.residentialAddress',
    'applicants.0.incomeSource',
    'applicants.0.employerName',
    'applicants.0.employerNip',
    'applicants.0.employerRegon',
    'applicants.0.employerAddress',
    'applicants.0.employmentBenefitType',
    'applicants.0.employmentStartDate',
    'applicants.0.employmentContractDuration',
    'applicants.0.averageNetIncome',
    'applicants.0.incomeCurrency',
    'applicants.0.averageNetIncomeInWords',
    'applicants.0.salaryPaymentMethod',
    'applicants.0.salaryGarnished',
    'applicants.0.adverseEmploymentCircumstances',
    'applicants.0.pesel',
  ],
  overlayOrigin: 'top-left',
  bindings: BINDINGS,
}
