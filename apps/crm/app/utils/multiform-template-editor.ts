import {
  CANONICAL_COMPUTED_BINDINGS,
  CANONICAL_FIELDS,
  resolveTemplateFillMethod,
  type CanonicalComputedBindingDefinition,
  type CanonicalFieldDefinition,
  type CanonicalFieldType,
  type DocumentTemplate,
  type PdfAppearance,
  type PdfBox,
  type PdfCoordinateSpace,
  type PdfMarkAppearance,
  type PdfTextAppearance,
  type TemplateBinding,
  type TemplateBindingSemanticContract,
} from '@openexpert/multiform'

import { visualCropBoxToTargetBox } from './multiform-visual-geometry.ts'

export type OverlayPlacementKind = 'text' | 'checkbox' | 'radio'

export interface AddOverlayBindingInput {
  canonicalKey: string
  page: number
  visualBox: PdfBox
  placementKind: OverlayPlacementKind
  conditionEquals?: string
}

export interface AddOverlayBindingResult {
  template: DocumentTemplate
  bindingIndex: number
}

export interface ViewportPointInput {
  clientX: number
  clientY: number
  viewportLeft: number
  viewportTop: number
  scaleX: number
  scaleY: number
}

export type VisualAlignmentAxis = 'x' | 'y'
export type VisualAlignmentAnchor = 'start' | 'center' | 'end'

export interface VisualAlignmentGuide {
  axis: VisualAlignmentAxis
  position: number
}

export interface SnapVisualBoxInput {
  box: PdfBox
  referenceBoxes: readonly PdfBox[]
  thresholdX: number
  thresholdY: number
}

export interface SnapVisualBoxResult {
  box: PdfBox
  guides: VisualAlignmentGuide[]
}

function normalizeSemanticHintList(values: readonly string[]) {
  const nonEmpty = values.map(value => value.trim()).filter(Boolean)
  if (nonEmpty.length > 30) {
    throw new Error('Jedna lista wskazówek może zawierać maksymalnie 30 pozycji.')
  }
  if (nonEmpty.some(value => value.length > 160)) {
    throw new Error('Pojedyncza wskazówka może mieć maksymalnie 160 znaków.')
  }
  const normalized = new Map<string, string>()
  for (const trimmed of nonEmpty) {
    const key = trimmed.toLocaleLowerCase('pl-PL')
    if (!normalized.has(key)) normalized.set(key, trimmed)
  }
  return [...normalized.values()]
}

export function normalizeTemplateBindingSemanticContract(
  contract: TemplateBindingSemanticContract,
): TemplateBindingSemanticContract {
  const semanticDescription = contract.semanticDescription.trim()
  const semanticRole = contract.semanticRole.trim()
  const rationale = contract.rationale?.trim()
  const model = contract.model?.trim()
  if (!semanticDescription) throw new Error('Opis semantyczny nie może być pusty.')
  if (!semanticRole) throw new Error('Rola semantyczna nie może być pusta.')
  if (semanticDescription.length > 2_000) {
    throw new Error('Opis semantyczny może mieć maksymalnie 2000 znaków.')
  }
  if (
    semanticRole.length > 160
    || !/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u.test(semanticRole)
  ) {
    throw new Error('Rola semantyczna musi być identyfikatorem w notacji kropkowej do 160 znaków.')
  }
  if (contract.source !== 'manual' && contract.source !== 'ai') {
    throw new Error('Źródło kontraktu semantycznego musi mieć wartość manual albo ai.')
  }
  if (rationale && rationale.length > 1_000) {
    throw new Error('Uzasadnienie kontraktu może mieć maksymalnie 1000 znaków.')
  }
  if (model && model.length > 160) {
    throw new Error('Identyfikator modelu może mieć maksymalnie 160 znaków.')
  }

  const aliases = normalizeSemanticHintList(contract.aiMappingHints.aliases)
  const exclude = normalizeSemanticHintList(contract.aiMappingHints.exclude)
  const aliasKeys = new Set(aliases.map(value => value.toLocaleLowerCase('pl-PL')))
  if (exclude.some(value => aliasKeys.has(value.toLocaleLowerCase('pl-PL')))) {
    throw new Error('Ta sama wskazówka nie może jednocześnie występować w aliasach i wykluczeniach.')
  }

  return {
    semanticDescription,
    semanticRole,
    aiMappingHints: {
      aliases,
      exclude,
    },
    source: contract.source,
    ...(rationale ? { rationale } : {}),
    ...(model ? { model } : {}),
  }
}

type CanonicalBindingDefinition =
  | CanonicalFieldDefinition
  | CanonicalComputedBindingDefinition

const CANONICAL_DEFINITIONS: readonly CanonicalBindingDefinition[] = [
  ...CANONICAL_FIELDS,
  ...CANONICAL_COMPUTED_BINDINGS,
]

const OVERLAY_COORDINATE_SPACE: PdfCoordinateSpace = {
  units: 'pt',
  referenceBox: 'crop',
  origin: 'top-left',
  orientation: 'visual',
}

const BLACK = { space: 'rgb', red: 0, green: 0, blue: 0 } as const

function roundBox(box: PdfBox): PdfBox {
  return {
    x: Number(box.x.toFixed(2)),
    y: Number(box.y.toFixed(2)),
    width: Number(box.width.toFixed(2)),
    height: Number(box.height.toFixed(2)),
  }
}

function textAppearance(fieldType: CanonicalFieldType): PdfTextAppearance {
  const multiline = fieldType === 'textarea'
  return {
    kind: 'text',
    fontId: 'dm-sans-regular',
    fontSizePt: 9,
    minFontSizePt: 6,
    letterSpacingPt: 0,
    lineHeightPt: 10.8,
    wrap: multiline ? 'word' : 'none',
    overflow: 'shrink',
    horizontalAlign: 'left',
    verticalAlign: multiline ? 'top' : 'middle',
    distribution: { kind: 'flow' },
    color: BLACK,
    opacity: 1,
    paddingPt: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
  }
}

function markAppearance(role: 'checkbox' | 'radio'): PdfMarkAppearance {
  return {
    kind: 'mark',
    role,
    glyph: role === 'radio' ? 'dot' : 'x',
    color: BLACK,
    opacity: 1,
    insetPt: 3.4,
    strokeWidthPt: 1.15,
  }
}

function canonicalDefinition(canonicalKey: string) {
  const definition = CANONICAL_DEFINITIONS.find(field => field.canonicalKey === canonicalKey)
  if (!definition) {
    throw new Error(`Nieznany canonicalKey: ${canonicalKey}.`)
  }
  return definition
}

function validateMarkerCondition(
  definition: CanonicalBindingDefinition,
  conditionEquals: string | undefined,
) {
  if ('computed' in definition) {
    throw new Error(`Pole obliczane ${definition.canonicalKey} może być mapowane wyłącznie jako tekst.`)
  }
  if (definition.type === 'select') {
    if (!conditionEquals) {
      throw new Error(`Marker dla ${definition.canonicalKey} wymaga wybrania konkretnej opcji.`)
    }
    if (!definition.options?.some(option => option.value === conditionEquals)) {
      throw new Error(`Wartość ${conditionEquals} nie jest opcją pola ${definition.canonicalKey}.`)
    }
    return
  }
  if (definition.type !== 'boolean') {
    throw new Error(`Pole ${definition.canonicalKey} nie może być bezpośrednio użyte jako marker.`)
  }
}

function createAppearance(
  definition: CanonicalBindingDefinition,
  placementKind: OverlayPlacementKind,
): PdfAppearance {
  return placementKind === 'text'
    ? textAppearance(definition.type)
    : markAppearance(placementKind)
}

function targetSignature(binding: TemplateBinding) {
  const target = binding.target
  if (target.kind === 'acroform') return `acroform:${target.field}`
  if (target.kind === 'overlay' && target.rendererVersion === 2) {
    return [
      'overlay:v2',
      target.page,
      target.box.x,
      target.box.y,
      target.box.width,
      target.box.height,
    ].join(':')
  }
  if (target.kind === 'overlay') {
    return `overlay:${target.page}:${target.x}:${target.y}`
  }
  return ''
}

function applyComputedCoverage(template: DocumentTemplate) {
  const wasAuditedComplete = template.coverage.status === 'complete'
  const readyTargets = new Set<string>()
  for (const binding of template.bindings) {
    if (binding.reviewStatus === 'needsReview') continue
    const signature = targetSignature(binding)
    if (signature) readyTargets.add(signature)
  }

  template.coverage.mappedTargetCount = readyTargets.size
  // Geometry proves that a reviewed binding exists, not that every audited
  // source target was identified. The visual editor may invalidate an
  // existing complete audit, but it must never certify a new one by itself.
  template.coverage.status = wasAuditedComplete
    && readyTargets.size === template.coverage.inScopeTargetCount
    ? 'complete'
    : 'incomplete'
}

function applyComputedFormKind(template: DocumentTemplate) {
  const hasAcroForm = template.bindings.some(binding => binding.target.kind === 'acroform')
  const hasOverlay = template.bindings.some(binding => binding.target.kind === 'overlay')
  if (hasAcroForm && hasOverlay) template.source.formKind = 'hybrid'
  else if (hasAcroForm) template.source.formKind = 'acroform'
  else if (hasOverlay) template.source.formKind = 'overlay'
  else return
  template.fillMethod = resolveTemplateFillMethod({
    source: { formKind: template.source.formKind },
  })
}

export function recomputeTemplateCoverage(template: DocumentTemplate): DocumentTemplate {
  const next = structuredClone(template)
  applyComputedCoverage(next)
  return next
}

export function viewportPointToVisualPoint(input: ViewportPointInput) {
  if (
    ![input.clientX, input.clientY, input.viewportLeft, input.viewportTop].every(Number.isFinite)
    || !Number.isFinite(input.scaleX)
    || !Number.isFinite(input.scaleY)
    || input.scaleX <= 0
    || input.scaleY <= 0
  ) {
    throw new Error('Nieprawidłowa geometria obszaru upuszczania PDF.')
  }
  return {
    x: (input.clientX - input.viewportLeft) / input.scaleX,
    y: (input.clientY - input.viewportTop) / input.scaleY,
  }
}

type AxisAnchor = {
  anchor: VisualAlignmentAnchor
  position: number
  order: number
}

type AxisSnapCandidate = {
  delta: number
  position: number
  movingAnchor: VisualAlignmentAnchor
  referenceAnchor: VisualAlignmentAnchor
  movingOrder: number
  referenceOrder: number
}

const ALIGNMENT_EPSILON = 0.000001
const ALIGNMENT_ANCHOR_ORDER: Record<VisualAlignmentAnchor, number> = {
  center: 0,
  start: 1,
  end: 2,
}

function axisAnchors(box: PdfBox, axis: VisualAlignmentAxis): AxisAnchor[] {
  const start = axis === 'x' ? box.x : box.y
  const size = axis === 'x' ? box.width : box.height
  return [
    { anchor: 'start', position: start, order: ALIGNMENT_ANCHOR_ORDER.start },
    { anchor: 'center', position: start + size / 2, order: ALIGNMENT_ANCHOR_ORDER.center },
    { anchor: 'end', position: start + size, order: ALIGNMENT_ANCHOR_ORDER.end },
  ]
}

function validBox(box: PdfBox) {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.width > 0
    && box.height > 0
}

function closestAxisSnap(
  box: PdfBox,
  referenceBoxes: readonly PdfBox[],
  axis: VisualAlignmentAxis,
  threshold: number,
): AxisSnapCandidate | null {
  if (!Number.isFinite(threshold) || threshold < 0) return null

  const movingAnchors = axisAnchors(box, axis)
  const candidates: AxisSnapCandidate[] = []
  referenceBoxes.forEach((referenceBox) => {
    if (!validBox(referenceBox)) return
    const referenceAnchors = axisAnchors(referenceBox, axis)
    for (const moving of movingAnchors) {
      for (const reference of referenceAnchors) {
        const delta = reference.position - moving.position
        if (Math.abs(delta) > threshold + ALIGNMENT_EPSILON) continue
        candidates.push({
          delta,
          position: reference.position,
          movingAnchor: moving.anchor,
          referenceAnchor: reference.anchor,
          movingOrder: moving.order,
          referenceOrder: reference.order,
        })
      }
    }
  })

  candidates.sort((left, right) => {
    const distance = Math.abs(left.delta) - Math.abs(right.delta)
    if (Math.abs(distance) > ALIGNMENT_EPSILON) return distance

    const leftMatchingAnchor = left.movingAnchor === left.referenceAnchor ? 0 : 1
    const rightMatchingAnchor = right.movingAnchor === right.referenceAnchor ? 0 : 1
    if (leftMatchingAnchor !== rightMatchingAnchor) {
      return leftMatchingAnchor - rightMatchingAnchor
    }
    if (left.movingOrder !== right.movingOrder) {
      return left.movingOrder - right.movingOrder
    }
    if (left.referenceOrder !== right.referenceOrder) {
      return left.referenceOrder - right.referenceOrder
    }
    return left.position - right.position
  })

  return candidates[0] ?? null
}

export function snapVisualBoxToReferenceBoxes(
  input: SnapVisualBoxInput,
): SnapVisualBoxResult {
  if (!validBox(input.box)) {
    throw new Error('Nieprawidłowa geometria pola do wyrównania.')
  }

  const next = { ...input.box }
  const guides: VisualAlignmentGuide[] = []
  const xSnap = closestAxisSnap(
    next,
    input.referenceBoxes,
    'x',
    input.thresholdX,
  )
  if (xSnap) {
    next.x += xSnap.delta
    guides.push({ axis: 'x', position: xSnap.position })
  }

  const ySnap = closestAxisSnap(
    next,
    input.referenceBoxes,
    'y',
    input.thresholdY,
  )
  if (ySnap) {
    next.y += ySnap.delta
    guides.push({ axis: 'y', position: ySnap.position })
  }

  return { box: next, guides }
}

export function addOverlayBinding(
  template: DocumentTemplate,
  input: AddOverlayBindingInput,
): AddOverlayBindingResult {
  const page = template.source.pages.find(item => item.page === input.page)
  if (!page) {
    throw new Error(`Template nie zawiera geometrii strony ${input.page}.`)
  }

  const definition = canonicalDefinition(input.canonicalKey)
  if (
    input.placementKind === 'text'
    && (definition.type === 'select' || definition.type === 'boolean')
  ) {
    throw new Error(`Pole ${definition.canonicalKey} wymaga mapowania jako marker opcji, nie surowy tekst.`)
  }
  if (input.placementKind !== 'text') {
    validateMarkerCondition(definition, input.conditionEquals)
  }

  const targetBox = visualCropBoxToTargetBox(
    page,
    input.visualBox,
    OVERLAY_COORDINATE_SPACE,
  )
  const binding: TemplateBinding = {
    canonicalKey: definition.canonicalKey,
    ...('computed' in definition
      ? {
          computed: true,
          valueFrom: definition.valueFrom,
          valueFormat: definition.valueFormat,
        }
      : {}),
    reviewStatus: 'needsReview',
    mappingEvidence: {
      origin: 'manual',
      rationale: 'Pole dodane ręcznie przez administratora w edytorze wizualnym.',
    },
    target: {
      kind: 'overlay',
      rendererVersion: 2,
      page: page.page,
      box: roundBox(targetBox),
      coordinateSpace: OVERLAY_COORDINATE_SPACE,
      appearance: createAppearance(definition, input.placementKind),
    },
  }
  if (input.conditionEquals) {
    binding.condition = {
      canonicalKey: definition.canonicalKey,
      equals: input.conditionEquals,
    }
  }

  const next = structuredClone(template)
  const bindingIndex = next.bindings.length
  next.bindings = [...next.bindings, binding]
  applyComputedFormKind(next)
  applyComputedCoverage(next)

  return { template: next, bindingIndex }
}

export function setTemplateBindingReviewStatus(
  template: DocumentTemplate,
  bindingIndex: number,
  reviewStatus: NonNullable<TemplateBinding['reviewStatus']>,
): DocumentTemplate {
  const next = structuredClone(template)
  const binding = next.bindings[bindingIndex]
  if (!binding) throw new Error(`Nie znaleziono bindingu ${bindingIndex}.`)
  binding.reviewStatus = reviewStatus
  applyComputedCoverage(next)
  return next
}

export function setTemplateBindingSemanticContract(
  template: DocumentTemplate,
  bindingIndex: number,
  contract: TemplateBindingSemanticContract,
): DocumentTemplate {
  const next = structuredClone(template)
  const binding = next.bindings[bindingIndex]
  if (!binding) throw new Error(`Nie znaleziono bindingu ${bindingIndex}.`)
  binding.semanticContract = normalizeTemplateBindingSemanticContract(contract)
  binding.reviewStatus = 'needsReview'
  applyComputedCoverage(next)
  return next
}

export function resetTemplateBindingSemanticContract(
  template: DocumentTemplate,
  bindingIndex: number,
): DocumentTemplate {
  const next = structuredClone(template)
  const binding = next.bindings[bindingIndex]
  if (!binding) throw new Error(`Nie znaleziono bindingu ${bindingIndex}.`)
  delete binding.semanticContract
  binding.reviewStatus = 'needsReview'
  applyComputedCoverage(next)
  return next
}

export function removeTemplateBinding(
  template: DocumentTemplate,
  bindingIndex: number,
): DocumentTemplate {
  if (!template.bindings[bindingIndex]) {
    throw new Error(`Nie znaleziono bindingu ${bindingIndex}.`)
  }
  const next = structuredClone(template)
  next.bindings = next.bindings.filter((_, index) => index !== bindingIndex)
  applyComputedFormKind(next)
  applyComputedCoverage(next)
  return next
}
