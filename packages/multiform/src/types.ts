export type CanonicalFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'boolean'

export interface CanonicalFieldOption {
  value: string
  label: string
}

export interface CanonicalCollectionFieldRef {
  key: string
  index: number
  displayIndex: number
  relativeKey: string
  label: string
}

export interface CanonicalCollectionDefinition {
  key: string
  label: string
  itemLabel: string
  minItems: number
  maxItems: number
  requiredRelativeKeys: readonly string[]
}

export interface FieldCondition {
  canonicalKey: string
  equals: string | readonly string[]
}

export interface CanonicalFieldFormDefinition {
  question: string
  helpText?: string
}

export interface CanonicalFieldAiMappingHints {
  aliases: readonly string[]
  exclude: readonly string[]
}

export interface CanonicalFieldDefinition {
  canonicalKey: string
  label: string
  type: CanonicalFieldType
  group:
    | 'application'
    | 'applicants'
    | 'loan'
    | 'investment'
    | 'property'
    | 'household'
    | 'liabilities'
    | 'declarations'
  form: CanonicalFieldFormDefinition
  semanticDescription: string
  semanticRole: string
  aiMappingHints: CanonicalFieldAiMappingHints
  description?: string
  options?: readonly CanonicalFieldOption[]
  collection?: CanonicalCollectionFieldRef
  visibleWhen?: FieldCondition
  requiredWhen?: FieldCondition
  validation?: {
    pattern?: string
    maxLength?: number
    min?: number
    max?: number
    integer?: boolean
  }
}

export interface CanonicalComputedBindingDefinition {
  canonicalKey: string
  label: string
  type: CanonicalFieldType
  group: CanonicalFieldDefinition['group']
  semanticDescription: string
  semanticRole: string
  aiMappingHints: CanonicalFieldAiMappingHints
  collection?: CanonicalCollectionFieldRef
  computed: true
  valueFrom: readonly string[]
  valueFormat: ValueFormat
}

export interface PdfBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfPageGeometry {
  page: number
  mediaBox: PdfBox
  cropBox: PdfBox
  rotation: 0 | 90 | 180 | 270
  userUnit: number
}

export interface PdfCoordinateSpace {
  units: 'pt'
  referenceBox: 'crop' | 'media'
  origin: 'top-left' | 'bottom-left'
  /** `visual` means coordinates follow the page as displayed after /Rotate. */
  orientation: 'visual' | 'unrotated'
}

export type PdfColor =
  | { space: 'gray', value: number }
  | { space: 'rgb', red: number, green: number, blue: number }
  | { space: 'cmyk', cyan: number, magenta: number, yellow: number, black: number }

export interface PdfPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PdfTextAppearance {
  kind: 'text'
  /** Identifier resolved against the server-side font registry, never a path or URL. */
  fontId: 'dm-sans-regular'
  fontSizePt: number
  minFontSizePt: number
  letterSpacingPt: number
  lineHeightPt: number
  wrap: 'none' | 'word' | 'character'
  overflow: 'error' | 'shrink' | 'clip'
  horizontalAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  distribution: { kind: 'flow' } | { kind: 'comb', cells: number }
  color: PdfColor
  opacity: number
  paddingPt: PdfPadding
  rotationDegreesClockwise?: number
}

export interface PdfMarkAppearance {
  kind: 'mark'
  role: 'checkbox' | 'radio'
  glyph: 'x' | 'check' | 'dot' | 'fill'
  color: PdfColor
  opacity: number
  insetPt: number
  strokeWidthPt: number
  outline?: {
    shape: 'square' | 'circle'
    color: PdfColor
    strokeWidthPt: number
  }
}

export type PdfAppearance = PdfTextAppearance | PdfMarkAppearance

export interface AcroFormWidgetSnapshot {
  index: number
  page: number
  rect: PdfBox
  exportValue?: string
}

/**
 * An intentional visual placement override for one AcroForm widget.
 * The immutable expectedWidgets snapshot still describes the source PDF,
 * while this value tells the deterministic renderer where to draw the
 * flattened value after an administrator calibrates it visually.
 */
export interface AcroFormWidgetPlacementOverride {
  widgetIndex: number
  page: number
  box: PdfBox
  coordinateSpace: PdfCoordinateSpace
}

export interface AcroFormTextSnapshot {
  alignment: 'left' | 'center' | 'right'
  multiline: boolean
  comb: boolean
  maxLength?: number
}

export interface AcroFormTarget {
  kind: 'acroform'
  field: string
  fieldType?: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'option-list'
  /** Snapshot for review and source-drift detection. Runtime still verifies the real widget. */
  expectedWidgets?: readonly AcroFormWidgetSnapshot[]
  /** Optional administrator-approved render positions, addressed by source widget index. */
  placementOverrides?: readonly AcroFormWidgetPlacementOverride[]
  text?: AcroFormTextSnapshot
  appearance?: PdfAppearance
  valueMap?: Readonly<Record<string, string>>
}

export interface LegacyOverlayTarget {
  kind: 'overlay'
  rendererVersion?: 1
  page: number
  x: number
  y: number
  width?: number
  height?: number
  fontSize?: number
  format?: 'text' | 'mark'
}

export interface PreciseOverlayTarget {
  kind: 'overlay'
  rendererVersion: 2
  page: number
  box: PdfBox
  coordinateSpace: PdfCoordinateSpace
  appearance: PdfAppearance
}

export type OverlayTarget = LegacyOverlayTarget | PreciseOverlayTarget

export type XlsxCellValueType = 'string' | 'number' | 'date' | 'boolean'

export interface XlsxCellSnapshot {
  /** Zero-based style index from the immutable source worksheet XML. */
  styleIndex: number
  /** Source protection state; native filling preserves it exactly. */
  unlocked: boolean
  /** Native filling never overwrites a formula cell. */
  formula: false
}

export interface XlsxCellTarget {
  kind: 'xlsx_cell'
  sheet: string
  cell: string
  valueType: XlsxCellValueType
  /** Maps canonical enum/boolean values to exact values accepted by the bank workbook. */
  valueMap?: Readonly<Record<string, string | number | boolean>>
  /** Source-derived guard used to detect workbook drift before writing a value. */
  expected: XlsxCellSnapshot
}

export interface UnmappedTarget {
  kind: 'unmapped'
  reason: string
}

export type TemplateTarget = AcroFormTarget | OverlayTarget | XlsxCellTarget | UnmappedTarget

export type BindingCondition = FieldCondition

export type ValueFormat =
  | 'date.ddMMyyyy'
  | 'date.day'
  | 'date.month'
  | 'date.year'
  | 'application.placeAndDate'
  | 'currency.sum'
  | 'fullName'
  | 'fullAddress'
  | 'houseAndUnit'
  | 'streetHouseAndUnit'
  | 'landRegister.part1'
  | 'landRegister.part2'
  | 'landRegister.part3'
  | 'fraction.numerator'
  | 'fraction.denominator'
  | 'bankAccount.nrb'

export interface TemplateMappingEvidenceAnchor {
  kind: 'section' | 'label' | 'ordinal' | 'nearby-text' | 'acroform-name'
  reference: string
  page: number
  text: string
  box?: PdfBox
}

export interface TemplateMappingEvidence {
  origin: 'ai' | 'manual' | 'legacy'
  rationale: string
  confidence?: number
  anchors?: readonly TemplateMappingEvidenceAnchor[]
  model?: string
}

export interface TemplateBindingSemanticContract {
  semanticDescription: string
  semanticRole: string
  aiMappingHints: CanonicalFieldAiMappingHints
  source: 'manual' | 'ai'
  rationale?: string
  model?: string
}

export interface TemplateBinding {
  canonicalKey: string
  target: TemplateTarget
  computed?: boolean
  valueFrom?: readonly string[]
  valueFormat?: ValueFormat
  condition?: BindingCondition
  reviewStatus?: 'ready' | 'needsReview'
  semanticContract?: TemplateBindingSemanticContract
  mappingEvidence?: TemplateMappingEvidence
  notes?: string
}

export interface TemplateCoverage {
  /**
   * A template is complete only after every customer-facing target in the
   * source document has been inventoried and assigned a disposition.
   */
  status: 'complete' | 'incomplete'
  /** Targets that must be populated for a complete, unsigned customer PDF. */
  inScopeTargetCount: number
  /** In-scope targets currently populated by reviewed bindings. */
  mappedTargetCount: number
  /** Signatures or other explicit steps the customer must perform outside PDF filling. */
  manualUserActionCount?: number
  /** Bank-only, employee-only, or technical controls excluded from customer coverage. */
  excludedTargetCount?: number
  notes?: readonly string[]
}

/**
 * Domain contract describing how a template is completed.
 *
 * The PDF variants are supported by the current renderer. `web_form` and
 * `api` reserve stable domain identifiers for future handlers; validation
 * keeps them non-activatable until those handlers exist.
 */
export type PdfFormKind = 'acroform' | 'overlay' | 'hybrid'

export type PdfTemplateFillMethod =
  | { kind: 'pdf_acroform' }
  | { kind: 'pdf_overlay' }
  | { kind: 'pdf_hybrid' }
  /**
   * Keeps an official bank PDF in the application package without claiming
   * that the engine can complete its customer fields. The runtime sanitizes
   * the PDF, but the expert/customer must fill and sign it manually.
   */
  | { kind: 'pdf_manual' }
  /** Official bank material included unchanged in meaning; it has no fields to complete. */
  | { kind: 'pdf_readonly' }

export type SpreadsheetTemplateFillMethod =
  /** Writes canonical values into reviewed cells while preserving workbook formulas and layout. */
  | { kind: 'xlsx_native' }
  /** Keeps an official workbook in the package for manual completion. */
  | { kind: 'xlsx_manual' }

export type DeferredTemplateFillMethod =
  | { kind: 'web_form' }
  | { kind: 'api' }

export type TemplateFillMethod =
  | PdfTemplateFillMethod
  | SpreadsheetTemplateFillMethod
  | DeferredTemplateFillMethod

export interface XlsxWorkbookSheetSnapshot {
  name: string
  state: 'visible' | 'hidden' | 'veryHidden'
}

export interface XlsxWorkbookSnapshot {
  sheets: readonly XlsxWorkbookSheetSnapshot[]
  formulaCellCount: number
  structureProtected: boolean
}

/**
 * Repeats one bank form for every active item of a canonical collection.
 *
 * The template is authored once against `templateIndex` (normally applicant
 * zero). At runtime the engine remaps that indexed canonical prefix to the
 * requested collection item and renders a separate PDF. This keeps source
 * geometry auditable while supporting bank forms that are issued per person.
 */
export interface TemplateRepeatFor {
  collection: 'applicants'
  templateIndex: number
  maxInstances: number
  itemLabel: string
}

export interface DocumentTemplate {
  schemaVersion: 2
  id: string
  /** Stable mortgage bank slug from the CRM catalogue. */
  bank: string
  label: string
  version: number
  /**
   * Explicit completion contract. Optional only for records persisted before
   * this field existed; their PDF method is derived from `source.formKind`.
   */
  fillMethod?: TemplateFillMethod
  source: {
    fileName: string
    sha256: string
    mimeType?:
      | 'application/pdf'
      | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    pageCount: number
    /** @deprecated Compatibility metadata; use `fillMethod.kind` for routing. */
    formKind: PdfFormKind
    pages: readonly PdfPageGeometry[]
    /** Present for spreadsheet methods; PDF templates omit it. */
    workbook?: XlsxWorkbookSnapshot
  }
  coverage: TemplateCoverage
  repeatFor?: TemplateRepeatFor
  /** Includes the whole output document only when the canonical condition matches. */
  includeWhen?: FieldCondition
  /** Canonical inputs the bank requires before this document may be generated. */
  requiredCanonicalKeys?: readonly string[]
  overlayOrigin?: 'top-left' | 'bottom-left'
  bindings: readonly TemplateBinding[]
}

/** Resolves legacy PDF metadata to the explicit completion contract. */
export function resolveTemplateFillMethod(
  template: {
    fillMethod?: TemplateFillMethod
    source: Pick<DocumentTemplate['source'], 'formKind'>
  },
): TemplateFillMethod {
  if (template.fillMethod) return template.fillMethod

  if (template.source.formKind === 'acroform') return { kind: 'pdf_acroform' }
  if (template.source.formKind === 'hybrid') return { kind: 'pdf_hybrid' }
  return { kind: 'pdf_overlay' }
}

export interface BundleWarning {
  templateId: string
  canonicalKey: string
  status: 'needsReview' | 'unmapped'
  reason: string
}

export interface PreparedBundle {
  templateIds: readonly string[]
  documents: readonly DocumentTemplate[]
  fields: readonly CanonicalFieldDefinition[]
  collections: readonly CanonicalCollectionDefinition[]
  warnings: readonly BundleWarning[]
}
