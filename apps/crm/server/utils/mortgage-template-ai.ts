import {
  resolveTemplateFillMethod,
  type DocumentTemplate,
  type PdfBox,
  type TemplateBinding,
} from '@openexpert/multiform'

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return value === undefined ? '"__undefined__"' : JSON.stringify(value) ?? '"__undefined__"'
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(',')}}`
}

function targetSignature(binding: TemplateBinding) {
  const target = binding.target
  if (target.kind === 'acroform') return `acroform:${target.field}`
  if (target.kind === 'overlay' && target.rendererVersion === 2) {
    return [
      'overlay:v2',
      target.page,
      target.coordinateSpace.units,
      target.coordinateSpace.referenceBox,
      target.coordinateSpace.origin,
      target.coordinateSpace.orientation,
      target.box.x,
      target.box.y,
      target.box.width,
      target.box.height,
    ].join(':')
  }
  if (target.kind === 'overlay') {
    return `overlay:v1:${target.page}:${target.x}:${target.y}:${target.width ?? ''}:${target.height ?? ''}`
  }
  return null
}

function conditionSignature(binding: TemplateBinding) {
  if (!binding.condition) return ''
  const equals = Array.isArray(binding.condition.equals)
    ? [...binding.condition.equals].sort()
    : binding.condition.equals
  return stableSerialize({
    canonicalKey: binding.condition.canonicalKey,
    equals,
  })
}

interface ComparableOverlayPlacement {
  page: number
  coordinateSpace: string
  box: PdfBox
}

function comparableOverlayPlacement(binding: TemplateBinding): ComparableOverlayPlacement | null {
  const target = binding.target
  if (target.kind !== 'overlay') return null
  if (target.rendererVersion === 2) {
    return {
      page: target.page,
      coordinateSpace: stableSerialize(target.coordinateSpace),
      box: target.box,
    }
  }
  if (
    typeof target.width !== 'number'
    || typeof target.height !== 'number'
    || !Number.isFinite(target.width)
    || !Number.isFinite(target.height)
    || target.width <= 0
    || target.height <= 0
  ) {
    return null
  }
  return {
    page: target.page,
    coordinateSpace: 'legacy',
    box: {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    },
  }
}

function overlapRatios(left: PdfBox, right: PdfBox) {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  )
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  )
  const intersection = intersectionWidth * intersectionHeight
  if (intersection <= 0) return { intersectionOverUnion: 0, intersectionOverSmaller: 0 }

  const leftArea = left.width * left.height
  const rightArea = right.width * right.height
  const union = leftArea + rightArea - intersection
  return {
    intersectionOverUnion: union > 0 ? intersection / union : 0,
    intersectionOverSmaller: Math.min(leftArea, rightArea) > 0
      ? intersection / Math.min(leftArea, rightArea)
      : 0,
  }
}

function overlayPlacementsConflict(left: TemplateBinding, right: TemplateBinding) {
  const leftPlacement = comparableOverlayPlacement(left)
  const rightPlacement = comparableOverlayPlacement(right)
  if (
    !leftPlacement
    || !rightPlacement
    || leftPlacement.page !== rightPlacement.page
    || leftPlacement.coordinateSpace !== rightPlacement.coordinateSpace
  ) {
    return false
  }

  const overlap = overlapRatios(leftPlacement.box, rightPlacement.box)
  // A nearly identical rectangle is the same physical target even if AI gave
  // it a different semantic key. For the same semantic field we also collapse
  // looser, partially shifted proposals, while keeping distant repetitions.
  if (overlap.intersectionOverUnion >= 0.8) return true
  return left.canonicalKey === right.canonicalKey
    && conditionSignature(left) === conditionSignature(right)
    && (
      overlap.intersectionOverUnion >= 0.5
      || overlap.intersectionOverSmaller >= 0.8
    )
}

function sourceFormKindWithAdditions(
  current: DocumentTemplate['source']['formKind'],
  additions: readonly TemplateBinding[],
): DocumentTemplate['source']['formKind'] {
  const hasAcroForm = current === 'acroform'
    || current === 'hybrid'
    || additions.some(binding => binding.target.kind === 'acroform')
  const hasOverlay = current === 'overlay'
    || current === 'hybrid'
    || additions.some(binding => binding.target.kind === 'overlay')
  if (hasAcroForm && hasOverlay) return 'hybrid'
  return hasAcroForm ? 'acroform' : 'overlay'
}

function normalizeAiSuggestion(rawSuggestion: TemplateBinding): TemplateBinding {
  const evidence = rawSuggestion.mappingEvidence
  return {
    ...structuredClone(rawSuggestion),
    reviewStatus: 'needsReview',
    mappingEvidence: {
      origin: 'ai',
      ...(evidence?.confidence !== undefined ? { confidence: evidence.confidence } : {}),
      rationale: evidence?.rationale || 'Mapowanie zaproponowane przez Agenta AI.',
      ...(evidence?.anchors !== undefined ? { anchors: structuredClone(evidence.anchors) } : {}),
      ...(evidence?.model !== undefined ? { model: evidence.model } : {}),
    },
  }
}

function acroOptionSiblingKey(binding: TemplateBinding) {
  const target = binding.target
  const condition = binding.condition
  if (
    target.kind !== 'acroform'
    || !target.valueMap
    || !condition
    || condition.canonicalKey !== binding.canonicalKey
    || typeof condition.equals !== 'string'
    || !Object.prototype.hasOwnProperty.call(target.valueMap, condition.equals)
  ) {
    return null
  }

  const targetWithoutValueMap = { ...target } as Record<string, unknown>
  delete targetWithoutValueMap.valueMap
  return stableSerialize({
    canonicalKey: binding.canonicalKey,
    computed: binding.computed,
    valueFrom: binding.valueFrom,
    valueFormat: binding.valueFormat,
    target: targetWithoutValueMap,
  })
}

function suggestionRank(left: TemplateBinding, right: TemplateBinding) {
  const confidenceDifference = (right.mappingEvidence?.confidence ?? -1)
    - (left.mappingEvidence?.confidence ?? -1)
  if (confidenceDifference !== 0) return confidenceDifference
  return stableSerialize(left).localeCompare(stableSerialize(right))
}

function mergeAcroOptionSiblings(siblings: readonly TemplateBinding[]): TemplateBinding {
  if (siblings.length === 1) return siblings[0]!

  const ranked = [...siblings].sort(suggestionRank)
  const representative = ranked[0]!
  if (representative.target.kind !== 'acroform') return representative

  const valueMap = new Map<string, string>()
  const conflictingCanonicalValues = new Set<string>()
  for (const sibling of ranked) {
    if (sibling.target.kind !== 'acroform') continue
    for (const [canonicalValue, sourceValue] of Object.entries(sibling.target.valueMap ?? {}).sort(([left], [right]) => (
      left.localeCompare(right)
    ))) {
      const previous = valueMap.get(canonicalValue)
      if (previous === undefined) valueMap.set(canonicalValue, sourceValue)
      else if (previous !== sourceValue) conflictingCanonicalValues.add(canonicalValue)
    }
  }

  const anchors = new Map<string, NonNullable<NonNullable<TemplateBinding['mappingEvidence']>['anchors']>[number]>()
  for (const sibling of ranked) {
    for (const anchor of sibling.mappingEvidence?.anchors ?? []) {
      if (!anchors.has(anchor.reference)) anchors.set(anchor.reference, structuredClone(anchor))
    }
  }

  const representativeEvidence = representative.mappingEvidence
  const bindingWithoutCondition = structuredClone(representative)
  delete bindingWithoutCondition.condition
  const mergedNotes = [
    representative.notes,
    `Scalono ${siblings.length} wariantów jednego pola AcroForm w deterministyczny valueMap.`,
    ...(conflictingCanonicalValues.size > 0
      ? [`Sprzeczne wartości PDF dla opcji ${[...conflictingCanonicalValues].sort().join(', ')} wymagają sprawdzenia; zachowano propozycję o najwyższym confidence.`]
      : []),
  ].filter((value): value is string => Boolean(value))

  return {
    ...bindingWithoutCondition,
    target: {
      ...representative.target,
      valueMap: Object.fromEntries([...valueMap.entries()].sort(([left], [right]) => left.localeCompare(right))),
    },
    mappingEvidence: {
      origin: 'ai',
      ...(representativeEvidence?.confidence !== undefined
        ? { confidence: representativeEvidence.confidence }
        : {}),
      rationale: representativeEvidence?.rationale || 'Mapowanie zaproponowane przez Agenta AI.',
      ...(anchors.size > 0 ? { anchors: [...anchors.values()].slice(0, 12) } : {}),
      ...(representativeEvidence?.model ? { model: representativeEvidence.model } : {}),
    },
    notes: mergedNotes.join(' '),
  }
}

function mergeOptionSiblingSuggestions(suggestions: readonly TemplateBinding[]) {
  const result: TemplateBinding[] = []
  const groupIndexes = new Map<string, number>()
  const groups = new Map<string, TemplateBinding[]>()

  for (const suggestion of suggestions) {
    const key = acroOptionSiblingKey(suggestion)
    if (!key) {
      result.push(suggestion)
      continue
    }

    const existingIndex = groupIndexes.get(key)
    if (existingIndex === undefined) {
      groupIndexes.set(key, result.length)
      groups.set(key, [suggestion])
      result.push(suggestion)
      continue
    }

    groups.get(key)!.push(suggestion)
    result[existingIndex] = mergeAcroOptionSiblings(groups.get(key)!)
  }

  return result
}

export interface MergeAiMappingSuggestionsResult {
  template: DocumentTemplate
  addedCount: number
  skippedTargetCount: number
  skippedUnmappedCount: number
}

/**
 * Adds machine suggestions without replacing administrator-authored bindings.
 * Reviewed coverage is intentionally unchanged: every generated binding must
 * still be accepted by a human before it contributes to mappedTargetCount.
 */
export function mergeAiMappingSuggestions(
  current: DocumentTemplate,
  suggestions: readonly TemplateBinding[],
): MergeAiMappingSuggestionsResult {
  const existingTargetSignatures = new Set(
    current.bindings
      .map(targetSignature)
      .filter((signature): signature is string => Boolean(signature)),
  )
  const acceptedBindings = [...current.bindings]
  const added: TemplateBinding[] = []
  let skippedTargetCount = 0
  let skippedUnmappedCount = 0
  const normalizedSuggestions: TemplateBinding[] = []

  for (const rawSuggestion of suggestions) {
    if (rawSuggestion.target.kind === 'unmapped') {
      skippedUnmappedCount += 1
      continue
    }
    normalizedSuggestions.push(normalizeAiSuggestion(rawSuggestion))
  }

  for (const suggestion of mergeOptionSiblingSuggestions(normalizedSuggestions)) {
    const signature = targetSignature(suggestion)
    if (
      !signature
      || existingTargetSignatures.has(signature)
      || (
        suggestion.target.kind === 'overlay'
        && acceptedBindings.some(binding => overlayPlacementsConflict(binding, suggestion))
      )
    ) {
      skippedTargetCount += 1
      continue
    }
    existingTargetSignatures.add(signature)
    acceptedBindings.push(suggestion)
    added.push(suggestion)
  }

  const bindings = [...current.bindings, ...added]
  const formKind = sourceFormKindWithAdditions(current.source.formKind, added)
  return {
    template: {
      ...structuredClone(current),
      ...(added.length
        ? { fillMethod: resolveTemplateFillMethod({ source: { formKind } }) }
        : {}),
      source: {
        ...structuredClone(current.source),
        formKind,
      },
      bindings,
      coverage: {
        ...structuredClone(current.coverage),
        // AI proposals do not certify coverage.
        mappedTargetCount: current.coverage.mappedTargetCount,
      },
    },
    addedCount: added.length,
    skippedTargetCount,
    skippedUnmappedCount,
  }
}
