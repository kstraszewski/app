import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
  TextAlignment,
} from 'pdf-lib'

import { PKO_TEMPLATE } from '../src/templates/pko.ts'
import { validateTemplateJson } from '../src/template-validation.ts'

const sourcePath = fileURLToPath(new URL(
  '../../../mock-files/pko-bp-wniosek-o-kredyt-hipoteczny-2025-09-30.pdf',
  import.meta.url,
))

test('PKO inventories every customer-facing AcroForm widget exactly once', async () => {
  const sourceBytes = await readFile(sourcePath)
  assert.equal(
    createHash('sha256').update(sourceBytes).digest('hex'),
    PKO_TEMPLATE.source.sha256,
  )

  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const fields = pdf.getForm().getFields()
  const technicalFields = fields.filter(field => field instanceof PDFButton)
  const customerFields = fields.filter(field => !(field instanceof PDFButton))
  const targetNames = PKO_TEMPLATE.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'acroform')
    return binding.target.kind === 'acroform' ? binding.target.field : ''
  })

  assert.equal(fields.length, 182)
  assert.equal(technicalFields.length, 38)
  assert.equal(customerFields.length, 144)
  assert.equal(customerFields.filter(field => field instanceof PDFTextField).length, 70)
  assert.equal(customerFields.filter(field => field instanceof PDFCheckBox).length, 74)
  assert.equal(PKO_TEMPLATE.version, 3)
  assert.equal(new Set(targetNames).size, 144)
  assert.deepEqual(
    [...targetNames].sort((left, right) => left.localeCompare(right, 'pl')),
    customerFields.map(field => field.getName()).sort((left, right) => left.localeCompare(right, 'pl')),
  )

  const fieldByName = new Map(customerFields.map(field => [field.getName(), field]))
  for (const binding of PKO_TEMPLATE.bindings) {
    if (binding.target.kind !== 'acroform' || !binding.target.valueMap) continue
    const field = fieldByName.get(binding.target.field)
    assert.ok(field instanceof PDFCheckBox, binding.target.field)
    const exportValues = new Set(field.acroField.getWidgets().flatMap(widget => (
      widget.getOnValue() ? [widget.getOnValue()!.decodeText()] : []
    )))
    for (const mappedValue of Object.values(binding.target.valueMap)) {
      assert.ok(exportValues.has(mappedValue), `${binding.target.field}: ${mappedValue}`)
    }
  }

  const pageByAnnotationRef = new Map<string, number>()
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      pageByAnnotationRef.set(annotation.toString(), pageIndex + 1)
    }
  }

  const widgetsPerPage = new Map<number, number>()
  const bindingByField = new Map(PKO_TEMPLATE.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'acroform')
    return [binding.target.kind === 'acroform' ? binding.target.field : '', binding] as const
  }))
  for (const field of customerFields) {
    const widgets = field.acroField.getWidgets()
    assert.equal(widgets.length, 1, field.getName())
    const widget = widgets[0]!
    const annotationRef = pdf.context.getObjectRef(widget.dict)
    const page = widget.P()
      ? pdf.getPages().findIndex(item => item.ref.toString() === widget.P()!.toString()) + 1
      : annotationRef
        ? pageByAnnotationRef.get(annotationRef.toString())
        : undefined
    assert.ok(page && page >= 1 && page <= 4, field.getName())
    widgetsPerPage.set(page, (widgetsPerPage.get(page) ?? 0) + 1)

    const binding = bindingByField.get(field.getName())
    assert.ok(binding && binding.target.kind === 'acroform', field.getName())
    if (!binding || binding.target.kind !== 'acroform') continue
    const target = binding.target
    const expectedWidget = target.expectedWidgets?.[0]
    assert.equal(target.expectedWidgets?.length, 1, field.getName())
    assert.ok(expectedWidget, field.getName())
    assert.equal(expectedWidget?.page, page, field.getName())
    assert.deepEqual(expectedWidget?.rect, Object.fromEntries(
      Object.entries(widget.getRectangle()).map(([key, value]) => [key, Number(value.toFixed(2))]),
    ), field.getName())

    if (field instanceof PDFTextField) {
      const alignment = field.getAlignment() === TextAlignment.Center
        ? 'center'
        : field.getAlignment() === TextAlignment.Right
          ? 'right'
          : 'left'
      assert.equal(target.fieldType, 'text', field.getName())
      assert.deepEqual(target.text, {
        alignment,
        multiline: field.isMultiline(),
        comb: field.isCombed(),
        ...(field.getMaxLength() !== undefined ? { maxLength: field.getMaxLength() } : {}),
      }, field.getName())
      assert.equal(target.appearance?.kind, 'text', field.getName())
      if (target.appearance?.kind === 'text') {
        assert.equal(target.appearance.horizontalAlign, alignment, field.getName())
        assert.equal(target.appearance.fontSizePt, 8, field.getName())
        assert.deepEqual(
          target.appearance.distribution,
          field.isCombed() && field.getMaxLength() !== undefined
            ? { kind: 'comb', cells: field.getMaxLength() }
            : { kind: 'flow' },
          field.getName(),
        )
      }
    }
    else {
      assert.ok(field instanceof PDFCheckBox, field.getName())
      assert.equal(target.fieldType, 'checkbox', field.getName())
      assert.equal(target.appearance?.kind, 'mark', field.getName())
      assert.equal(
        expectedWidget?.exportValue,
        widget.getOnValue()?.decodeText(),
        field.getName(),
      )
    }
  }

  assert.deepEqual(Object.fromEntries(widgetsPerPage), { 1: 53, 2: 78, 3: 8, 4: 5 })
  assert.deepEqual(PKO_TEMPLATE.coverage, {
    status: 'complete',
    inScopeTargetCount: 144,
    mappedTargetCount: 144,
    manualUserActionCount: 4,
    excludedTargetCount: 38,
    notes: PKO_TEMPLATE.coverage.notes,
  })

  assert.deepEqual(validateTemplateJson(PKO_TEMPLATE), {
    kind: 'document-template',
    valid: true,
    fillReady: true,
    errors: [],
    warnings: [],
    summary: {
      bindingCount: 144,
      mappedBindingCount: 144,
      readyBindingCount: 144,
      needsReviewCount: 0,
      unmappedCount: 0,
      activationReady: true,
    },
  })
})

test('PKO preserves source semantics for totals, collateral and paired choices', () => {
  const bindingFor = (field: string) => PKO_TEMPLATE.bindings.find(binding => (
    binding.target.kind === 'acroform' && binding.target.field === field
  ))

  assert.deepEqual(bindingFor('wlasne_razem')?.valueFrom, [
    'investment.ownFundsPaid',
    'investment.landValue',
  ])
  assert.deepEqual(bindingFor('wlasne_do_wniesienia_razem')?.valueFrom, [
    'investment.ownFundsBeforeDisbursement',
    'investment.ownFundsDuringInvestment',
  ])
  assert.equal(bindingFor('wnioskowany_kredyt')?.canonicalKey, 'loan.amount')
  assert.equal(bindingFor('docelowa_wartosc')?.canonicalKey, 'collateralProperty.marketValue')
  assert.equal(
    bindingFor('hipoteka_nieruchomosc3_kw2')?.canonicalKey,
    'collateralProperties.2.landRegisterNumber',
  )
  const creditCardNo = bindingFor('karta_kredytowa_1')
  assert.ok(creditCardNo?.target.kind === 'acroform')
  assert.deepEqual(
    creditCardNo?.target.kind === 'acroform' ? creditCardNo.target.valueMap : undefined,
    { false: 'nie' },
  )
  assert.equal(bindingFor('wniosek_0')?.canonicalKey, 'loan.productVariant')
  assert.equal(bindingFor('wniosek_1')?.canonicalKey, 'loan.productVariant')
  assert.equal(bindingFor('wniosek_2')?.canonicalKey, 'loan.productType')
  assert.equal(bindingFor('nr_rachunku')?.valueFormat, 'bankAccount.nrb')
  assert.equal(
    bindingFor('inny_rzeczoznawca')?.condition?.canonicalKey,
    'property.appraiserChoice',
  )
})
