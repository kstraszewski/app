import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import type { DocumentTemplate, PdfTextAppearance, TemplateTarget } from '@openexpert/multiform'
import {
  AnnotationFlags,
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  TextAlignment,
} from 'pdf-lib'
import { unzipSync } from 'fflate'
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js'

import { createPdfBundle, fillPdfTemplate } from '../server/utils/multiform-pdf.ts'

const fontUrl = new URL('../public/fonts/DMSans-VariableFont_opsz,wght.ttf', import.meta.url)
const fontBytesPromise = readFile(fontUrl)

const pageGeometry = {
  page: 1,
  mediaBox: { x: 0, y: 0, width: 320, height: 200 },
  cropBox: { x: 0, y: 0, width: 320, height: 200 },
  rotation: 0 as const,
  userUnit: 1,
}

const textAppearance: PdfTextAppearance = {
  kind: 'text',
  fontId: 'dm-sans-regular',
  fontSizePt: 12,
  minFontSizePt: 7,
  letterSpacingPt: 2.25,
  lineHeightPt: 14,
  wrap: 'none',
  overflow: 'error',
  horizontalAlign: 'left',
  verticalAlign: 'middle',
  distribution: { kind: 'flow' },
  color: { space: 'gray', value: 0 },
  opacity: 1,
  paddingPt: { top: 2, right: 3, bottom: 2, left: 3 },
}

function templateWithTarget(
  target: TemplateTarget,
  formKind: DocumentTemplate['source']['formKind'],
): DocumentTemplate {
  return {
    schemaVersion: 2,
    id: `test-${formKind}`,
    bank: 'erste',
    label: 'Synthetic renderer fixture',
    version: 1,
    source: {
      fileName: 'synthetic.pdf',
      sha256: 'synthetic-test-fixture',
      pageCount: 1,
      formKind,
      pages: [pageGeometry],
    },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 1,
      mappedTargetCount: 1,
    },
    bindings: [{
      canonicalKey: 'applicants.0.pesel',
      target,
      reviewStatus: 'ready',
    }],
  }
}

async function blankPdf() {
  const pdf = await PDFDocument.create()
  pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  return pdf.save()
}

async function combPdf() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  const field = pdf.getForm().createTextField('applicant.pesel')

  field.setMaxLength(11)
  field.enableCombing()
  field.setAlignment(TextAlignment.Right)
  field.addToPage(page, {
    x: 40,
    y: 80,
    width: 220,
    height: 24,
    borderWidth: 0.75,
  })

  return pdf.save()
}

async function radioPdf() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  const field = pdf.getForm().createRadioGroup('loan.purpose')
  field.addOptionToPage('Zakup nieruchomości', page, {
    x: 40,
    y: 100,
    width: 18,
    height: 18,
  })
  field.addOptionToPage('Budowa domu', page, {
    x: 40,
    y: 70,
    width: 18,
    height: 18,
  })
  return pdf.save()
}

function decodedPageContent(pdf: PDFDocument) {
  const contents = pdf.getPage(0).node.Contents()
  const objects = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
  return objects.map((object) => {
    const stream = pdf.context.lookup(object)
    if (!(stream instanceof PDFRawStream)) return ''
    return new TextDecoder().decode(decodePDFRawStream(stream).decode())
  }).join('\n')
}

test('renderer v2 draws a letter-spaced value inside an explicit box', async () => {
  const sourceBytes = await blankPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'overlay',
    rendererVersion: 2,
    page: 1,
    box: { x: 40, y: 70, width: 220, height: 28 },
    coordinateSpace: {
      units: 'pt',
      referenceBox: 'media',
      origin: 'bottom-left',
      orientation: 'unrotated',
    },
    appearance: textAppearance,
  }, 'overlay')

  const outputBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'applicants.0.pesel': '12345678901',
  })

  assert.ok(outputBytes.length > sourceBytes.length)

  const rendered = await PDFDocument.load(outputBytes)
  assert.equal(rendered.getPageCount(), 1)
  assert.ok(rendered.getPage(0).node.Contents(), 'rendered page should have a content stream')
})

test('AcroForm comb/right-alignment is rendered and its widget is hidden', async () => {
  const sourceBytes = await combPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'acroform',
    field: 'applicant.pesel',
    fieldType: 'text',
    text: {
      alignment: 'right',
      multiline: false,
      comb: true,
      maxLength: 11,
    },
  }, 'acroform')

  const outputBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'applicants.0.pesel': '12345678901',
  })
  const rendered = await PDFDocument.load(outputBytes)
  const field = rendered.getForm().getTextField('applicant.pesel')
  const [widget] = field.acroField.getWidgets()

  assert.equal(field.getText(), '12345678901')
  assert.equal(field.isCombed(), true)
  assert.equal(field.getAlignment(), TextAlignment.Right)
  assert.ok(widget, 'synthetic field should retain its widget')
  assert.equal(widget.hasFlag(AnnotationFlags.Hidden), true)
})

test('AcroForm placement override moves deterministic page content without changing the source snapshot', async () => {
  const sourceBytes = await combPdf()
  const sourcePdf = await PDFDocument.load(sourceBytes)
  const [sourceWidget] = sourcePdf.getForm().getTextField('applicant.pesel').acroField.getWidgets()
  const sourceWidgetRect = sourceWidget?.getRectangle()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'acroform',
    field: 'applicant.pesel',
    fieldType: 'text',
    expectedWidgets: [{
      index: 0,
      page: 1,
      rect: { x: 40, y: 80, width: 220, height: 24 },
    }],
    placementOverrides: [{
      widgetIndex: 0,
      page: 1,
      box: { x: 120, y: 30, width: 150, height: 24 },
      coordinateSpace: {
        units: 'pt',
        referenceBox: 'media',
        origin: 'bottom-left',
        orientation: 'unrotated',
      },
    }],
    text: {
      alignment: 'left',
      multiline: false,
      comb: false,
    },
    appearance: {
      ...textAppearance,
      letterSpacingPt: 0,
      horizontalAlign: 'left',
      distribution: { kind: 'flow' },
      paddingPt: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  }, 'acroform')

  const outputBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'applicants.0.pesel': '12345678901',
  })
  const rendered = await PDFDocument.load(outputBytes)
  const field = rendered.getForm().getTextField('applicant.pesel')
  const [widget] = field.acroField.getWidgets()
  const widgetRect = widget?.getRectangle()

  assert.deepEqual(widgetRect, sourceWidgetRect)
  assert.equal(widget?.hasFlag(AnnotationFlags.Hidden), true)
  assert.match(decodedPageContent(rendered), /1 0 0 1 120(?:\.0+)? /)
})

test('an overlong AcroForm comb value fails with a controlled error', async () => {
  const sourceBytes = await combPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'acroform',
    field: 'applicant.pesel',
    fieldType: 'text',
    text: {
      alignment: 'right',
      multiline: false,
      comb: true,
      maxLength: 11,
    },
  }, 'acroform')

  await assert.rejects(
    fillPdfTemplate(template, sourceBytes, fontBytes, {
      'applicants.0.pesel': '123456789012',
    }),
    error => error instanceof Error
      && /comb|maxLength|maximum length|więcej znaków|length=12/i.test(error.message),
  )
})

test('radio export value is mapped to the matching widget on-value before flattening', async () => {
  const sourceBytes = await radioPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'acroform',
    field: 'loan.purpose',
    fieldType: 'radio',
    valueMap: { purchase_primary: 'Zakup nieruchomości' },
  }, 'acroform')

  const outputBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'applicants.0.pesel': 'purchase_primary',
  })
  const rendered = await PDFDocument.load(outputBytes)
  const field = rendered.getForm().getRadioGroup('loan.purpose')
  const widgets = field.acroField.getWidgets()

  assert.equal(field.getSelected(), 'Zakup nieruchomości')
  assert.ok(widgets.every(widget => widget.hasFlag(AnnotationFlags.Hidden)))
  assert.match(decodedPageContent(rendered), /\bf\b/, 'selected radio should draw a filled dot')
})

test('PDF bundle uses fixed folders and zip-slip-safe case-insensitive attachment names', async () => {
  const sourceBytes = await blankPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'overlay',
    rendererVersion: 2,
    page: 1,
    box: { x: 40, y: 70, width: 220, height: 28 },
    coordinateSpace: {
      units: 'pt',
      referenceBox: 'media',
      origin: 'bottom-left',
      orientation: 'unrotated',
    },
    appearance: textAppearance,
  }, 'overlay')
  const firstAttachment = new Uint8Array([1, 2, 3])
  const secondAttachment = new Uint8Array([4, 5, 6])

  const archive = await createPdfBundle(
    [{ fileName: '../../WNIOSEK.PDF', template, sourceBytes }],
    fontBytes,
    { 'applicants.0.pesel': '12345678901' },
    [
      { fileName: '../../Dowód.pdf', bytes: firstAttachment },
      { fileName: 'DOWÓD.PDF', bytes: secondAttachment },
    ],
  )
  const files = unzipSync(archive)
  const names = Object.keys(files)

  assert.ok(names.includes('01-wnioski/uzupelniony-WNIOSEK.PDF'))
  assert.ok(names.includes('02-zalaczniki/Dowód.pdf'))
  assert.ok(names.includes('02-zalaczniki/DOWÓD-2.PDF'))
  assert.ok(names.every(name => !name.includes('..') && !name.startsWith('/') && !name.includes('\\')))
  assert.deepEqual(files['02-zalaczniki/Dowód.pdf'], firstAttachment)
  assert.deepEqual(files['02-zalaczniki/DOWÓD-2.PDF'], secondAttachment)
})

test('PDF bundle groups files by bank and encrypts every entry with an AES password', async () => {
  const sourceBytes = await blankPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'overlay',
    rendererVersion: 2,
    page: 1,
    box: { x: 40, y: 70, width: 220, height: 28 },
    coordinateSpace: {
      units: 'pt',
      referenceBox: 'media',
      origin: 'bottom-left',
      orientation: 'unrotated',
    },
    appearance: textAppearance,
  }, 'overlay')
  const password = '85010112345'
  const sharedBytes = new Uint8Array([7, 8, 9])

  const archive = await createPdfBundle(
    [{ fileName: 'wniosek.pdf', template, sourceBytes, directory: 'Erste Bank' }],
    fontBytes,
    { 'applicants.0.pesel': '12345678901' },
    [{ fileName: 'dowod.pdf', bytes: sharedBytes, directory: 'Wspólne' }],
    { password },
  )
  const reader = new ZipReader(new Uint8ArrayReader(archive))
  const entries = await reader.getEntries()
  const names = entries.map(entry => entry.filename)

  assert.ok(names.includes('Erste Bank/01-wnioski/uzupelniony-wniosek.pdf'))
  assert.ok(names.includes('Wspólne/02-dokumenty/dowod.pdf'))
  assert.ok(entries.every(entry => entry.encrypted))

  const sharedEntry = entries.find(entry => entry.filename === 'Wspólne/02-dokumenty/dowod.pdf')
  assert.ok(sharedEntry?.getData)
  await assert.rejects(
    sharedEntry.getData(new Uint8ArrayWriter(), { password: 'wrong-password' }),
  )
  assert.deepEqual(
    await sharedEntry.getData(new Uint8ArrayWriter(), { password }),
    sharedBytes,
  )
  await reader.close()
})
