import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PDFDict,
  PDFDocument,
  PDFName,
} from 'pdf-lib'

import {
  CANONICAL_COLLECTIONS,
  CANONICAL_FIELDS,
} from '../src/canonical-fields.ts'
import { templateApplicantCapacity } from '../src/template-capacity.ts'
import { validateTemplateJson } from '../src/template-validation.ts'
import {
  ERSTE_INVESTOR_STATEMENT_TEMPLATE,
  ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE,
} from '../src/templates/erste-supplemental.ts'
import type { DocumentTemplate } from '../src/types.ts'

const SOURCES = [
  {
    template: ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE,
    path: fileURLToPath(new URL(
      '../../../mock-files/erste-wniosek-o-warunki-wstepne-kredytu-hipotecznego-2026-07-20.pdf',
      import.meta.url,
    )),
    sha256: '009bc99152508b2b4e4f05a504ac785fc0cb7c3331e3c89a5b719a366f9ff2a5',
    pageCount: 9,
  },
  {
    template: ERSTE_INVESTOR_STATEMENT_TEMPLATE,
    path: fileURLToPath(new URL(
      '../../../mock-files/erste-oswiadczenie-inwestora-2026-04-25.pdf',
      import.meta.url,
    )),
    sha256: '2e92bf86367b182432901544d15ee4fa01e50607e7b6caeffd94f5df5c5289c7',
    pageCount: 3,
  },
] as const

function overlaySnapshot(template: DocumentTemplate) {
  return template.bindings.map(binding => ({
    canonicalKey: binding.canonicalKey,
    condition: binding.condition,
    computed: binding.computed,
    valueFrom: binding.valueFrom,
    valueFormat: binding.valueFormat,
    target: binding.target,
  }))
}

for (const source of SOURCES) {
  test(`${source.template.id} pins official static bytes and overlay method`, async () => {
    const sourceBytes = await readFile(source.path)
    assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), source.sha256)
    assert.equal(source.template.source.sha256, source.sha256)
    assert.equal(source.template.source.fileName, source.path.split('/').at(-1))
    assert.deepEqual(source.template.fillMethod, { kind: 'pdf_overlay' })
    assert.equal(source.template.source.formKind, 'overlay')

    const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
    assert.equal(pdf.getPageCount(), source.pageCount)
    assert.equal(
      pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict),
      undefined,
      'the official source must remain a static PDF without /AcroForm',
    )
    assert.equal(pdf.getForm().getFields().length, 0)

    const widgets = pdf.getPages().flatMap(page => (
      (page.node.Annots()?.asArray() ?? []).flatMap((annotationRef) => {
        const annotation = pdf.context.lookupMaybe(annotationRef, PDFDict)
        return annotation?.get(PDFName.of('Subtype'))?.toString() === '/Widget'
          ? [annotation]
          : []
      })
    ))
    assert.equal(widgets.length, 0, 'the static source must not expose widget geometry')
    assert.equal(
      widgets.filter(widget => widget.has(PDFName.of('AP'))).length,
      0,
      'there can be no widget appearance stream without a widget',
    )
  })
}

test('preliminary conditions inventories all 9 pages and supports four applicants', () => {
  const template = ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE
  assert.deepEqual(template.requiredCanonicalKeys, [
    'loan.gracePeriod',
    'additionalProducts.enabled',
    'consents.electronicDocumentDelivery',
    'applicants.0.postContractDataProcessingConsent',
    'application.submissionChannel',
  ])
  assert.equal(template.bindings.length, 91)
  assert.equal(template.bindings.every(binding => binding.target.kind === 'overlay'), true)
  assert.equal(template.bindings.every(binding => binding.reviewStatus === 'ready'), true)
  assert.equal(templateApplicantCapacity(template), 4)
  assert.deepEqual(
    Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
      const page = index + 1
      return [page, template.bindings.filter(binding => (
        binding.target.kind === 'overlay' && binding.target.page === page
      )).length]
    })),
    { 1: 10, 2: 15, 3: 15, 4: 18, 5: 6, 6: 10, 7: 3, 8: 14, 9: 0 },
  )

  const geometry = template.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'overlay')
    if (binding.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) return ''
    return `${binding.target.page}:${binding.target.box.x}:${binding.target.box.y}:${binding.target.box.width}:${binding.target.box.height}`
  })
  assert.equal(new Set(geometry).size, 91)
  assert.equal(
    createHash('sha256').update(JSON.stringify(overlaySnapshot(template))).digest('hex'),
    '32e36c95df4792861cf329fa206a080d894d27bc006c7a6b2df6f9d783ee87ab',
  )
  assert.equal(template.coverage.inScopeTargetCount, 91)
  assert.equal(template.coverage.mappedTargetCount, 91)
  assert.equal(template.coverage.manualUserActionCount, 4)
  assert.equal(template.coverage.excludedTargetCount, 2)
  assert.equal(validateTemplateJson(template).valid, true)
  assert.equal(validateTemplateJson(template).fillReady, true)
})

test('investor statement inventories all 3 pages and is included only for primary-market purchase', () => {
  const template = ERSTE_INVESTOR_STATEMENT_TEMPLATE
  assert.deepEqual(template.includeWhen, {
    canonicalKey: 'loan.purpose',
    equals: 'purchase_primary',
  })
  assert.deepEqual(template.requiredCanonicalKeys, [
    'investor.name',
    'investor.buyerDetails',
    'investor.garageShareIncluded',
    'investor.otherSharesIncluded',
    'investor.paymentTiming',
    'investor.plotNumbers',
    'investor.constructionProgressPercent',
    'investor.expectedOwnershipTransferDate',
  ])
  assert.equal(template.bindings.length, 48)
  assert.equal(template.bindings.every(binding => binding.target.kind === 'overlay'), true)
  assert.equal(template.bindings.every(binding => binding.reviewStatus === 'ready'), true)
  assert.equal(templateApplicantCapacity(template), null)
  assert.deepEqual(
    Object.fromEntries(Array.from({ length: 3 }, (_, index) => {
      const page = index + 1
      return [page, template.bindings.filter(binding => (
        binding.target.kind === 'overlay' && binding.target.page === page
      )).length]
    })),
    { 1: 16, 2: 29, 3: 3 },
  )

  const geometry = template.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'overlay')
    if (binding.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) return ''
    return `${binding.target.page}:${binding.target.box.x}:${binding.target.box.y}:${binding.target.box.width}:${binding.target.box.height}`
  })
  assert.equal(new Set(geometry).size, 48)
  assert.equal(
    createHash('sha256').update(JSON.stringify(overlaySnapshot(template))).digest('hex'),
    '138932decab65f1d429c54f876ac3b4f3cbacbee49bf84386cef6deb164e07f8',
  )
  assert.equal(template.coverage.inScopeTargetCount, 48)
  assert.equal(template.coverage.mappedTargetCount, 48)
  assert.equal(template.coverage.manualUserActionCount, 2)
  assert.equal(template.coverage.excludedTargetCount, 0)
  assert.equal(validateTemplateJson(template).valid, true)
  assert.equal(validateTemplateJson(template).fillReady, true)
})

test('supplemental readiness metadata covers active applicants and conditional sections', () => {
  const applicants = CANONICAL_COLLECTIONS.find(collection => collection.key === 'applicants')
  assert.ok(applicants?.requiredRelativeKeys.includes('postContractDataProcessingConsent'))

  const field = (canonicalKey: string) => {
    const definition = CANONICAL_FIELDS.find(candidate => candidate.canonicalKey === canonicalKey)
    assert.ok(definition, `missing canonical field ${canonicalKey}`)
    return definition
  }

  assert.deepEqual(field('investor.paymentScheduleType').requiredWhen, {
    canonicalKey: 'investor.paymentTiming',
    equals: 'before_notarial_deed',
  })
})
