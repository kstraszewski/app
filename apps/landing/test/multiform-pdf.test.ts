import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import fontkit from '@pdf-lib/fontkit'
import {
  ERSTE_TEMPLATE,
  ING_INCOME_CERTIFICATE_TEMPLATE,
  PEKAO_TEMPLATE,
  type DocumentTemplate,
  type PdfTextAppearance,
  type TemplateBinding,
  type TemplateTarget,
} from '@openexpert/multiform'
import {
  AnnotationFlags,
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  TextAlignment,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import { unzipSync } from 'fflate'
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js'

import {
  createPdfBundle,
  fillPdfTemplate,
  MultiformPdfValueError,
  UnsupportedMultiformFillMethodError,
} from '../server/utils/multiform-pdf.ts'
import { MULTIFORM_SINGLE_FIXTURE } from './fixtures/multiform-scenarios.ts'

const execFileAsync = promisify(execFile)

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
  bindingOverrides: Partial<Omit<TemplateBinding, 'target'>> = {},
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
      ...bindingOverrides,
      canonicalKey: bindingOverrides.canonicalKey ?? 'applicants.0.pesel',
      target,
      reviewStatus: bindingOverrides.reviewStatus ?? 'ready',
    }],
  }
}

async function blankPdf() {
  const pdf = await PDFDocument.create()
  pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  return pdf.save()
}

async function overlayPdfWithDocumentAndLinkActions() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  pdf.addJavaScript('reset-values', 'app.alert("reset")')

  const action = PDFDict.withContext(pdf.context)
  action.set(PDFName.of('S'), PDFName.of('JavaScript'))
  action.set(PDFName.of('JS'), PDFString.of('app.alert("link")'))
  const actionRef = pdf.context.register(action)
  pdf.catalog.set(PDFName.of('OpenAction'), actionRef)

  const link = PDFDict.withContext(pdf.context)
  link.set(PDFName.of('Type'), PDFName.of('Annot'))
  link.set(PDFName.of('Subtype'), PDFName.of('Link'))
  link.set(PDFName.of('Rect'), pdf.context.obj([10, 10, 80, 30]))
  link.set(PDFName.of('A'), actionRef)
  link.set(PDFName.of('AA'), pdf.context.obj({ E: actionRef }))
  page.node.addAnnot(pdf.context.register(link))
  return pdf.save()
}

async function hybridPdf() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  const field = pdf.getForm().createTextField('applicant.firstName')
  field.addToPage(page, { x: 40, y: 110, width: 140, height: 22 })
  return pdf.save()
}

test('deferred web form and API methods fail with a controlled renderer error', async () => {
  const sourceBytes = await blankPdf()
  const fontBytes = await fontBytesPromise
  const base = templateWithTarget({
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

  for (const kind of ['web_form', 'api'] as const) {
    const template = { ...base, fillMethod: { kind } }
    await assert.rejects(
      fillPdfTemplate(template, sourceBytes, fontBytes, {}),
      (error: unknown) => (
        error instanceof UnsupportedMultiformFillMethodError
        && error.fillMethod === kind
      ),
    )
  }
})

test('pdf_manual preserves the official form for hand completion and sanitizes active actions', async () => {
  const sourceBytes = await overlayPdfWithDocumentAndLinkActions()
  const template: DocumentTemplate = {
    schemaVersion: 2,
    id: 'manual-official-pdf',
    bank: 'mbank',
    label: 'Oficjalny formularz do uzupełnienia ręcznie',
    version: 1,
    fillMethod: { kind: 'pdf_manual' },
    source: {
      fileName: 'manual.pdf',
      sha256: 'a'.repeat(64),
      pageCount: 1,
      formKind: 'overlay',
      pages: [pageGeometry],
    },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 0,
      mappedTargetCount: 0,
      manualUserActionCount: 1,
    },
    bindings: [],
  }
  const outputBytes = await fillPdfTemplate(template, sourceBytes, new Uint8Array(), {})
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  const names = output.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  assert.equal(output.getPageCount(), 1)
  assert.equal(output.catalog.has(PDFName.of('OpenAction')), false)
  assert.equal(output.catalog.has(PDFName.of('AA')), false)
  assert.equal(names?.has(PDFName.of('JavaScript')) ?? false, false)
  for (const annotation of output.getPage(0).node.Annots()?.asArray() ?? []) {
    const dictionary = output.context.lookupMaybe(annotation, PDFDict)
    assert.equal(dictionary?.has(PDFName.of('A')) ?? false, false)
    assert.equal(dictionary?.has(PDFName.of('AA')) ?? false, false)
  }
})

test('pdf_manual preserves the sanitized official ING income derivative', async () => {
  const sourceBytes = await readFile(new URL(
    '../../../packages/database/data/mortgages/official-bank-file-assets/ing-zaswiadczenie-o-dochodach-2026-03-08-sanitized.pdf',
    import.meta.url,
  ))
  const outputBytes = await fillPdfTemplate(
    ING_INCOME_CERTIFICATE_TEMPLATE,
    sourceBytes,
    new Uint8Array(),
    {},
  )
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  const names = output.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)

  assert.equal(output.getPageCount(), 2)
  assert.equal(output.getForm().getFields().length, 42)
  assert.equal(output.catalog.has(PDFName.of('OpenAction')), false)
  assert.equal(output.catalog.has(PDFName.of('AA')), false)
  assert.equal(names?.has(PDFName.of('JavaScript')) ?? false, false)
})

test('renderer removes document JavaScript and actions from ordinary link annotations', async () => {
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
  const outputBytes = await fillPdfTemplate(
    template,
    await overlayPdfWithDocumentAndLinkActions(),
    await fontBytesPromise,
    { 'applicants.0.pesel': '12345678901' },
  )
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  const names = output.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  assert.equal(output.catalog.has(PDFName.of('OpenAction')), false)
  assert.equal(output.catalog.has(PDFName.of('AA')), false)
  assert.equal(names?.has(PDFName.of('JavaScript')) ?? false, false)
  for (const annotation of output.getPage(0).node.Annots()?.asArray() ?? []) {
    const dictionary = output.context.lookupMaybe(annotation, PDFDict)
    assert.equal(dictionary?.has(PDFName.of('A')) ?? false, false)
    assert.equal(dictionary?.has(PDFName.of('AA')) ?? false, false)
  }
})

test('pdf_hybrid keeps AcroForm native while rendering only the overlay into page content', async () => {
  const base = templateWithTarget({
    kind: 'acroform',
    field: 'applicant.firstName',
    fieldType: 'text',
    appearance: { ...textAppearance, letterSpacingPt: 0 },
  }, 'hybrid', { canonicalKey: 'applicants.0.firstName' })
  const template: DocumentTemplate = {
    ...base,
    fillMethod: { kind: 'pdf_hybrid' },
    coverage: { status: 'complete', inScopeTargetCount: 2, mappedTargetCount: 2 },
    bindings: [
      base.bindings[0]!,
      {
        canonicalKey: 'applicants.0.lastName',
        reviewStatus: 'ready',
        target: {
          kind: 'overlay',
          rendererVersion: 2,
          page: 1,
          box: { x: 40, y: 70, width: 140, height: 22 },
          coordinateSpace: {
            units: 'pt',
            referenceBox: 'media',
            origin: 'bottom-left',
            orientation: 'unrotated',
          },
          appearance: { ...textAppearance, letterSpacingPt: 0 },
        },
      },
    ],
  }
  const sourceBytes = await hybridPdf()
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const outputBytes = await fillPdfTemplate(template, sourceBytes, await fontBytesPromise, {
    'applicants.0.firstName': 'Ada',
    'applicants.0.lastName': 'Nowak',
  })
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  const field = output.getForm().getTextField('applicant.firstName')
  const widget = field.acroField.getWidgets()[0]
  assert.equal(field.getText(), 'Ada')
  assert.ok(widget)
  assertInteractiveWidget(widget)
  const sourceTextObjects = (decodedPageContent(source).match(/\bBT\b/g) ?? []).length
  const outputTextObjects = (decodedPageContent(output).match(/\bBT\b/g) ?? []).length
  assert.equal(outputTextObjects - sourceTextObjects, 1, 'only the overlay may add a page text object')
  const appendedContent = decodedPageContentStreams(output).at(-1) ?? ''
  assert.equal((appendedContent.match(/\bBT\b/g) ?? []).length, 1)
})

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

async function twoPageCombPdf() {
  const pdf = await PDFDocument.load(await combPdf())
  pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
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

async function checkboxPdf() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  const field = pdf.getForm().createCheckBox('decision.no')
  field.addToPage(page, {
    x: 40,
    y: 80,
    width: 18,
    height: 18,
  })
  return pdf.save()
}

async function textFieldPdf() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([pageGeometry.mediaBox.width, pageGeometry.mediaBox.height])
  const field = pdf.getForm().createTextField('computed.total')
  field.addToPage(page, {
    x: 40,
    y: 80,
    width: 180,
    height: 22,
  })
  return pdf.save()
}

function decodedPageContentStreams(pdf: PDFDocument, pageIndex = 0) {
  const contents = pdf.getPage(pageIndex).node.Contents()
  const objects = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
  return objects.map((object) => {
    const stream = pdf.context.lookup(object)
    if (!(stream instanceof PDFRawStream)) return ''
    return new TextDecoder().decode(decodePDFRawStream(stream).decode())
  })
}

function decodedPageContent(pdf: PDFDocument, pageIndex = 0) {
  return decodedPageContentStreams(pdf, pageIndex).join('\n')
}

function decodedNormalAppearanceStreams(
  pdf: PDFDocument,
  widget: PDFWidgetAnnotation,
) {
  const normal = widget.getAppearances()?.normal
  assert.ok(normal, 'widget should retain a normal appearance')
  const streams = normal instanceof PDFDict
    ? normal.keys().map(key => pdf.context.lookup(normal.get(key)))
    : [normal]

  return streams.map((stream) => {
    assert.ok(stream instanceof PDFRawStream, 'normal appearance should be a raw stream')
    return new TextDecoder().decode(decodePDFRawStream(stream).decode())
  })
}

function assertInteractiveWidget(widget: PDFWidgetAnnotation) {
  assert.equal(widget.hasFlag(AnnotationFlags.Invisible), false)
  assert.equal(widget.hasFlag(AnnotationFlags.Hidden), false)
  assert.equal(widget.hasFlag(AnnotationFlags.NoView), false)
  assert.equal(widget.hasFlag(AnnotationFlags.ReadOnly), false)
  assert.equal(widget.hasFlag(AnnotationFlags.LockedContents), false)
  assert.equal(widget.hasFlag(AnnotationFlags.Print), true)
}

function pgmPixels(bytes: Uint8Array) {
  let cursor = 0
  const nextToken = () => {
    while (cursor < bytes.length) {
      if (bytes[cursor] === 35) {
        while (cursor < bytes.length && bytes[cursor] !== 10) cursor += 1
      }
      if (bytes[cursor] === 9 || bytes[cursor] === 10 || bytes[cursor] === 13 || bytes[cursor] === 32) {
        cursor += 1
        continue
      }
      break
    }
    const start = cursor
    while (
      cursor < bytes.length
      && bytes[cursor] !== 9
      && bytes[cursor] !== 10
      && bytes[cursor] !== 13
      && bytes[cursor] !== 32
    ) cursor += 1
    return new TextDecoder().decode(bytes.subarray(start, cursor))
  }

  assert.equal(nextToken(), 'P5')
  const width = Number(nextToken())
  const height = Number(nextToken())
  assert.equal(nextToken(), '255')
  if (bytes[cursor] === 13 && bytes[cursor + 1] === 10) cursor += 2
  else cursor += 1
  const pixels = bytes.subarray(cursor)
  assert.equal(pixels.length, width * height)
  return pixels
}

async function renderFirstPageWidgetCrop(
  pdfBytes: Uint8Array,
  fieldName: string,
  directory: string,
  label: string,
) {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const widget = pdf.getForm().getField(fieldName).acroField.getWidgets()[0]
  assert.ok(widget)
  const rect = widget.getRectangle()
  const page = pdf.getPage(0)
  const dpi = 216
  const scale = dpi / 72
  const padding = 2
  const input = join(directory, `${label}.pdf`)
  const outputPrefix = join(directory, label)
  await writeFile(input, pdfBytes)
  await execFileAsync('pdftoppm', [
    '-f', '1',
    '-l', '1',
    '-singlefile',
    '-r', String(dpi),
    '-x', String(Math.floor((rect.x - padding) * scale)),
    '-y', String(Math.floor((page.getHeight() - rect.y - rect.height - padding) * scale)),
    '-W', String(Math.ceil((rect.width + padding * 2) * scale)),
    '-H', String(Math.ceil((rect.height + padding * 2) * scale)),
    '-gray',
    input,
    outputPrefix,
  ])
  return pgmPixels(await readFile(`${outputPrefix}.pgm`))
}

function rasterDistance(left: Uint8Array, right: Uint8Array) {
  assert.equal(left.length, right.length)
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    distance += Math.abs(left[index]! - right[index]!)
  }
  return distance
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

test('renderer v1 marks the false option of a conditioned boolean pair', async () => {
  const sourceBytes = await blankPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'overlay',
    rendererVersion: 1,
    page: 1,
    x: 40,
    y: 70,
    width: 18,
    height: 18,
    format: 'mark',
  }, 'overlay', {
    canonicalKey: 'loan.gracePeriod',
    condition: { canonicalKey: 'loan.gracePeriod', equals: 'false' },
  })

  const outputBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'loan.gracePeriod': false,
  })
  const content = decodedPageContent(await PDFDocument.load(outputBytes))

  assert.ok((content.match(/\bS\b/g) ?? []).length >= 2, 'selected false target should draw an X')
})

test('renderer v2 marks the false option but leaves an ordinary false checkbox empty', async () => {
  const sourceBytes = await blankPdf()
  const fontBytes = await fontBytesPromise
  const target = {
    kind: 'overlay',
    rendererVersion: 2,
    page: 1,
    box: { x: 40, y: 70, width: 18, height: 18 },
    coordinateSpace: {
      units: 'pt',
      referenceBox: 'media',
      origin: 'bottom-left',
      orientation: 'unrotated',
    },
    appearance: {
      kind: 'mark',
      role: 'checkbox',
      glyph: 'fill',
      color: { space: 'gray', value: 0 },
      opacity: 1,
      insetPt: 2,
      strokeWidthPt: 1,
    },
  } as const
  const pairedTemplate = templateWithTarget(target, 'overlay', {
    canonicalKey: 'loan.gracePeriod',
    condition: { canonicalKey: 'loan.gracePeriod', equals: 'false' },
  })
  const ordinaryTemplate = templateWithTarget(target, 'overlay', {
    canonicalKey: 'loan.gracePeriod',
  })

  const pairedOutput = await fillPdfTemplate(pairedTemplate, sourceBytes, fontBytes, {
    'loan.gracePeriod': false,
  })
  const ordinaryOutput = await fillPdfTemplate(ordinaryTemplate, sourceBytes, fontBytes, {
    'loan.gracePeriod': false,
  })

  assert.match(decodedPageContent(await PDFDocument.load(pairedOutput)), /\bf\b/)
  assert.doesNotMatch(decodedPageContent(await PDFDocument.load(ordinaryOutput)), /\bf\b/)
})

test('real Erste overlay marks Nie when grace period is false', async () => {
  const sourceBytes = await readFile(new URL('../../../mock-files/erste-wniosek-o-kredyt-hipoteczny-2026-07-20.pdf', import.meta.url))
  const sourcePdf = await PDFDocument.load(sourceBytes)
  const sourceStreamCount = decodedPageContentStreams(sourcePdf, 3).length
  const outputBytes = await fillPdfTemplate(ERSTE_TEMPLATE, sourceBytes, await fontBytesPromise, {
    'loan.gracePeriod': false,
  })
  const rendered = await PDFDocument.load(outputBytes)
  const appendedContent = decodedPageContentStreams(rendered, 3).slice(sourceStreamCount).join('\n')

  assert.ok((appendedContent.match(/\bS\b/g) ?? []).length >= 2, 'Erste Nie target should draw an X')
})

test('real Erste intermediary values render after their page-seven labels', async () => {
  const expectedBoxes = new Map([
    ['intermediary.email', { x: 252, y: 448, width: 277, height: 17 }],
    ['intermediary.phone', { x: 134, y: 464, width: 395, height: 17 }],
    ['intermediary.acceptingPerson', { x: 365, y: 481, width: 164, height: 17 }],
    ['intermediary.agentName', { x: 216, y: 521, width: 313, height: 17 }],
  ])
  for (const [canonicalKey, expectedBox] of expectedBoxes) {
    const target = ERSTE_TEMPLATE.bindings.find(binding => (
      binding.canonicalKey === canonicalKey && binding.target.kind === 'overlay'
    ))?.target
    assert.equal(target?.kind, 'overlay', canonicalKey)
    assert.deepEqual(
      target?.kind === 'overlay' && target.rendererVersion === 2 ? target.box : undefined,
      expectedBox,
      canonicalKey,
    )
  }

  const sourceBytes = await readFile(new URL(
    '../../../mock-files/erste-wniosek-o-kredyt-hipoteczny-2026-07-20.pdf',
    import.meta.url,
  ))
  const outputBytes = await fillPdfTemplate(ERSTE_TEMPLATE, sourceBytes, await fontBytesPromise, {
    'intermediary.kind': 'intermediary_or_partner',
    'intermediary.email': 'ekspert@example.test',
    'intermediary.phone': '+48 500 600 700',
    'intermediary.acceptingPerson': 'Marta Doradcza',
    'intermediary.agentName': 'Marta Doradcza',
  })
  const output = await PDFDocument.load(outputBytes)
  const appendedContent = decodedPageContentStreams(output, 6).at(-1) ?? ''

  assert.equal((appendedContent.match(/\bBT\b/g) ?? []).length, 3)
  for (const paddedX of [253.5, 135.5, 366.5]) {
    assert.match(appendedContent, new RegExp(`1 0 0 1 ${String(paddedX).replace('.', '\\.')} `))
  }

  const agentOutputBytes = await fillPdfTemplate(ERSTE_TEMPLATE, sourceBytes, await fontBytesPromise, {
    'intermediary.kind': 'bank_agent',
    'intermediary.email': 'should-not-render@example.test',
    'intermediary.agentName': 'Marta Doradcza',
  })
  const agentOutput = await PDFDocument.load(agentOutputBytes)
  const appendedAgentContent = decodedPageContentStreams(agentOutput, 6).at(-1) ?? ''
  assert.equal((appendedAgentContent.match(/\bBT\b/g) ?? []).length, 1)
  assert.match(appendedAgentContent, /1 0 0 1 217\.5 /)
})

test('real Erste 20.07.2026 overlay renders the current mortgage scenario on every data page', async () => {
  const sourceBytes = await readFile(new URL(
    '../../../mock-files/erste-wniosek-o-kredyt-hipoteczny-2026-07-20.pdf',
    import.meta.url,
  ))
  const outputBytes = await fillPdfTemplate(
    ERSTE_TEMPLATE,
    sourceBytes,
    await fontBytesPromise,
    MULTIFORM_SINGLE_FIXTURE.values,
  )
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })

  assert.equal(source.getPageCount(), 9)
  assert.equal(output.getPageCount(), 9)
  assert.equal(source.getForm().getFields().length, 0)
  assert.equal(output.getForm().getFields().length, 0)
  for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
    assert.notEqual(
      decodedPageContent(output, pageIndex),
      decodedPageContent(source, pageIndex),
      `page ${pageIndex + 1} must contain its scenario overlay`,
    )
  }
  assert.equal(
    decodedPageContent(output, 8),
    decodedPageContent(source, 8),
    'signature-only page 9 must remain unchanged',
  )
})

test('real Pekao source preserves canonical values and widget states for one applicant', async () => {
  const sourceBytes = await readFile(new URL(
    '../../../mock-files/pekao-wniosek-o-kredyt-mieszkaniowy.pdf',
    import.meta.url,
  ))
  const outputBytes = await fillPdfTemplate(
    PEKAO_TEMPLATE,
    sourceBytes,
    await fontBytesPromise,
    {
      'applicants.0.firstName': 'Michał',
      'applicants.0.lastName': 'Nowak',
      'applicants.0.targetPropertyOwner': true,
      'applicants.0.sharedHouseholdWithApplicantNumber': '1',
      'loan.productType': 'mortgage',
      'loan.purpose': 'purchase_primary',
      'loan.constructionPermitRequired': false,
      'property.address.city': 'Warszawa',
      'property.address.voivodeship': 'mazowieckie',
      'property.address.county': 'Warszawa',
      'property.address.municipality': 'Warszawa',
      'property.address.district': 'Mokotów',
      'property.address.postalCode': '02-654',
      'property.address.street': 'Puławska',
      'property.address.houseNumber': '12',
      'property.address.unitNumber': '7',
      'property.usableArea': 52.4,
      'property.constructionYear': 2019,
      'property.ownershipType': 'apartment_ownership',
      'property.ownershipSequence': 'first',
      'property.marketValue': 850_000,
      'property.landRegisterNumber': 'WA2M/00123456/7',
      'loan.amount': 650_000,
      'loan.currency': 'PLN',
      'loan.commissionType': 'not_applicable',
      'loan.cpiPremiumFinancing': 'no',
      'loan.termMonths': 300,
      'loan.repaymentDay': 10,
      'loan.installmentType': 'equal',
      'loan.interestType': 'variable',
      'investment.totalCost': 850_000,
      'investment.ownFundsPaid': 200_000,
      'property.appraisalSource': 'bank_provider',
      'additionalProducts.cpiInterested': false,
      'declarations.art17Information': true,
      'declarations.selectedLoanRiskVariant': 'variable_interest',
      'declarations.sellerIsCloseRelative': false,
      'consents.earlyCreditDecision': true,
      'consents.receiveContractDraft': true,
      'consents.creditDecisionByEmail': true,
      'consents.creditDecisionEmail': 'michal.nowak@example.local',
      'notifications.email': true,
      'application.place': 'Warszawa',
      'application.date': '2026-08-09',
    },
  )
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  const form = output.getForm()

  assert.equal(output.getPageCount(), 6)
  assert.equal(form.getTextField('Text Field 4').getText(), 'Michał')
  assert.equal(form.getTextField('Text Field 13').getText(), 'Nowak')
  assert.equal(form.getTextField('Text Field 36').getText(), '12/7')
  assert.equal(form.getTextField('Text Field 119').getText(), 'Warszawa, 09.08.2026')
  assert.equal(form.getTextField('Text Field 15').getText(), undefined)
  for (const widget of form.getTextField('Text Field 15').acroField.getWidgets()) {
    assertInteractiveWidget(widget)
    assert.ok(decodedNormalAppearanceStreams(output, widget).every(value => value.length > 0))
  }
  for (const binding of PEKAO_TEMPLATE.bindings) {
    if (binding.target.kind !== 'acroform') continue
    for (const widget of form.getField(binding.target.field).acroField.getWidgets()) {
      assertInteractiveWidget(widget)
    }
  }

  const checkboxState = (fieldName: string) => {
    const field = form.getCheckBox(fieldName)
    const widget = field.acroField.getWidgets()[0]!
    return {
      value: field.acroField.dict.get(PDFName.of('V'))?.toString(),
      appearanceState: widget.dict.get(PDFName.of('AS'))?.toString(),
      hidden: widget.hasFlag(AnnotationFlags.Hidden),
    }
  }
  const selected = { value: '/Yes', appearanceState: '/Yes', hidden: false }
  const clear = { value: '/Off', appearanceState: '/Off', hidden: false }

  assert.deepEqual(checkboxState('C5'), selected)
  assert.deepEqual(checkboxState('C6'), clear)
  assert.deepEqual(checkboxState('C28'), clear)
  assert.deepEqual(checkboxState('C29'), selected)
  assert.deepEqual(checkboxState('C42'), selected)
  assert.deepEqual(checkboxState('C43'), clear)
  assert.deepEqual(checkboxState('C104'), selected)
  assert.deepEqual(checkboxState('C103'), clear)
  assert.deepEqual(checkboxState('C47'), selected)
  assert.deepEqual(checkboxState('C48'), clear)
  assert.deepEqual(checkboxState('C88'), selected)
  assert.deepEqual(checkboxState('C89'), clear)
  assert.deepEqual(checkboxState('C90'), clear)
  assert.deepEqual(checkboxState('C91'), clear)
  assert.deepEqual(checkboxState('C92'), selected)
})

test('real Pekao fields remain editable after save/reopen and an unchecked raster has no stale mark', async (t) => {
  try {
    await execFileAsync('pdftoppm', ['-v'])
  }
  catch {
    t.skip('pdftoppm is required for the AcroForm raster regression')
    return
  }

  const sourceBytes = await readFile(new URL(
    '../../../mock-files/pekao-wniosek-o-kredyt-mieszkaniowy.pdf',
    import.meta.url,
  ))
  const fontBytes = await fontBytesPromise
  const filledBytes = await fillPdfTemplate(PEKAO_TEMPLATE, sourceBytes, fontBytes, {
    'applicants.0.firstName': 'Michał',
    'loan.productType': 'mortgage',
  })
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const filled = await PDFDocument.load(filledBytes, { updateMetadata: false })
  const filledForm = filled.getForm()
  const editableText = filledForm.getTextField('Text Field 4')
  assert.equal(filledForm.getCheckBox('C5').isChecked(), true)
  assert.equal(filledForm.getCheckBox('C6').isChecked(), false)
  assert.match(
    editableText.acroField.getDefaultAppearance() ?? '',
    /\/[^\s]+\s+0\s+Tf/,
    'generated text fields must leave /DA at font-size 0 for viewer auto-fit after editing',
  )
  assert.equal(
    decodedPageContent(filled, 0),
    decodedPageContent(source, 0),
    'AcroForm filling must not append a static name or checkbox mark to the page',
  )

  filled.registerFontkit(fontkit)
  const editFont = await filled.embedFont(fontBytes, { subset: true })
  filledForm.getCheckBox('C5').uncheck()
  filledForm.getCheckBox('C6').check()
  filledForm.getTextField('Text Field 4').setText('Aleksandra Marianna')
  filledForm.updateFieldAppearances(editFont)
  const editedBytes = await filled.save({ updateFieldAppearances: false })
  const reopened = await PDFDocument.load(editedBytes, { updateMetadata: false })
  const reopenedForm = reopened.getForm()

  assert.equal(reopenedForm.getCheckBox('C5').isChecked(), false)
  assert.equal(reopenedForm.getCheckBox('C6').isChecked(), true)
  assert.equal(reopenedForm.getTextField('Text Field 4').getText(), 'Aleksandra Marianna')
  for (const fieldName of ['C5', 'C6']) {
    const widget = reopenedForm.getCheckBox(fieldName).acroField.getWidgets()[0]
    assert.ok(widget)
    assertInteractiveWidget(widget)
    assert.ok(decodedNormalAppearanceStreams(reopened, widget).every(value => value.length > 0))
  }

  const directory = await mkdtemp(join(tmpdir(), 'multiform-pekao-raster-'))
  try {
    const sourceOff = await renderFirstPageWidgetCrop(sourceBytes, 'C5', directory, 'source-off')
    const filledOn = await renderFirstPageWidgetCrop(filledBytes, 'C5', directory, 'filled-on')
    const editedOff = await renderFirstPageWidgetCrop(editedBytes, 'C5', directory, 'edited-off')
    const sourceToSelected = rasterDistance(sourceOff, filledOn)
    const sourceToEditedOff = rasterDistance(sourceOff, editedOff)

    assert.ok(sourceToSelected > 0, 'selected C5 must be visible in the raster')
    assert.ok(
      sourceToEditedOff < sourceToSelected,
      'after unchecking C5, its raster must return closer to the blank source than to the selected state',
    )
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('AcroForm value stays editable in a visible printable widget without static page duplication', async () => {
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
  assertInteractiveWidget(widget)
  assert.equal(
    (decodedPageContent(rendered).match(/\bBT\b/g) ?? []).length,
    0,
    'native AcroForm text must not be baked into the page content stream',
  )
  assert.ok(
    decodedNormalAppearanceStreams(rendered, widget).some(appearance => /\b(?:BT|Tj|TJ)\b/.test(appearance)),
    'the editable widget must retain a non-empty text appearance',
  )
})

test('AcroForm placement override moves the native widget on its original page', async () => {
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

  assert.notDeepEqual(widgetRect, sourceWidgetRect)
  assert.deepEqual(widgetRect, { x: 120, y: 30, width: 150, height: 24 })
  assert.ok(widget)
  assertInteractiveWidget(widget)
  assert.doesNotMatch(decodedPageContent(rendered), /1 0 0 1 120(?:\.0+)? /)
  assert.ok(decodedNormalAppearanceStreams(rendered, widget).some(value => /\bBT\b/.test(value)))
})

test('AcroForm placement override rejects moving a widget between pages', async () => {
  const template = templateWithTarget({
    kind: 'acroform',
    field: 'applicant.pesel',
    fieldType: 'text',
    placementOverrides: [{
      widgetIndex: 0,
      page: 2,
      box: { x: 40, y: 80, width: 220, height: 24 },
      coordinateSpace: {
        units: 'pt',
        referenceBox: 'media',
        origin: 'bottom-left',
        orientation: 'unrotated',
      },
    }],
  }, 'acroform')

  await assert.rejects(
    fillPdfTemplate(template, await twoPageCombPdf(), await fontBytesPromise, {
      'applicants.0.pesel': '12345678901',
    }),
    /pomiędzy stronami nie jest obsługiwane/,
  )
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
    (error: unknown) => {
      assert.ok(error instanceof MultiformPdfValueError)
      assert.equal(error.canonicalKey, 'applicants.0.pesel')
      assert.equal(error.message, 'Wartość jest zbyt długa dla pola formularza bankowego.')
      return true
    },
  )
})

test('radio export value is mapped to the matching editable widget on-value', async () => {
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
  widgets.forEach(assertInteractiveWidget)
  assert.doesNotMatch(decodedPageContent(rendered), /\bf\b/)
  assert.ok(widgets.every(widget => decodedNormalAppearanceStreams(rendered, widget).length > 0))
})

test('checkbox valueMap selects the matching false option regardless of its export-value spelling', async () => {
  const sourceBytes = await checkboxPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'acroform',
    field: 'decision.no',
    fieldType: 'checkbox',
    valueMap: { false: 'nie' },
  }, 'acroform', { canonicalKey: 'loan.gracePeriod' })

  const selectedBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'loan.gracePeriod': false,
  })
  const selected = await PDFDocument.load(selectedBytes)
  assert.equal(selected.getForm().getCheckBox('decision.no').isChecked(), true)

  const unselectedBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'loan.gracePeriod': true,
  })
  const unselected = await PDFDocument.load(unselectedBytes)
  assert.equal(unselected.getForm().getCheckBox('decision.no').isChecked(), false)
})

test('computed currency bindings keep their canonical currency formatting', async () => {
  const sourceBytes = await textFieldPdf()
  const fontBytes = await fontBytesPromise
  const template = templateWithTarget({
    kind: 'acroform',
    field: 'computed.total',
    fieldType: 'text',
  }, 'acroform', {
    canonicalKey: 'investment.engagedOwnFundsTotal',
    computed: true,
    valueFrom: ['investment.ownFundsPaid', 'investment.landValue'],
    valueFormat: 'currency.sum',
  })

  const outputBytes = await fillPdfTemplate(template, sourceBytes, fontBytes, {
    'investment.ownFundsPaid': 80_000,
    'investment.landValue': 60_000,
  })
  const rendered = await PDFDocument.load(outputBytes)
  const text = rendered.getForm().getTextField('computed.total').getText() ?? ''
  assert.equal(text.replace(/[\s\u00a0\u202f]/g, ''), '140000,00')
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
