import {
  CANONICAL_COMPUTED_BINDINGS,
  CANONICAL_FIELDS,
} from './canonical-fields.ts'
import { resolveTemplateFillMethod } from './types.ts'
import type {
  CanonicalComputedBindingDefinition,
  CanonicalFieldDefinition,
  PdfFormKind,
  PdfTemplateFillMethod,
} from './types.ts'

export type TemplateJsonKind = 'document-template' | 'generated-draft' | 'unknown'

export interface TemplateValidationIssue {
  path: string
  code: string
  severity: 'error' | 'warning'
  message: string
}

export interface TemplateValidationSummary {
  bindingCount: number
  mappedBindingCount: number
  readyBindingCount: number
  needsReviewCount: number
  unmappedCount: number
  activationReady: boolean
}

export interface TemplateValidationResult {
  kind: TemplateJsonKind
  valid: boolean
  fillReady: boolean
  errors: TemplateValidationIssue[]
  warnings: TemplateValidationIssue[]
  summary: TemplateValidationSummary
}

const canonicalFields: readonly CanonicalFieldDefinition[] = CANONICAL_FIELDS
const canonicalKeys = new Set<string>(canonicalFields.map(field => field.canonicalKey))
const computedBindings: readonly CanonicalComputedBindingDefinition[] = CANONICAL_COMPUTED_BINDINGS
interface ComputedBindingContract {
  valueFrom: readonly string[]
  valueFormat: string
}

const computedContractsByKey = new Map<string, readonly ComputedBindingContract[]>([
  ...computedBindings.map((binding): [string, readonly ComputedBindingContract[]] => [
    binding.canonicalKey,
    [binding],
  ]),
  [
    'investment.ownFunds',
    [
      {
        valueFrom: [
          'investment.ownFundsPaid',
          'investment.ownFundsBeforeDisbursement',
          'investment.ownFundsDuringInvestment',
        ],
        valueFormat: 'currency.sum',
      },
      {
        valueFrom: [
          'investment.ownFundsBeforeDisbursement',
          'investment.ownFundsDuringInvestment',
        ],
        valueFormat: 'currency.sum',
      },
    ],
  ],
])
const canonicalOptions = new Map<string, Set<string>>(canonicalFields.map(field => [
  field.canonicalKey,
  new Set(field.options?.map(option => option.value) ?? []),
]))
const valueFormats = new Set([
  'date.ddMMyyyy',
  'date.day',
  'date.month',
  'date.year',
  'application.placeAndDate',
  'currency.sum',
  'fullName',
  'fullAddress',
  'houseAndUnit',
  'landRegister.part1',
  'landRegister.part2',
  'landRegister.part3',
  'fraction.numerator',
  'fraction.denominator',
  'bankAccount.nrb',
])
const pdfFillMethodKinds = new Set([
  'pdf_acroform',
  'pdf_overlay',
  'pdf_hybrid',
])
const deferredFillMethodKinds = new Set([
  'web_form',
  'api',
])

type PdfFillMethodKind = PdfTemplateFillMethod['kind']

function pdfFillMethodForFormKind(formKind: PdfFormKind): PdfFillMethodKind {
  return resolveTemplateFillMethod({ source: { formKind } }).kind as PdfFillMethodKind
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function pushIssue(
  issues: TemplateValidationIssue[],
  path: string,
  code: string,
  message: string,
  severity: TemplateValidationIssue['severity'] = 'error',
) {
  issues.push({ path, code, message, severity })
}

function validateStringArray(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
): value is string[] {
  if (!Array.isArray(value) || value.some(item => !isNonEmptyString(item))) {
    pushIssue(errors, path, 'invalid_string_array', 'Wartość musi być tablicą niepustych tekstów.')
    return false
  }
  return true
}

function validateCondition(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
  warnings: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_condition', 'Warunek musi być obiektem.')
    return
  }
  if (!isNonEmptyString(value.canonicalKey)) {
    pushIssue(errors, `${path}.canonicalKey`, 'missing_canonical_key', 'Warunek wymaga canonicalKey.')
  }
  else if (!canonicalKeys.has(value.canonicalKey)) {
    pushIssue(warnings, `${path}.canonicalKey`, 'unknown_canonical_key', 'Warunek używa klucza spoza katalogu kanonicznego.', 'warning')
  }

  const expected = Array.isArray(value.equals) ? value.equals : [value.equals]
  if (expected.length === 0 || expected.some(item => !isNonEmptyString(item))) {
    pushIssue(errors, `${path}.equals`, 'invalid_condition_value', 'equals musi być tekstem lub niepustą tablicą tekstów.')
    return
  }

  if (isNonEmptyString(value.canonicalKey)) {
    const options = canonicalOptions.get(value.canonicalKey)
    if (options?.size && expected.some(item => !options.has(item as string))) {
      pushIssue(warnings, `${path}.equals`, 'unknown_condition_option', 'Warunek zawiera wartość spoza opcji pola kanonicznego.', 'warning')
    }
  }
}

function validateMappingEvidence(
  value: unknown,
  path: string,
  pageCount: number | undefined,
  errors: TemplateValidationIssue[],
  warnings: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_mapping_evidence', 'Dowód mapowania musi być obiektem.')
    return
  }
  if (!['ai', 'manual', 'legacy'].includes(String(value.origin))) {
    pushIssue(errors, `${path}.origin`, 'invalid_mapping_evidence_origin', 'origin musi mieć wartość ai, manual albo legacy.')
  }
  if (!isNonEmptyString(value.rationale)) {
    pushIssue(errors, `${path}.rationale`, 'missing_mapping_rationale', 'Dowód mapowania wymaga uzasadnienia.')
  }
  if (
    value.confidence !== undefined
    && (!isFiniteNumber(value.confidence) || value.confidence < 0 || value.confidence > 1)
  ) {
    pushIssue(errors, `${path}.confidence`, 'invalid_mapping_confidence', 'confidence musi być liczbą od 0 do 1.')
  }
  if (value.model !== undefined && !isNonEmptyString(value.model)) {
    pushIssue(errors, `${path}.model`, 'invalid_mapping_model', 'Identyfikator modelu musi być niepustym tekstem.')
  }
  if (value.anchors !== undefined) {
    if (!Array.isArray(value.anchors) || value.anchors.length > 12) {
      pushIssue(errors, `${path}.anchors`, 'invalid_mapping_anchors', 'anchors musi być tablicą maksymalnie 12 dowodów.')
    }
    else {
      for (const [anchorIndex, anchor] of value.anchors.entries()) {
        const anchorPath = `${path}.anchors[${anchorIndex}]`
        if (!isRecord(anchor)) {
          pushIssue(errors, anchorPath, 'invalid_mapping_anchor', 'Anchor dowodu musi być obiektem.')
          continue
        }
        if (!['section', 'label', 'ordinal', 'nearby-text', 'acroform-name'].includes(String(anchor.kind))) {
          pushIssue(errors, `${anchorPath}.kind`, 'invalid_mapping_anchor_kind', 'Anchor ma nieobsługiwany rodzaj.')
        }
        if (!isNonEmptyString(anchor.reference)) {
          pushIssue(errors, `${anchorPath}.reference`, 'missing_mapping_anchor_reference', 'Anchor wymaga stabilnej referencji.')
        }
        if (!isNonEmptyString(anchor.text)) {
          pushIssue(errors, `${anchorPath}.text`, 'missing_mapping_anchor_text', 'Anchor wymaga tekstu źródłowego.')
        }
        if (!isPositiveInteger(anchor.page) || (pageCount && anchor.page > pageCount)) {
          pushIssue(errors, `${anchorPath}.page`, 'invalid_mapping_anchor_page', 'Anchor wskazuje nieprawidłową stronę PDF.')
        }
        if (anchor.box !== undefined) validatePdfBox(anchor.box, `${anchorPath}.box`, errors)
      }
    }
  }
  if (value.origin === 'ai' && (!Array.isArray(value.anchors) || value.anchors.length === 0)) {
    pushIssue(
      warnings,
      `${path}.anchors`,
      'ai_mapping_without_anchors',
      'Propozycja AI nie wskazuje zweryfikowanego fragmentu źródłowego PDF-u.',
      'warning',
    )
  }
}

function validateSemanticHintList(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
  warnings: TemplateValidationIssue[],
) {
  if (!Array.isArray(value) || value.length > 30) {
    pushIssue(errors, path, 'invalid_semantic_hint_list', 'Lista wskazówek musi być tablicą maksymalnie 30 tekstów.')
    return
  }

  const normalized = new Set<string>()
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`
    if (!isNonEmptyString(item) || item.trim().length > 160) {
      pushIssue(errors, itemPath, 'invalid_semantic_hint', 'Wskazówka musi być niepustym tekstem do 160 znaków.')
      continue
    }
    const key = item.trim().toLocaleLowerCase('pl-PL')
    if (normalized.has(key)) {
      pushIssue(warnings, itemPath, 'duplicate_semantic_hint', 'Lista zawiera powtórzoną wskazówkę.', 'warning')
    }
    normalized.add(key)
  }
}

function validateBindingSemanticContract(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
  warnings: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_semantic_contract', 'Kontrakt semantyczny bindingu musi być obiektem.')
    return
  }
  if (!isNonEmptyString(value.semanticDescription) || value.semanticDescription.trim().length > 2_000) {
    pushIssue(errors, `${path}.semanticDescription`, 'invalid_semantic_description', 'Opis semantyczny musi mieć od 1 do 2000 znaków.')
  }
  if (
    !isNonEmptyString(value.semanticRole)
    || value.semanticRole.trim().length > 160
    || !/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u.test(value.semanticRole.trim())
  ) {
    pushIssue(errors, `${path}.semanticRole`, 'invalid_semantic_role', 'Rola semantyczna musi być stabilnym identyfikatorem do 160 znaków.')
  }
  if (!isRecord(value.aiMappingHints)) {
    pushIssue(errors, `${path}.aiMappingHints`, 'invalid_ai_mapping_hints', 'Wskazówki AI muszą zawierać listy aliases i exclude.')
  }
  else {
    validateSemanticHintList(value.aiMappingHints.aliases, `${path}.aiMappingHints.aliases`, errors, warnings)
    validateSemanticHintList(value.aiMappingHints.exclude, `${path}.aiMappingHints.exclude`, errors, warnings)
    if (Array.isArray(value.aiMappingHints.aliases) && Array.isArray(value.aiMappingHints.exclude)) {
      const aliases = new Set(value.aiMappingHints.aliases
        .filter(isNonEmptyString)
        .map(item => item.trim().toLocaleLowerCase('pl-PL')))
      for (const [index, item] of value.aiMappingHints.exclude.entries()) {
        if (
          isNonEmptyString(item)
          && aliases.has(item.trim().toLocaleLowerCase('pl-PL'))
        ) {
          pushIssue(
            errors,
            `${path}.aiMappingHints.exclude[${index}]`,
            'conflicting_semantic_hint',
            'Ta sama wskazówka nie może jednocześnie występować w aliases i exclude.',
          )
        }
      }
    }
  }
  if (!['manual', 'ai'].includes(String(value.source))) {
    pushIssue(errors, `${path}.source`, 'invalid_semantic_contract_source', 'Źródło kontraktu musi mieć wartość manual albo ai.')
  }
  if (value.rationale !== undefined && (!isNonEmptyString(value.rationale) || value.rationale.trim().length > 1_000)) {
    pushIssue(errors, `${path}.rationale`, 'invalid_semantic_rationale', 'Uzasadnienie musi być niepustym tekstem do 1000 znaków.')
  }
  if (value.model !== undefined && (!isNonEmptyString(value.model) || value.model.trim().length > 160)) {
    pushIssue(errors, `${path}.model`, 'invalid_semantic_model', 'Identyfikator modelu musi być niepustym tekstem do 160 znaków.')
  }
  if (value.source === 'ai' && value.model === undefined) {
    pushIssue(warnings, `${path}.model`, 'ai_semantic_contract_without_model', 'Kontrakt wygenerowany przez AI nie wskazuje użytego modelu.', 'warning')
  }
}

function validatePdfBox(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_pdf_box', 'Prostokąt PDF musi być obiektem x, y, width i height.')
    return false
  }

  for (const coordinate of ['x', 'y'] as const) {
    if (!isFiniteNumber(value[coordinate])) {
      pushIssue(errors, `${path}.${coordinate}`, 'invalid_pdf_coordinate', `${coordinate} musi być skończoną liczbą.`)
    }
  }
  for (const dimension of ['width', 'height'] as const) {
    if (!isFiniteNumber(value[dimension]) || value[dimension] <= 0) {
      pushIssue(errors, `${path}.${dimension}`, 'invalid_pdf_dimension', `${dimension} musi być dodatnią liczbą.`)
    }
  }

  return isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && value.width > 0
    && isFiniteNumber(value.height)
    && value.height > 0
}

function validatePdfColor(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_pdf_color', 'Kolor musi być obiektem gray, rgb albo cmyk.')
    return
  }

  const channels = value.space === 'gray'
    ? ['value']
    : value.space === 'rgb'
      ? ['red', 'green', 'blue']
      : value.space === 'cmyk'
        ? ['cyan', 'magenta', 'yellow', 'black']
        : undefined
  if (!channels) {
    pushIssue(errors, `${path}.space`, 'invalid_pdf_color_space', 'Obsługiwane przestrzenie koloru to gray, rgb i cmyk.')
    return
  }

  for (const channel of channels) {
    const item = value[channel]
    if (!isFiniteNumber(item) || item < 0 || item > 1) {
      pushIssue(errors, `${path}.${channel}`, 'invalid_pdf_color_channel', 'Składowa koloru musi mieścić się w zakresie 0-1.')
    }
  }
}

function validateAppearance(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_pdf_appearance', 'Appearance musi być obiektem text albo mark.')
    return 'invalid'
  }

  validatePdfColor(value.color, `${path}.color`, errors)
  if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) {
    pushIssue(errors, `${path}.opacity`, 'invalid_pdf_opacity', 'Opacity musi mieścić się w zakresie 0-1.')
  }

  if (value.kind === 'text') {
    if (value.fontId !== 'dm-sans-regular') {
      pushIssue(errors, `${path}.fontId`, 'unsupported_pdf_font', 'Renderer obsługuje obecnie fontId dm-sans-regular.')
    }
    for (const dimension of ['fontSizePt', 'minFontSizePt', 'lineHeightPt'] as const) {
      if (!isFiniteNumber(value[dimension]) || value[dimension] <= 0) {
        pushIssue(errors, `${path}.${dimension}`, 'invalid_text_dimension', `${dimension} musi być dodatnią liczbą.`)
      }
    }
    if (
      isFiniteNumber(value.fontSizePt)
      && isFiniteNumber(value.minFontSizePt)
      && value.minFontSizePt > value.fontSizePt
    ) {
      pushIssue(errors, `${path}.minFontSizePt`, 'minimum_font_exceeds_default', 'Minimalny rozmiar fontu nie może być większy od domyślnego.')
    }
    if (!isFiniteNumber(value.letterSpacingPt)) {
      pushIssue(errors, `${path}.letterSpacingPt`, 'invalid_letter_spacing', 'Letter spacing musi być skończoną liczbą punktów.')
    }
    if (!['none', 'word', 'character'].includes(String(value.wrap))) {
      pushIssue(errors, `${path}.wrap`, 'invalid_text_wrap', 'wrap musi mieć wartość none, word albo character.')
    }
    if (!['error', 'shrink', 'clip'].includes(String(value.overflow))) {
      pushIssue(errors, `${path}.overflow`, 'invalid_text_overflow', 'overflow musi mieć wartość error, shrink albo clip.')
    }
    if (!['left', 'center', 'right'].includes(String(value.horizontalAlign))) {
      pushIssue(errors, `${path}.horizontalAlign`, 'invalid_horizontal_align', 'Nieprawidłowe wyrównanie poziome.')
    }
    if (!['top', 'middle', 'bottom'].includes(String(value.verticalAlign))) {
      pushIssue(errors, `${path}.verticalAlign`, 'invalid_vertical_align', 'Nieprawidłowe wyrównanie pionowe.')
    }

    if (!isRecord(value.distribution) || !['flow', 'comb'].includes(String(value.distribution.kind))) {
      pushIssue(errors, `${path}.distribution`, 'invalid_text_distribution', 'Distribution musi mieć rodzaj flow albo comb.')
    }
    else if (value.distribution.kind === 'comb' && !isPositiveInteger(value.distribution.cells)) {
      pushIssue(errors, `${path}.distribution.cells`, 'invalid_comb_cells', 'Układ comb wymaga dodatniej liczby komórek.')
    }

    if (!isRecord(value.paddingPt)) {
      pushIssue(errors, `${path}.paddingPt`, 'invalid_pdf_padding', 'Padding musi zawierać top, right, bottom i left.')
    }
    else {
      for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
        if (!isFiniteNumber(value.paddingPt[edge]) || value.paddingPt[edge] < 0) {
          pushIssue(errors, `${path}.paddingPt.${edge}`, 'invalid_pdf_padding', 'Padding nie może być ujemny.')
        }
      }
    }
    if (value.rotationDegreesClockwise !== undefined && !isFiniteNumber(value.rotationDegreesClockwise)) {
      pushIssue(errors, `${path}.rotationDegreesClockwise`, 'invalid_text_rotation', 'Obrót tekstu musi być skończoną liczbą stopni.')
    }
    return 'text'
  }

  if (value.kind === 'mark') {
    if (!['checkbox', 'radio'].includes(String(value.role))) {
      pushIssue(errors, `${path}.role`, 'invalid_mark_role', 'Rola markera musi mieć wartość checkbox albo radio.')
    }
    if (!['x', 'check', 'dot', 'fill'].includes(String(value.glyph))) {
      pushIssue(errors, `${path}.glyph`, 'invalid_mark_glyph', 'Glyph musi mieć wartość x, check, dot albo fill.')
    }
    for (const dimension of ['insetPt', 'strokeWidthPt'] as const) {
      if (!isFiniteNumber(value[dimension]) || value[dimension] < 0) {
        pushIssue(errors, `${path}.${dimension}`, 'invalid_mark_dimension', `${dimension} musi być nieujemną liczbą.`)
      }
    }
    if (value.outline !== undefined) {
      if (!isRecord(value.outline)) {
        pushIssue(errors, `${path}.outline`, 'invalid_mark_outline', 'Outline musi być obiektem.')
      }
      else {
        if (!['square', 'circle'].includes(String(value.outline.shape))) {
          pushIssue(errors, `${path}.outline.shape`, 'invalid_mark_outline_shape', 'Outline musi mieć kształt square albo circle.')
        }
        validatePdfColor(value.outline.color, `${path}.outline.color`, errors)
        if (!isFiniteNumber(value.outline.strokeWidthPt) || value.outline.strokeWidthPt < 0) {
          pushIssue(errors, `${path}.outline.strokeWidthPt`, 'invalid_mark_outline_width', 'Grubość outline nie może być ujemna.')
        }
      }
    }
    return 'mark'
  }

  pushIssue(errors, `${path}.kind`, 'invalid_pdf_appearance_kind', 'Appearance musi mieć rodzaj text albo mark.')
  return 'invalid'
}

function validateCoordinateSpace(
  value: unknown,
  path: string,
  errors: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_coordinate_space', 'Coordinate space musi być obiektem.')
    return false
  }
  if (value.units !== 'pt') pushIssue(errors, `${path}.units`, 'invalid_coordinate_units', 'Jednostką muszą być punkty PDF (pt).')
  if (!['crop', 'media'].includes(String(value.referenceBox))) {
    pushIssue(errors, `${path}.referenceBox`, 'invalid_reference_box', 'Reference box musi mieć wartość crop albo media.')
  }
  if (!['top-left', 'bottom-left'].includes(String(value.origin))) {
    pushIssue(errors, `${path}.origin`, 'invalid_coordinate_origin', 'Origin musi mieć wartość top-left albo bottom-left.')
  }
  if (!['visual', 'unrotated'].includes(String(value.orientation))) {
    pushIssue(errors, `${path}.orientation`, 'invalid_coordinate_orientation', 'Orientation musi mieć wartość visual albo unrotated.')
  }
  return value.units === 'pt'
    && ['crop', 'media'].includes(String(value.referenceBox))
    && ['top-left', 'bottom-left'].includes(String(value.origin))
    && ['visual', 'unrotated'].includes(String(value.orientation))
}

function validateTarget(
  value: unknown,
  path: string,
  sourcePageCount: number | undefined,
  sourcePages: ReadonlyMap<number, Record<string, unknown>>,
  schemaVersion: unknown,
  errors: TemplateValidationIssue[],
) {
  if (!isRecord(value)) {
    pushIssue(errors, path, 'invalid_target', 'Target musi być obiektem.')
    return { kind: 'invalid', signature: '' }
  }

  if (value.kind === 'acroform') {
    if (!isNonEmptyString(value.field)) {
      pushIssue(errors, `${path}.field`, 'missing_acroform_field', 'Target AcroForm wymaga technicznej nazwy pola.')
    }
    if (value.valueMap !== undefined) {
      if (!isRecord(value.valueMap) || Object.entries(value.valueMap).some(([key, item]) => !key || !isNonEmptyString(item))) {
        pushIssue(errors, `${path}.valueMap`, 'invalid_value_map', 'valueMap musi mapować niepuste teksty na niepuste teksty.')
      }
    }
    const fieldTypeValid = ['text', 'checkbox', 'radio', 'dropdown', 'option-list'].includes(String(value.fieldType))
    if (value.fieldType !== undefined && !fieldTypeValid) {
      pushIssue(errors, `${path}.fieldType`, 'invalid_acroform_field_type', 'Nieobsługiwany typ pola AcroForm.')
    }
    let widgetSnapshotValid = false
    const expectedWidgetIndexes = new Set<number>()
    if (value.expectedWidgets !== undefined) {
      if (!Array.isArray(value.expectedWidgets) || value.expectedWidgets.length === 0) {
        pushIssue(errors, `${path}.expectedWidgets`, 'invalid_widget_snapshot', 'Snapshot widgetów musi być niepustą tablicą.')
      }
      else {
        widgetSnapshotValid = true
        for (const [widgetIndex, rawWidget] of value.expectedWidgets.entries()) {
          const widgetPath = `${path}.expectedWidgets[${widgetIndex}]`
          if (!isRecord(rawWidget)) {
            pushIssue(errors, widgetPath, 'invalid_widget_snapshot', 'Widget musi być obiektem.')
            continue
          }
          if (!isNonNegativeInteger(rawWidget.index)) {
            widgetSnapshotValid = false
            pushIssue(errors, `${widgetPath}.index`, 'invalid_widget_index', 'Index widgetu musi być nieujemną liczbą całkowitą.')
          }
          else if (expectedWidgetIndexes.has(rawWidget.index)) {
            widgetSnapshotValid = false
            pushIssue(errors, `${widgetPath}.index`, 'duplicate_widget_index', 'Każdy widget pola musi mieć unikalny index.')
          }
          else expectedWidgetIndexes.add(rawWidget.index)
          if (!isPositiveInteger(rawWidget.page) || (sourcePageCount && rawWidget.page > sourcePageCount)) {
            widgetSnapshotValid = false
            pushIssue(errors, `${widgetPath}.page`, 'invalid_widget_page', 'Widget wskazuje nieprawidłową stronę PDF-u.')
          }
          const widgetRectValid = validatePdfBox(rawWidget.rect, `${widgetPath}.rect`, errors)
          if (!widgetRectValid) widgetSnapshotValid = false
          if (widgetRectValid && isPositiveInteger(rawWidget.page)) {
            const pageGeometry = sourcePages.get(rawWidget.page)
            const mediaBox = pageGeometry?.mediaBox
            if (isRecord(mediaBox)) {
              const rect = rawWidget.rect as Record<string, unknown>
              if (
                isFiniteNumber(mediaBox.x)
                && isFiniteNumber(mediaBox.y)
                && isFiniteNumber(mediaBox.width)
                && isFiniteNumber(mediaBox.height)
                && isFiniteNumber(rect.x)
                && isFiniteNumber(rect.y)
                && isFiniteNumber(rect.width)
                && isFiniteNumber(rect.height)
                && (
                  rect.x < mediaBox.x
                  || rect.y < mediaBox.y
                  || rect.x + rect.width > mediaBox.x + mediaBox.width
                  || rect.y + rect.height > mediaBox.y + mediaBox.height
                )
              ) {
                widgetSnapshotValid = false
                pushIssue(errors, `${widgetPath}.rect`, 'widget_rect_out_of_bounds', 'Snapshot widgetu wychodzi poza MediaBox strony.')
              }
            }
          }
          if (rawWidget.exportValue !== undefined && !isNonEmptyString(rawWidget.exportValue)) {
            widgetSnapshotValid = false
            pushIssue(errors, `${widgetPath}.exportValue`, 'invalid_widget_export_value', 'Export value widgetu musi być niepustym tekstem.')
          }
        }
      }
    }
    if (value.placementOverrides !== undefined) {
      if (!Array.isArray(value.placementOverrides) || value.placementOverrides.length === 0) {
        pushIssue(errors, `${path}.placementOverrides`, 'invalid_placement_overrides', 'Nadpisania pozycji muszą być niepustą tablicą.')
      }
      else {
        const overrideIndexes = new Set<number>()
        for (const [overrideIndex, rawOverride] of value.placementOverrides.entries()) {
          const overridePath = `${path}.placementOverrides[${overrideIndex}]`
          if (!isRecord(rawOverride)) {
            pushIssue(errors, overridePath, 'invalid_placement_override', 'Nadpisanie pozycji widgetu musi być obiektem.')
            continue
          }
          if (!isNonNegativeInteger(rawOverride.widgetIndex)) {
            pushIssue(errors, `${overridePath}.widgetIndex`, 'invalid_widget_index', 'Index widgetu musi być nieujemną liczbą całkowitą.')
          }
          else if (overrideIndexes.has(rawOverride.widgetIndex)) {
            pushIssue(errors, `${overridePath}.widgetIndex`, 'duplicate_placement_override', 'Każdy widget może mieć tylko jedno nadpisanie pozycji.')
          }
          else {
            overrideIndexes.add(rawOverride.widgetIndex)
            if (expectedWidgetIndexes.size > 0 && !expectedWidgetIndexes.has(rawOverride.widgetIndex)) {
              pushIssue(errors, `${overridePath}.widgetIndex`, 'unknown_widget_override', 'Nadpisanie wskazuje widget nieobecny w snapshotcie źródłowego PDF-u.')
            }
          }

          if (!isPositiveInteger(rawOverride.page) || (sourcePageCount && rawOverride.page > sourcePageCount)) {
            pushIssue(errors, `${overridePath}.page`, 'invalid_override_page', 'Nadpisanie wskazuje nieprawidłową stronę PDF-u.')
          }
          const boxValid = validatePdfBox(rawOverride.box, `${overridePath}.box`, errors)
          const coordinateSpaceValid = validateCoordinateSpace(rawOverride.coordinateSpace, `${overridePath}.coordinateSpace`, errors)
          if (boxValid && coordinateSpaceValid && isPositiveInteger(rawOverride.page)) {
            const pageGeometry = sourcePages.get(rawOverride.page)
            const box = rawOverride.box as Record<string, unknown>
            const coordinateSpace = rawOverride.coordinateSpace as Record<string, unknown>
            const reference = pageGeometry && isRecord(pageGeometry[
              coordinateSpace.referenceBox === 'media' ? 'mediaBox' : 'cropBox'
            ])
              ? pageGeometry[coordinateSpace.referenceBox === 'media' ? 'mediaBox' : 'cropBox'] as Record<string, unknown>
              : undefined
            if (reference && isFiniteNumber(reference.width) && isFiniteNumber(reference.height)) {
              const rotatedVisual = coordinateSpace.orientation === 'visual'
                && [90, 270].includes(Number(pageGeometry?.rotation))
              const userUnit = isFiniteNumber(pageGeometry?.userUnit) ? pageGeometry.userUnit : 1
              const availableWidth = (rotatedVisual ? reference.height : reference.width) * userUnit
              const availableHeight = (rotatedVisual ? reference.width : reference.height) * userUnit
              if (
                isFiniteNumber(box.x)
                && isFiniteNumber(box.y)
                && isFiniteNumber(box.width)
                && isFiniteNumber(box.height)
                && (box.x < 0 || box.y < 0 || box.x + box.width > availableWidth || box.y + box.height > availableHeight)
              ) {
                pushIssue(errors, `${overridePath}.box`, 'placement_override_out_of_bounds', 'Nadpisana pozycja widgetu wychodzi poza wybrany box strony.')
              }
            }
          }
        }
      }
    }
    let textSnapshotValid = value.fieldType !== 'text'
    if (value.text !== undefined) {
      if (!isRecord(value.text)) pushIssue(errors, `${path}.text`, 'invalid_acroform_text_snapshot', 'Metadane tekstowe AcroForm muszą być obiektem.')
      else {
        textSnapshotValid = true
        if (!['left', 'center', 'right'].includes(String(value.text.alignment))) pushIssue(errors, `${path}.text.alignment`, 'invalid_acroform_alignment', 'Nieprawidłowe wyrównanie pola AcroForm.')
        if (typeof value.text.multiline !== 'boolean') pushIssue(errors, `${path}.text.multiline`, 'invalid_acroform_multiline', 'multiline musi być wartością logiczną.')
        if (typeof value.text.comb !== 'boolean') pushIssue(errors, `${path}.text.comb`, 'invalid_acroform_comb', 'comb musi być wartością logiczną.')
        if (value.text.maxLength !== undefined && !isPositiveInteger(value.text.maxLength)) pushIssue(errors, `${path}.text.maxLength`, 'invalid_acroform_max_length', 'maxLength musi być dodatnią liczbą całkowitą.')
        textSnapshotValid = ['left', 'center', 'right'].includes(String(value.text.alignment))
          && typeof value.text.multiline === 'boolean'
          && typeof value.text.comb === 'boolean'
          && (value.text.maxLength === undefined || isPositiveInteger(value.text.maxLength))
      }
    }
    const appearanceKind = value.appearance === undefined
      ? undefined
      : validateAppearance(value.appearance, `${path}.appearance`, errors)
    const appearanceMatches = value.fieldType === 'text'
      || ['dropdown', 'option-list'].includes(String(value.fieldType))
      ? appearanceKind === 'text'
      : ['checkbox', 'radio'].includes(String(value.fieldType))
        ? appearanceKind === 'mark'
        : false
    if (fieldTypeValid && value.appearance !== undefined && !appearanceMatches) {
      pushIssue(errors, `${path}.appearance`, 'acroform_appearance_mismatch', 'Appearance nie pasuje do typu pola AcroForm.')
    }
    return {
      kind: 'acroform',
      signature: isNonEmptyString(value.field) ? `acroform:${value.field}` : '',
      auditable: widgetSnapshotValid
        && fieldTypeValid
        && appearanceMatches
        && textSnapshotValid,
    }
  }

  if (value.kind === 'overlay') {
    if (!isPositiveInteger(value.page)) {
      pushIssue(errors, `${path}.page`, 'invalid_overlay_page', 'Numer strony overlay musi być dodatnią liczbą całkowitą.')
    }
    else if (sourcePageCount && value.page > sourcePageCount) {
      pushIssue(errors, `${path}.page`, 'overlay_page_out_of_range', 'Numer strony overlay przekracza liczbę stron PDF-u.')
    }
    if (value.rendererVersion === 2) {
      const boxValid = validatePdfBox(value.box, `${path}.box`, errors)
      const coordinateSpaceValid = validateCoordinateSpace(value.coordinateSpace, `${path}.coordinateSpace`, errors)
      validateAppearance(value.appearance, `${path}.appearance`, errors)

      if (boxValid && coordinateSpaceValid && isPositiveInteger(value.page)) {
        const pageGeometry = sourcePages.get(value.page)
        const box = value.box as Record<string, unknown>
        const coordinateSpace = value.coordinateSpace as Record<string, unknown>
        const reference = pageGeometry && isRecord(pageGeometry[
          coordinateSpace.referenceBox === 'media' ? 'mediaBox' : 'cropBox'
        ])
          ? pageGeometry[coordinateSpace.referenceBox === 'media' ? 'mediaBox' : 'cropBox'] as Record<string, unknown>
          : undefined
        if (reference && isFiniteNumber(reference.width) && isFiniteNumber(reference.height)) {
          const rotation = coordinateSpace.orientation === 'visual' && [90, 270].includes(Number(pageGeometry?.rotation))
          const userUnit = isFiniteNumber(pageGeometry?.userUnit) ? pageGeometry.userUnit : 1
          const availableWidth = (rotation ? reference.height : reference.width) * userUnit
          const availableHeight = (rotation ? reference.width : reference.height) * userUnit
          if (
            isFiniteNumber(box.x)
            && isFiniteNumber(box.y)
            && isFiniteNumber(box.width)
            && isFiniteNumber(box.height)
            && (box.x < 0 || box.y < 0 || box.x + box.width > availableWidth || box.y + box.height > availableHeight)
          ) {
            pushIssue(errors, `${path}.box`, 'overlay_box_out_of_bounds', 'Prostokąt overlay wychodzi poza wybrany box strony.')
          }
        }
      }

      return {
        kind: 'overlay',
        signature: isPositiveInteger(value.page) && isRecord(value.box) && isFiniteNumber(value.box.x) && isFiniteNumber(value.box.y)
          ? `overlay:v2:${value.page}:${value.box.x}:${value.box.y}:${value.box.width}:${value.box.height}`
          : '',
        auditable: true,
      }
    }

    if (schemaVersion === 2) {
      pushIssue(errors, `${path}.rendererVersion`, 'legacy_overlay_in_v2_template', 'Template schemaVersion 2 wymaga precyzyjnego overlay rendererVersion 2.')
    }
    for (const coordinate of ['x', 'y'] as const) {
      if (!isFiniteNumber(value[coordinate])) {
        pushIssue(errors, `${path}.${coordinate}`, 'invalid_overlay_coordinate', `${coordinate} musi być skończoną liczbą.`)
      }
    }
    for (const dimension of ['width', 'height', 'fontSize'] as const) {
      const item = value[dimension]
      if (item !== undefined && (!isFiniteNumber(item) || item <= 0)) {
        pushIssue(errors, `${path}.${dimension}`, 'invalid_overlay_dimension', `${dimension} musi być dodatnią liczbą.`)
      }
    }
    if (value.format !== undefined && !['text', 'mark'].includes(String(value.format))) {
      pushIssue(errors, `${path}.format`, 'invalid_overlay_format', 'format overlay musi mieć wartość text albo mark.')
    }
    return {
      kind: 'overlay',
      signature: isPositiveInteger(value.page) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
        ? `overlay:${value.page}:${value.x}:${value.y}`
        : '',
      auditable: false,
    }
  }

  if (value.kind === 'unmapped') {
    if (!isNonEmptyString(value.reason)) {
      pushIssue(errors, `${path}.reason`, 'missing_unmapped_reason', 'Nieprzypisany target wymaga uzasadnienia.')
    }
    return { kind: 'unmapped', signature: '', auditable: false }
  }

  pushIssue(errors, `${path}.kind`, 'unknown_target_kind', 'Obsługiwane targety to acroform, overlay i unmapped.')
  return { kind: 'invalid', signature: '', auditable: false }
}

export function validateTemplateJson(input: unknown): TemplateValidationResult {
  const errors: TemplateValidationIssue[] = []
  const warnings: TemplateValidationIssue[] = []
  const emptySummary: TemplateValidationSummary = {
    bindingCount: 0,
    mappedBindingCount: 0,
    readyBindingCount: 0,
    needsReviewCount: 0,
    unmappedCount: 0,
    activationReady: false,
  }

  if (!isRecord(input)) {
    pushIssue(errors, '$', 'invalid_root', 'Template JSON musi być obiektem.')
    return { kind: 'unknown', valid: false, fillReady: false, errors, warnings, summary: emptySummary }
  }

  const coverage = isRecord(input.coverage) ? input.coverage : undefined
  const kind: TemplateJsonKind = input.status === 'draft' || coverage?.status === 'auditRequired'
    ? 'generated-draft'
    : 'document-template'

  if (input.schemaVersion !== 2) {
    pushIssue(errors, 'schemaVersion', 'invalid_schema_version', 'Template musi używać schemaVersion 2.')
  }
  if (!isNonEmptyString(input.id)) pushIssue(errors, 'id', 'missing_id', 'Template wymaga niepustego id.')
  if (!isNonEmptyString(input.label)) pushIssue(errors, 'label', 'missing_label', 'Template wymaga etykiety.')
  if (!isPositiveInteger(input.version)) pushIssue(errors, 'version', 'invalid_version', 'Wersja musi być dodatnią liczbą całkowitą.')

  let effectivePdfFillMethod: PdfFillMethodKind | undefined
  let fillMethodRuntimeSupported = false
  if (input.fillMethod !== undefined) {
    if (!isRecord(input.fillMethod)) {
      pushIssue(errors, 'fillMethod', 'invalid_fill_method', 'Metoda uzupełniania musi być obiektem.')
    }
    else if (!isNonEmptyString(input.fillMethod.kind)) {
      pushIssue(errors, 'fillMethod.kind', 'missing_fill_method_kind', 'Metoda uzupełniania wymaga pola kind.')
    }
    else if (pdfFillMethodKinds.has(input.fillMethod.kind)) {
      effectivePdfFillMethod = input.fillMethod.kind as PdfFillMethodKind
      fillMethodRuntimeSupported = true
    }
    else if (deferredFillMethodKinds.has(input.fillMethod.kind)) {
      pushIssue(
        warnings,
        'fillMethod.kind',
        'fill_method_handler_unavailable',
        `Metoda ${input.fillMethod.kind} jest zarezerwowana, ale nie ma jeszcze aktywnego handlera.`,
        'warning',
      )
    }
    else {
      pushIssue(
        errors,
        'fillMethod.kind',
        'invalid_fill_method_kind',
        'Obsługiwane metody to pdf_acroform, pdf_overlay, pdf_hybrid, web_form i api.',
      )
    }
  }

  if (kind === 'document-template') {
    if (!isNonEmptyString(input.bank) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.bank)) {
      pushIssue(errors, 'bank', 'invalid_bank', 'Aktywny template musi wskazywać poprawny slug banku.')
    }
  }
  else if (input.bank !== null && input.bank !== undefined && !isNonEmptyString(input.bank)) {
    pushIssue(errors, 'bank', 'invalid_bank', 'Bank w drafcie musi być tekstem albo null.')
  }

  const source = isRecord(input.source) ? input.source : undefined
  let pageCount: number | undefined
  let sourceFormKind: PdfFormKind | undefined
  const sourcePages = new Map<number, Record<string, unknown>>()
  if (!source) {
    pushIssue(errors, 'source', 'missing_source', 'Template wymaga metadanych źródłowego PDF-u.')
  }
  else {
    if (!isNonEmptyString(source.fileName) || !source.fileName.toLocaleLowerCase('pl-PL').endsWith('.pdf')) {
      pushIssue(errors, 'source.fileName', 'invalid_pdf_filename', 'Nazwa źródła musi wskazywać plik PDF.')
    }
    if (!isNonEmptyString(source.sha256) || !/^[a-f\d]{64}$/i.test(source.sha256)) {
      pushIssue(errors, 'source.sha256', 'invalid_sha256', 'SHA-256 musi zawierać dokładnie 64 znaki szesnastkowe.')
    }
    if (!isPositiveInteger(source.pageCount)) {
      pushIssue(errors, 'source.pageCount', 'invalid_page_count', 'Liczba stron musi być dodatnią liczbą całkowitą.')
    }
    else pageCount = source.pageCount
    if (!['acroform', 'overlay', 'hybrid'].includes(String(source.formKind))) {
      pushIssue(errors, 'source.formKind', 'invalid_form_kind', 'formKind musi mieć wartość acroform, overlay albo hybrid.')
    }
    else sourceFormKind = source.formKind as PdfFormKind
    if (!Array.isArray(source.pages)) {
      pushIssue(errors, 'source.pages', 'missing_page_geometry', 'Schema V2 wymaga geometrii każdej strony PDF-u.')
    }
    else {
      if (pageCount && source.pages.length !== pageCount) {
        pushIssue(errors, 'source.pages', 'page_geometry_count_mismatch', 'Liczba rekordów geometrii musi odpowiadać pageCount.')
      }
      for (const [pageIndex, rawPage] of source.pages.entries()) {
        const pagePath = `source.pages[${pageIndex}]`
        if (!isRecord(rawPage)) {
          pushIssue(errors, pagePath, 'invalid_page_geometry', 'Geometria strony musi być obiektem.')
          continue
        }
        if (!isPositiveInteger(rawPage.page) || (pageCount && rawPage.page > pageCount)) {
          pushIssue(errors, `${pagePath}.page`, 'invalid_page_geometry_number', 'Geometria wskazuje nieprawidłowy numer strony.')
        }
        else if (sourcePages.has(rawPage.page)) {
          pushIssue(errors, `${pagePath}.page`, 'duplicate_page_geometry', 'Każda strona może mieć tylko jeden rekord geometrii.')
        }
        else sourcePages.set(rawPage.page, rawPage)
        validatePdfBox(rawPage.mediaBox, `${pagePath}.mediaBox`, errors)
        validatePdfBox(rawPage.cropBox, `${pagePath}.cropBox`, errors)
        if (![0, 90, 180, 270].includes(Number(rawPage.rotation))) {
          pushIssue(errors, `${pagePath}.rotation`, 'invalid_page_rotation', 'Rotation musi mieć wartość 0, 90, 180 albo 270.')
        }
        if (!isFiniteNumber(rawPage.userUnit) || rawPage.userUnit <= 0) {
          pushIssue(errors, `${pagePath}.userUnit`, 'invalid_page_user_unit', 'UserUnit musi być dodatnią liczbą.')
        }
      }
    }
  }

  if (input.fillMethod === undefined && sourceFormKind) {
    effectivePdfFillMethod = pdfFillMethodForFormKind(sourceFormKind)
    fillMethodRuntimeSupported = true
    pushIssue(
      warnings,
      'fillMethod',
      'legacy_fill_method',
      'Metodę uzupełniania wyprowadzono ze starszego source.formKind; przy następnym zapisie utrwal fillMethod.',
      'warning',
    )
  }
  else if (
    effectivePdfFillMethod
    && sourceFormKind
    && effectivePdfFillMethod !== pdfFillMethodForFormKind(sourceFormKind)
  ) {
    pushIssue(
      errors,
      'fillMethod.kind',
      'fill_method_source_mismatch',
      'Metoda uzupełniania PDF nie odpowiada source.formKind.',
    )
  }

  if (input.overlayOrigin !== undefined && !['top-left', 'bottom-left'].includes(String(input.overlayOrigin))) {
    pushIssue(errors, 'overlayOrigin', 'invalid_overlay_origin', 'overlayOrigin musi mieć wartość top-left albo bottom-left.')
  }

  let coverageComplete = false
  if (!coverage) {
    pushIssue(errors, 'coverage', 'missing_coverage', 'Template wymaga informacji o pokryciu pól.')
  }
  else if (kind === 'generated-draft') {
    if (!['auditRequired', 'complete', 'incomplete'].includes(String(coverage.status))) {
      pushIssue(errors, 'coverage.status', 'invalid_draft_coverage', 'Draft wymaga statusu auditRequired, incomplete albo complete.')
    }
    if (coverage.status === 'auditRequired') {
      pushIssue(warnings, 'coverage.status', 'audit_required', 'Draft AI wymaga ręcznego audytu przed aktywacją.', 'warning')
    }
  }
  else {
    if (!['complete', 'incomplete'].includes(String(coverage.status))) {
      pushIssue(errors, 'coverage.status', 'invalid_coverage_status', 'Status pokrycia musi mieć wartość complete albo incomplete.')
    }
    const coverageCounts = [
      ['inScopeTargetCount', coverage.inScopeTargetCount],
      ['mappedTargetCount', coverage.mappedTargetCount],
      ['manualUserActionCount', coverage.manualUserActionCount],
      ['excludedTargetCount', coverage.excludedTargetCount],
    ] as const
    for (const [name, value] of coverageCounts) {
      if (value !== undefined && !isNonNegativeInteger(value)) {
        pushIssue(errors, `coverage.${name}`, 'invalid_coverage_count', `${name} musi być nieujemną liczbą całkowitą.`)
      }
    }
    if (
      isNonNegativeInteger(coverage.inScopeTargetCount)
      && isNonNegativeInteger(coverage.mappedTargetCount)
      && coverage.mappedTargetCount > coverage.inScopeTargetCount
    ) {
      pushIssue(errors, 'coverage.mappedTargetCount', 'coverage_exceeds_scope', 'Liczba zmapowanych targetów nie może przekraczać liczby targetów w zakresie.')
    }
    coverageComplete = coverage.status === 'complete'
      && isNonNegativeInteger(coverage.inScopeTargetCount)
      && coverage.mappedTargetCount === coverage.inScopeTargetCount
    if (!coverageComplete) {
      pushIssue(warnings, 'coverage', 'incomplete_coverage', 'Pokrycie template’u nie jest kompletne.', 'warning')
    }
  }

  if (coverage?.notes !== undefined && !validateStringArray(coverage.notes, 'coverage.notes', errors)) {
    // The helper already recorded the issue.
  }

  const bindings = Array.isArray(input.bindings) ? input.bindings : undefined
  if (!bindings) pushIssue(errors, 'bindings', 'invalid_bindings', 'bindings musi być tablicą.')

  let mappedBindingCount = 0
  let readyBindingCount = 0
  let needsReviewCount = 0
  let unmappedCount = 0
  let auditableTargetCount = 0
  let acroFormTargetCount = 0
  let overlayTargetCount = 0
  const targetOwners = new Map<string, number>()
  const duplicateSignatures = new Set<string>()

  for (const [index, rawBinding] of (bindings ?? []).entries()) {
    const path = `bindings[${index}]`
    if (!isRecord(rawBinding)) {
      pushIssue(errors, path, 'invalid_binding', 'Binding musi być obiektem.')
      continue
    }
    if (!isNonEmptyString(rawBinding.canonicalKey)) {
      pushIssue(errors, `${path}.canonicalKey`, 'missing_canonical_key', 'Binding wymaga canonicalKey.')
    }
    else if (rawBinding.computed === true) {
      if (!computedContractsByKey.has(rawBinding.canonicalKey)) {
        pushIssue(errors, `${path}.canonicalKey`, 'unknown_computed_key', 'Klucz nie występuje w kontrolowanym katalogu pól obliczanych.')
      }
    }
    else if (!canonicalKeys.has(rawBinding.canonicalKey)) {
      pushIssue(errors, `${path}.canonicalKey`, 'unknown_canonical_key', 'Klucz nie występuje w aktualnym katalogu kanonicznym.')
    }

    if (rawBinding.computed !== undefined && typeof rawBinding.computed !== 'boolean') {
      pushIssue(errors, `${path}.computed`, 'invalid_computed_flag', 'computed musi być wartością logiczną.')
    }
    if (rawBinding.valueFrom !== undefined) {
      if (validateStringArray(rawBinding.valueFrom, `${path}.valueFrom`, errors)) {
        for (const [dependencyIndex, dependency] of rawBinding.valueFrom.entries()) {
          if (!canonicalKeys.has(dependency as string)) {
            pushIssue(errors, `${path}.valueFrom[${dependencyIndex}]`, 'unknown_dependency', 'Zależność nie występuje w katalogu kanonicznym.')
          }
        }
      }
    }
    if (rawBinding.valueFormat !== undefined && !valueFormats.has(String(rawBinding.valueFormat))) {
      pushIssue(errors, `${path}.valueFormat`, 'invalid_value_format', 'Binding używa nieobsługiwanego valueFormat.')
    }
    const computedContracts = isNonEmptyString(rawBinding.canonicalKey)
      ? computedContractsByKey.get(rawBinding.canonicalKey)
      : undefined
    if (rawBinding.computed === true && computedContracts) {
      const matchingDependencies = computedContracts.filter(contract => (
        Array.isArray(rawBinding.valueFrom)
        && rawBinding.valueFrom.length === contract.valueFrom.length
        && rawBinding.valueFrom.every((dependency, dependencyIndex) => (
          dependency === contract.valueFrom[dependencyIndex]
        ))
      ))
      if (matchingDependencies.length === 0) {
        pushIssue(
          errors,
          `${path}.valueFrom`,
          'computed_dependencies_mismatch',
          'Zależności pola obliczanego nie odpowiadają centralnemu kontraktowi semantycznemu.',
        )
      }
      else if (!matchingDependencies.some(contract => (
        rawBinding.valueFormat === contract.valueFormat
      ))) {
        pushIssue(
          errors,
          `${path}.valueFormat`,
          'computed_format_mismatch',
          'Format pola obliczanego nie odpowiada centralnemu kontraktowi semantycznemu.',
        )
      }
    }
    if (rawBinding.condition !== undefined) {
      validateCondition(rawBinding.condition, `${path}.condition`, errors, warnings)
    }
    if (rawBinding.reviewStatus !== undefined && !['ready', 'needsReview'].includes(String(rawBinding.reviewStatus))) {
      pushIssue(errors, `${path}.reviewStatus`, 'invalid_review_status', 'reviewStatus musi mieć wartość ready albo needsReview.')
    }
    if (rawBinding.semanticContract !== undefined) {
      validateBindingSemanticContract(
        rawBinding.semanticContract,
        `${path}.semanticContract`,
        errors,
        warnings,
      )
    }
    if (rawBinding.mappingEvidence !== undefined) {
      validateMappingEvidence(
        rawBinding.mappingEvidence,
        `${path}.mappingEvidence`,
        pageCount,
        errors,
        warnings,
      )
    }
    if (rawBinding.notes !== undefined && typeof rawBinding.notes !== 'string') {
      pushIssue(errors, `${path}.notes`, 'invalid_notes', 'Notatka bindingu musi być tekstem.')
    }

    const target = validateTarget(
      rawBinding.target,
      `${path}.target`,
      pageCount,
      sourcePages,
      input.schemaVersion,
      errors,
    )
    if (target.kind === 'unmapped') unmappedCount += 1
    if (target.kind === 'acroform' || target.kind === 'overlay') mappedBindingCount += 1
    if (target.kind === 'acroform') acroFormTargetCount += 1
    if (target.kind === 'overlay') overlayTargetCount += 1
    if (target.auditable === true) auditableTargetCount += 1
    if (rawBinding.reviewStatus === 'needsReview') needsReviewCount += 1
    if (
      (target.kind === 'acroform' || target.kind === 'overlay')
      && rawBinding.reviewStatus !== 'needsReview'
    ) readyBindingCount += 1

    if (target.signature) {
      const previousOwner = targetOwners.get(target.signature)
      if (previousOwner !== undefined && !duplicateSignatures.has(target.signature)) {
        duplicateSignatures.add(target.signature)
        pushIssue(warnings, `${path}.target`, 'duplicate_target', `Target jest również używany przez bindings[${previousOwner}].`, 'warning')
      }
      else targetOwners.set(target.signature, index)
    }
  }

  if (needsReviewCount > 0) {
    pushIssue(warnings, 'bindings', 'review_required', `${needsReviewCount} mapowań wymaga ręcznego zatwierdzenia.`, 'warning')
  }
  if (unmappedCount > 0) {
    pushIssue(warnings, 'bindings', 'unmapped_targets', `${unmappedCount} mapowań nie ma aktywnego targetu PDF.`, 'warning')
  }
  if (auditableTargetCount < mappedBindingCount) {
    pushIssue(
      warnings,
      'bindings',
      'render_geometry_not_auditable',
      `${mappedBindingCount - auditableTargetCount} targetów nie ma pełnej geometrii V2 lub snapshotu widgetu.`,
      'warning',
    )
  }

  const fillMethodTargetIssues = input.fillMethod === undefined ? warnings : errors
  const fillMethodTargetSeverity = input.fillMethod === undefined ? 'warning' as const : 'error' as const
  let fillMethodTargetsCompatible = true

  if (effectivePdfFillMethod === 'pdf_acroform' && overlayTargetCount > 0) {
    fillMethodTargetsCompatible = false
    pushIssue(
      fillMethodTargetIssues,
      input.fillMethod === undefined ? 'source.formKind' : 'fillMethod.kind',
      'fill_method_target_mismatch',
      'Metoda pdf_acroform nie może zawierać targetów overlay.',
      fillMethodTargetSeverity,
    )
  }
  else if (effectivePdfFillMethod === 'pdf_overlay' && acroFormTargetCount > 0) {
    fillMethodTargetsCompatible = false
    pushIssue(
      fillMethodTargetIssues,
      input.fillMethod === undefined ? 'source.formKind' : 'fillMethod.kind',
      'fill_method_target_mismatch',
      'Metoda pdf_overlay nie może zawierać targetów AcroForm.',
      fillMethodTargetSeverity,
    )
  }
  else if (
    effectivePdfFillMethod === 'pdf_hybrid'
    && (acroFormTargetCount === 0 || overlayTargetCount === 0)
  ) {
    fillMethodTargetsCompatible = false
    pushIssue(
      fillMethodTargetIssues,
      input.fillMethod === undefined ? 'source.formKind' : 'fillMethod.kind',
      'fill_method_target_mismatch',
      'Metoda pdf_hybrid wymaga co najmniej jednego targetu AcroForm i jednego targetu overlay.',
      fillMethodTargetSeverity,
    )
  }

  const valid = errors.length === 0
  const activationReady = kind === 'document-template'
    && valid
    && fillMethodRuntimeSupported
    && fillMethodTargetsCompatible
    && coverageComplete
    && needsReviewCount === 0
    && unmappedCount === 0
    && auditableTargetCount === mappedBindingCount
  const summary: TemplateValidationSummary = {
    bindingCount: bindings?.length ?? 0,
    mappedBindingCount,
    readyBindingCount,
    needsReviewCount,
    unmappedCount,
    activationReady,
  }

  return {
    kind,
    valid,
    fillReady: activationReady,
    errors,
    warnings,
    summary,
  }
}
