import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
} from 'pdf-lib'

import { validateTemplateJson } from '../src/template-validation.ts'
import { ERSTE_TEMPLATE } from '../src/templates/erste.ts'

const sourcePath = fileURLToPath(new URL(
  '../../../mock-files/erste-wniosek-o-kredyt-hipoteczny-2026-07-20.pdf',
  import.meta.url,
))

test('Erste 20.07.2026 preserves the official static source and uses overlay deliberately', async () => {
  const sourceBytes = await readFile(sourcePath)
  assert.equal(
    createHash('sha256').update(sourceBytes).digest('hex'),
    '8f43ba0fe5f1557b1c2d35d44142aa364a79773500ea94944fe1ff9913d668d7',
  )
  assert.equal(ERSTE_TEMPLATE.source.sha256, '8f43ba0fe5f1557b1c2d35d44142aa364a79773500ea94944fe1ff9913d668d7')
  assert.equal(ERSTE_TEMPLATE.version, 2)
  assert.deepEqual(ERSTE_TEMPLATE.fillMethod, { kind: 'pdf_overlay' })
  assert.equal(ERSTE_TEMPLATE.source.formKind, 'overlay')

  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  assert.equal(pdf.getPageCount(), 9)
  assert.equal(pdf.getForm().getFields().length, 0)

  const acroForm = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  assert.ok(acroForm, 'the source advertises an AcroForm dictionary')
  assert.equal(
    acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray)?.size(),
    0,
    'the advertised field tree is empty',
  )

  const widgetAnnotations = pdf.getPages().flatMap(page => (
    (page.node.Annots()?.asArray() ?? []).filter((annotationRef) => {
      const annotation = pdf.context.lookupMaybe(annotationRef, PDFDict)
      return annotation?.get(PDFName.of('Subtype'))?.toString() === '/Widget'
    })
  ))
  assert.equal(widgetAnnotations.length, 0)
})

test('Erste 20.07.2026 inventories every reviewed overlay target exactly once', () => {
  assert.deepEqual(ERSTE_TEMPLATE.requiredCanonicalKeys, [
    'loan.gracePeriod',
    'additionalProducts.enabled',
    'consents.earlyCreditDecision',
    'application.submissionChannel',
  ])
  assert.equal(ERSTE_TEMPLATE.bindings.length, 102)
  assert.equal(ERSTE_TEMPLATE.bindings.every(binding => binding.target.kind === 'overlay'), true)
  assert.equal(ERSTE_TEMPLATE.bindings.every(binding => binding.reviewStatus === 'ready'), true)

  const geometry = ERSTE_TEMPLATE.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'overlay')
    if (binding.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) return ''
    return `${binding.target.page}:${binding.target.box.x}:${binding.target.box.y}:${binding.target.box.width}:${binding.target.box.height}`
  })
  assert.equal(new Set(geometry).size, 102)
  assert.deepEqual(
    Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
      const page = index + 1
      return [page, ERSTE_TEMPLATE.bindings.filter(binding => (
        binding.target.kind === 'overlay' && binding.target.page === page
      )).length]
    })),
    { 1: 10, 2: 15, 3: 17, 4: 25, 5: 14, 6: 4, 7: 14, 8: 3, 9: 0 },
  )

  const snapshot = ERSTE_TEMPLATE.bindings.map(binding => ({
    canonicalKey: binding.canonicalKey,
    condition: binding.condition,
    computed: binding.computed,
    valueFrom: binding.valueFrom,
    valueFormat: binding.valueFormat,
    target: binding.target,
  }))
  assert.equal(
    createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    '1b0d7fd0cf83dfede3cbbbe00a6bc969f422707da42038f2cb7504db679195d2',
  )

  assert.deepEqual(ERSTE_TEMPLATE.coverage, {
    status: 'complete',
    inScopeTargetCount: 102,
    mappedTargetCount: 102,
    manualUserActionCount: 4,
    excludedTargetCount: 4,
    notes: ERSTE_TEMPLATE.coverage.notes,
  })
  assert.deepEqual(validateTemplateJson(ERSTE_TEMPLATE), {
    kind: 'document-template',
    valid: true,
    fillReady: true,
    errors: [],
    warnings: [],
    summary: {
      bindingCount: 102,
      mappedBindingCount: 102,
      readyBindingCount: 102,
      needsReviewCount: 0,
      unmappedCount: 0,
      activationReady: true,
    },
  })
})
