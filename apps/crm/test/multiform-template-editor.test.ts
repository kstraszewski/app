import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ERSTE_TEMPLATE,
  PEKAO_TEMPLATE,
  type DocumentTemplate,
  validateTemplateJson,
} from '@openexpert/multiform'

import {
  addOverlayBinding,
  normalizeTemplateBindingSemanticContract,
  removeTemplateBinding,
  resetTemplateBindingSemanticContract,
  setTemplateBindingReviewStatus,
  setTemplateBindingSemanticContract,
  snapVisualBoxToReferenceBoxes,
  viewportPointToVisualPoint,
} from '../app/utils/multiform-template-editor.ts'

function template(
  overrides: Partial<DocumentTemplate['source']> = {},
): DocumentTemplate {
  return {
    schemaVersion: 2,
    id: 'manual-overlay-test',
    bank: 'erste',
    label: 'Test ręcznego mapowania',
    version: 1,
    source: {
      fileName: 'source.pdf',
      sha256: 'a'.repeat(64),
      pageCount: 1,
      formKind: 'overlay',
      pages: [{
        page: 1,
        mediaBox: { x: -10, y: -20, width: 300, height: 220 },
        cropBox: { x: 20, y: 10, width: 200, height: 120 },
        rotation: 90,
        userUnit: 2,
      }],
      ...overrides,
    },
    coverage: {
      status: 'incomplete',
      inScopeTargetCount: 1,
      mappedTargetCount: 0,
    },
    bindings: [],
  }
}

test('adds an immutable V2 text overlay at visual CropBox coordinates', () => {
  const source = template()
  const result = addOverlayBinding(source, {
    canonicalKey: 'property.landRegisterNumber',
    page: 1,
    visualBox: { x: 24, y: 38, width: 120, height: 17 },
    placementKind: 'text',
  })

  assert.equal(source.bindings.length, 0)
  assert.equal(source.coverage.mappedTargetCount, 0)
  assert.equal(result.bindingIndex, 0)
  assert.equal(result.template.bindings.length, 1)

  const binding = result.template.bindings[0]
  assert.equal(binding?.canonicalKey, 'property.landRegisterNumber')
  assert.equal(binding?.reviewStatus, 'needsReview')
  assert.deepEqual(binding?.mappingEvidence, {
    origin: 'manual',
    rationale: 'Pole dodane ręcznie przez administratora w edytorze wizualnym.',
  })
  assert.equal(binding?.condition, undefined)
  assert.equal(binding?.target.kind, 'overlay')
  if (binding?.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) {
    assert.fail('Expected a precise V2 overlay target.')
  }

  assert.deepEqual(binding.target.box, { x: 24, y: 38, width: 120, height: 17 })
  assert.deepEqual(binding.target.coordinateSpace, {
    units: 'pt',
    referenceBox: 'crop',
    origin: 'top-left',
    orientation: 'visual',
  })
  assert.equal(binding.target.appearance.kind, 'text')
  if (binding.target.appearance.kind !== 'text') assert.fail('Expected text appearance.')
  assert.equal(binding.target.appearance.fontId, 'dm-sans-regular')
  assert.equal(binding.target.appearance.wrap, 'none')
  assert.equal(result.template.coverage.mappedTargetCount, 0)
  assert.equal(result.template.coverage.status, 'incomplete')

  const validation = validateTemplateJson(result.template)
  assert.equal(validation.valid, true)
  assert.equal(validation.summary.needsReviewCount, 1)
  assert.equal(validation.summary.activationReady, false)
})

test('converts a drop point into PDF coordinates independently of preview zoom', () => {
  for (const zoom of [0.65, 0.85, 1, 1.25, 1.5]) {
    assert.deepEqual(
      viewportPointToVisualPoint({
        clientX: 40 + 120 * zoom,
        clientY: 60 + 240 * zoom,
        viewportLeft: 40,
        viewportTop: 60,
        scaleX: zoom,
        scaleY: zoom,
      }),
      { x: 120, y: 240 },
    )
  }
})

test('snaps a moved field to horizontal and vertical lines of another field', () => {
  assert.deepEqual(
    snapVisualBoxToReferenceBoxes({
      box: { x: 48, y: 22, width: 40, height: 10 },
      referenceBoxes: [{ x: 50, y: 20, width: 60, height: 20 }],
      thresholdX: 3,
      thresholdY: 3,
    }),
    {
      box: { x: 50, y: 20, width: 40, height: 10 },
      guides: [
        { axis: 'x', position: 50 },
        { axis: 'y', position: 20 },
      ],
    },
  )
})

test('snaps any moving anchor to the nearest available reference line', () => {
  const result = snapVisualBoxToReferenceBoxes({
    box: { x: 78, y: 12, width: 20, height: 10 },
    referenceBoxes: [{ x: 100, y: 80, width: 40, height: 20 }],
    thresholdX: 3,
    thresholdY: 3,
  })

  assert.deepEqual(result.box, { x: 80, y: 12, width: 20, height: 10 })
  assert.deepEqual(result.guides, [{ axis: 'x', position: 100 }])
})

test('does not snap outside the viewport-scaled threshold', () => {
  const box = { x: 40, y: 30, width: 20, height: 10 }
  assert.deepEqual(
    snapVisualBoxToReferenceBoxes({
      box,
      referenceBoxes: [{ x: 65, y: 45, width: 30, height: 10 }],
      thresholdX: 4,
      thresholdY: 4,
    }),
    { box, guides: [] },
  )
})

test('keeps a ten-pixel snap threshold at every preview zoom', () => {
  for (const zoom of [0.65, 0.85, 1, 1.25, 1.5]) {
    const insideGapInPoints = 9.5 / zoom
    const box = { x: 50 - insideGapInPoints, y: 30, width: 100, height: 10 }
    const referenceBoxes = [{ x: 50, y: 100, width: 100, height: 10 }]
    const result = snapVisualBoxToReferenceBoxes({
      box,
      referenceBoxes,
      thresholdX: 10 / zoom,
      thresholdY: 10 / zoom,
    })

    assert.ok(Math.abs(result.box.x - 50) < 0.000001)
    assert.deepEqual(result.guides, [{ axis: 'x', position: 100 }])

    const outsideGapInPoints = 10.5 / zoom
    const outsideBox = { x: 50 - outsideGapInPoints, y: 30, width: 100, height: 10 }
    assert.deepEqual(
      snapVisualBoxToReferenceBoxes({
        box: outsideBox,
        referenceBoxes,
        thresholdX: 10 / zoom,
        thresholdY: 10 / zoom,
      }),
      { box: outsideBox, guides: [] },
    )
  }
})

test('chooses the same alignment line independently of reference field order', () => {
  const box = { x: 50, y: 30, width: 20, height: 10 }
  const references = [
    { x: 48, y: 100, width: 20, height: 10 },
    { x: 52, y: 120, width: 20, height: 10 },
  ]

  const forward = snapVisualBoxToReferenceBoxes({
    box,
    referenceBoxes: references,
    thresholdX: 3,
    thresholdY: 3,
  })
  const reversed = snapVisualBoxToReferenceBoxes({
    box,
    referenceBoxes: references.toReversed(),
    thresholdX: 3,
    thresholdY: 3,
  })

  assert.deepEqual(forward, reversed)
  assert.deepEqual(forward.guides, [{ axis: 'x', position: 58 }])
})

test('snapping does not mutate the moving or reference boxes', () => {
  const box = { x: 49, y: 29, width: 20, height: 10 }
  const referenceBoxes = [{ x: 50, y: 30, width: 30, height: 20 }]
  const originalBox = structuredClone(box)
  const originalReferences = structuredClone(referenceBoxes)

  snapVisualBoxToReferenceBoxes({
    box,
    referenceBoxes,
    thresholdX: 3,
    thresholdY: 3,
  })

  assert.deepEqual(box, originalBox)
  assert.deepEqual(referenceBoxes, originalReferences)
})

test('adds the fifth applicant PESEL from the generated semantic catalog', () => {
  const result = addOverlayBinding(template({
    pages: [{
      page: 1,
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      cropBox: { x: 0, y: 0, width: 612, height: 792 },
      rotation: 0,
      userUnit: 1,
    }],
  }), {
    canonicalKey: 'applicants.4.pesel',
    page: 1,
    visualBox: { x: 104, y: 765, width: 425, height: 17 },
    placementKind: 'text',
  })
  const binding = result.template.bindings[0]

  assert.equal(binding?.canonicalKey, 'applicants.4.pesel')
  assert.equal(binding?.reviewStatus, 'needsReview')
  assert.equal(binding?.mappingEvidence?.origin, 'manual')
  assert.equal(validateTemplateJson(result.template).valid, true)
})

test('adds a controlled computed full-name binding from the visual catalog', () => {
  const source = template({
    pages: [{
      page: 1,
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      cropBox: { x: 0, y: 0, width: 612, height: 792 },
      rotation: 0,
      userUnit: 1,
    }],
  })
  const result = addOverlayBinding(source, {
    canonicalKey: 'applicants.4.fullName',
    page: 1,
    visualBox: { x: 155, y: 744, width: 374, height: 17 },
    placementKind: 'text',
  })
  const binding = result.template.bindings[0]

  assert.equal(binding?.computed, true)
  assert.deepEqual(binding?.valueFrom, [
    'applicants.4.firstName',
    'applicants.4.lastName',
  ])
  assert.equal(binding?.valueFormat, 'fullName')
  assert.equal(validateTemplateJson(result.template).valid, true)
})

test('adds option-specific checkbox and rejects an ambiguous select marker', () => {
  const result = addOverlayBinding(template(), {
    canonicalKey: 'loan.purpose',
    page: 1,
    visualBox: { x: 60, y: 80, width: 17, height: 17 },
    placementKind: 'checkbox',
    conditionEquals: 'purchase_primary',
  })
  const binding = result.template.bindings[0]

  assert.deepEqual(binding?.condition, {
    canonicalKey: 'loan.purpose',
    equals: 'purchase_primary',
  })
  assert.equal(binding?.target.kind, 'overlay')
  if (binding?.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) {
    assert.fail('Expected a precise V2 overlay target.')
  }
  assert.equal(binding.target.appearance.kind, 'mark')
  if (binding.target.appearance.kind !== 'mark') assert.fail('Expected mark appearance.')
  assert.equal(binding.target.appearance.role, 'checkbox')
  assert.equal(binding.target.appearance.glyph, 'x')

  assert.throws(
    () => addOverlayBinding(template(), {
      canonicalKey: 'loan.purpose',
      page: 1,
      visualBox: { x: 60, y: 80, width: 17, height: 17 },
      placementKind: 'radio',
    }),
    /wymaga wybrania konkretnej opcji/,
  )
  assert.throws(
    () => addOverlayBinding(template(), {
      canonicalKey: 'loan.purpose',
      page: 1,
      visualBox: { x: 60, y: 80, width: 100, height: 17 },
      placementKind: 'text',
    }),
    /nie surowy tekst/,
  )
})

test('approval recomputes coverage without certifying an unaudited inventory', () => {
  const added = addOverlayBinding(template(), {
    canonicalKey: 'application.place',
    page: 1,
    visualBox: { x: 20, y: 30, width: 100, height: 17 },
    placementKind: 'text',
  })
  const approved = setTemplateBindingReviewStatus(added.template, added.bindingIndex, 'ready')

  assert.equal(added.template.bindings[0]?.reviewStatus, 'needsReview')
  assert.equal(added.template.coverage.mappedTargetCount, 0)
  assert.equal(approved.bindings[0]?.reviewStatus, 'ready')
  assert.equal(approved.coverage.mappedTargetCount, 1)
  assert.equal(approved.coverage.status, 'incomplete')

  const validation = validateTemplateJson(approved)
  assert.equal(validation.valid, true)
  assert.equal(validation.summary.needsReviewCount, 0)
  assert.equal(validation.summary.activationReady, false)
})

test('editing invalidates an audited binding and reapproval does not certify completeness', () => {
  const added = addOverlayBinding(template(), {
    canonicalKey: 'application.place',
    page: 1,
    visualBox: { x: 20, y: 30, width: 100, height: 17 },
    placementKind: 'text',
  })
  const audited = setTemplateBindingReviewStatus(added.template, added.bindingIndex, 'ready')
  audited.coverage.status = 'complete'

  const invalidated = setTemplateBindingReviewStatus(audited, added.bindingIndex, 'needsReview')
  assert.equal(invalidated.coverage.mappedTargetCount, 0)
  assert.equal(invalidated.coverage.status, 'incomplete')

  const reapproved = setTemplateBindingReviewStatus(invalidated, added.bindingIndex, 'ready')
  assert.equal(reapproved.coverage.mappedTargetCount, 1)
  assert.equal(reapproved.coverage.status, 'incomplete')
  assert.equal(validateTemplateJson(reapproved).summary.activationReady, false)
})

test('removes an accidental mapping and recomputes coverage immutably', () => {
  const added = addOverlayBinding(template(), {
    canonicalKey: 'application.date',
    page: 1,
    visualBox: { x: 20, y: 30, width: 100, height: 17 },
    placementKind: 'text',
  })
  const approved = setTemplateBindingReviewStatus(added.template, added.bindingIndex, 'ready')
  const removed = removeTemplateBinding(approved, added.bindingIndex)

  assert.equal(approved.bindings.length, 1)
  assert.equal(removed.bindings.length, 0)
  assert.equal(removed.coverage.mappedTargetCount, 0)
  assert.equal(removed.coverage.status, 'incomplete')
})

test('adding and removing an overlay toggles an AcroForm template through hybrid', () => {
  const result = addOverlayBinding(PEKAO_TEMPLATE, {
    canonicalKey: 'application.date',
    page: 1,
    visualBox: { x: 30, y: 40, width: 90, height: 17 },
    placementKind: 'text',
  })

  assert.equal(PEKAO_TEMPLATE.source.formKind, 'acroform')
  assert.equal(result.template.source.formKind, 'hybrid')
  assert.equal(
    removeTemplateBinding(result.template, result.bindingIndex).source.formKind,
    'acroform',
  )
})

test('Erste coverage changes from 33/106 to 34/106 only after approval', () => {
  const added = addOverlayBinding(ERSTE_TEMPLATE, {
    canonicalKey: 'property.address.street',
    page: 9,
    visualBox: { x: 200, y: 300, width: 180, height: 17 },
    placementKind: 'text',
  })

  assert.equal(ERSTE_TEMPLATE.coverage.mappedTargetCount, 33)
  assert.equal(added.template.coverage.mappedTargetCount, 33)
  assert.equal(added.template.bindings.at(-1)?.reviewStatus, 'needsReview')

  const approved = setTemplateBindingReviewStatus(
    added.template,
    added.bindingIndex,
    'ready',
  )
  assert.equal(approved.coverage.mappedTargetCount, 34)
  assert.equal(approved.coverage.inScopeTargetCount, 106)
  assert.equal(approved.coverage.status, 'incomplete')
})

test('stores a normalized per-binding semantic contract without mutating the template', () => {
  const added = addOverlayBinding(template(), {
    canonicalKey: 'application.date',
    page: 1,
    visualBox: { x: 20, y: 30, width: 100, height: 17 },
    placementKind: 'text',
  })
  const approved = setTemplateBindingReviewStatus(added.template, added.bindingIndex, 'ready')
  const updated = setTemplateBindingSemanticContract(approved, added.bindingIndex, {
    semanticDescription: '  Data podpisania lub złożenia tego wniosku. ',
    semanticRole: ' application.submission.date ',
    aiMappingHints: {
      aliases: [' Data wniosku ', 'data wniosku', 'Dnia'],
      exclude: [' Data urodzenia ', 'data urodzenia'],
    },
    source: 'manual',
  })

  assert.equal(approved.bindings[0]?.semanticContract, undefined)
  assert.equal(approved.bindings[0]?.reviewStatus, 'ready')
  assert.deepEqual(updated.bindings[0]?.semanticContract, {
    semanticDescription: 'Data podpisania lub złożenia tego wniosku.',
    semanticRole: 'application.submission.date',
    aiMappingHints: {
      aliases: ['Data wniosku', 'Dnia'],
      exclude: ['Data urodzenia'],
    },
    source: 'manual',
  })
  assert.equal(updated.bindings[0]?.reviewStatus, 'needsReview')
  assert.equal(updated.coverage.mappedTargetCount, 0)
  assert.equal(validateTemplateJson(updated).valid, true)
})

test('resets a per-binding semantic contract to the central catalog fallback', () => {
  const added = addOverlayBinding(template(), {
    canonicalKey: 'application.date',
    page: 1,
    visualBox: { x: 20, y: 30, width: 100, height: 17 },
    placementKind: 'text',
  })
  const customized = setTemplateBindingSemanticContract(added.template, added.bindingIndex, {
    semanticDescription: 'Data złożenia wniosku w tym banku.',
    semanticRole: 'application.submission.date',
    aiMappingHints: {
      aliases: ['data złożenia'],
      exclude: [],
    },
    source: 'ai',
    rationale: 'Nagłówek strony wskazuje sekcję wniosku.',
    model: 'google/test-model',
  })
  const reset = resetTemplateBindingSemanticContract(customized, added.bindingIndex)

  assert.ok(customized.bindings[0]?.semanticContract)
  assert.equal(reset.bindings[0]?.semanticContract, undefined)
  assert.equal(reset.bindings[0]?.reviewStatus, 'needsReview')
})

test('rejects invalid semantic roles and oversized hint lists before committing', () => {
  assert.throws(
    () => normalizeTemplateBindingSemanticContract({
      semanticDescription: 'Opis',
      semanticRole: 'niepoprawna rola',
      aiMappingHints: { aliases: ['data'], exclude: [] },
      source: 'manual',
    }),
    /notacji kropkowej/,
  )
  assert.throws(
    () => normalizeTemplateBindingSemanticContract({
      semanticDescription: 'Opis',
      semanticRole: 'application.date',
      aiMappingHints: {
        aliases: Array.from({ length: 31 }, (_, index) => `alias ${index}`),
        exclude: [],
      },
      source: 'manual',
    }),
    /maksymalnie 30/,
  )
  assert.throws(
    () => normalizeTemplateBindingSemanticContract({
      semanticDescription: 'Opis',
      semanticRole: 'application.date',
      aiMappingHints: {
        aliases: ['data wniosku'],
        exclude: ['Data wniosku'],
      },
      source: 'manual',
    }),
    /jednocześnie/,
  )
  assert.throws(
    () => normalizeTemplateBindingSemanticContract({
      semanticDescription: 'Opis',
      semanticRole: 'application.date',
      aiMappingHints: { aliases: ['data'], exclude: [] },
      source: 'ai',
      rationale: 'x'.repeat(1_001),
    }),
    /maksymalnie 1000/,
  )
})
