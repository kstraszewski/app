import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'

import {
  instantiateTemplate,
  ING_TEMPLATES,
  prepareBundle,
  resolveTemplateFillMethod,
  templateInstanceIndexes,
  templateMatchesValues,
} from '@openexpert/multiform'
import { unzipSync } from 'fflate'
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'

import { createPdfBundle, fillPdfTemplate } from '../server/utils/multiform-pdf.ts'

const root = new URL('../../../', import.meta.url)
const mockDirectory = new URL('mock-files/', root)
const catalogUrl = new URL('packages/database/data/mortgages/pl-2026-07-12.json', root)
const outputDirectory = new URL('output/pdf/ing-complete-package-test/', root)

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function identityEvidencePdf() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595.32, 841.92])
  page.drawText('QA evidence placeholder - identity document - Jan Kowalski', {
    x: 54,
    y: 780,
    size: 12,
    font,
  })
  return pdf.save()
}

test('ING one-applicant employment package contains every public initial PDF without inventing an application', async () => {
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8')) as {
    products: Array<{
      bank: { slug: string }
      version: {
        documentRequirements: Array<{ code: string, itemKind: string, templateId?: string }>
        multiformTemplateIds: string[]
      }
    }>
  }
  const product = catalog.products.find(candidate => candidate.bank.slug === 'ing')
  assert.ok(product)

  const values = {
    'applicants.0.incomeSource': 'employment',
    'property.appraisalSource': 'bank_provider',
  }
  const bundle = prepareBundle(product.version.multiformTemplateIds)
  assert.deepEqual(bundle.warnings, [])

  const templates = bundle.documents.flatMap(template => (
    templateInstanceIndexes(template, { applicants: 1 })
      .map(index => instantiateTemplate(template, index))
      .filter(instance => templateMatchesValues(instance, values))
  ))
  assert.deepEqual(templates.map(template => template.id), [
    'ing-income-certificate-2026-03-08',
    'ing-general-mortgage-information-2026-05-31',
  ])
  assert.deepEqual(templates.map(template => resolveTemplateFillMethod(template).kind), [
    'pdf_manual',
    'pdf_readonly',
  ])

  const documents = await Promise.all(templates.map(async template => {
    const sourceBytes = await readFile(new URL(template.source.fileName, mockDirectory))
    assert.equal(sha256(sourceBytes), template.source.sha256)
    return {
      fileName: template.source.fileName,
      template,
      sourceBytes,
      directory: 'ING Bank Slaski',
    }
  }))
  const identityBytes = await identityEvidencePdf()
  const zipBytes = await createPdfBundle(
    documents,
    new Uint8Array(),
    values,
    [{
      fileName: 'jan-kowalski-dokument-tozsamosci.pdf',
      bytes: identityBytes,
      mimeType: 'application/pdf',
      directory: 'ING Bank Slaski',
    }],
  )
  const files = unzipSync(zipBytes)
  const names = Object.keys(files).sort()
  assert.deepEqual(names, [
    'ING Bank Slaski/01-wnioski/ing-informacje-ogolne-kredyt-hipoteczny-2026-05-31-sanitized.pdf',
    'ING Bank Slaski/01-wnioski/ing-zaswiadczenie-o-dochodach-2026-03-08-sanitized.pdf',
    'ING Bank Slaski/02-dokumenty/jan-kowalski-dokument-tozsamosci.pdf',
  ])
  assert.equal(names.some(name => /wniosek-o-kredyt/i.test(name)), false)

  const incomeName = names.find(name => name.includes('zaswiadczenie-o-dochodach'))
  assert.ok(incomeName)
  const incomePdf = await PDFDocument.load(files[incomeName]!, { updateMetadata: false })
  const namesDictionary = incomePdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  assert.equal(incomePdf.getPageCount(), 2)
  assert.equal(incomePdf.getForm().getFields().length, 42)
  assert.equal(incomePdf.catalog.has(PDFName.of('OpenAction')), false)
  assert.equal(incomePdf.catalog.has(PDFName.of('AA')), false)
  assert.equal(namesDictionary?.has(PDFName.of('JavaScript')) ?? false, false)

  const application = product.version.documentRequirements.find(requirement => (
    requirement.code === 'ing_mortgage_application_flow'
  ))
  assert.ok(application)
  assert.equal(application.itemKind, 'manual_action')
  assert.equal(application.templateId, undefined)

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(new URL('ing-one-applicant-employment-public-stage.zip', outputDirectory), zipBytes)
  await writeFile(new URL('qa-report.json', outputDirectory), `${JSON.stringify({
    scenario: 'one applicant, employment income, secondary-market property with land register, ING-provided appraisal',
    status: 'pass',
    archiveSha256: sha256(zipBytes),
    files: names,
    publicBankPdfs: 2,
    clientEvidenceFiles: 1,
    manualBankOwnedSteps: [
      'mortgage application: web_form in Moje ING when eligible, otherwise manual_action with ING adviser',
      'applicant data and consents: bank-owned flow',
      'land-register verification: external_check',
      'ING-provided appraisal: manual_action',
    ],
    intentionallyAbsent: [
      'synthetic public mortgage-application PDF',
      'own-appraisal guidelines and appraiser statement',
      'business-income form',
      'post-submission application supplement',
    ],
  }, null, 2)}\n`)
})

test('all eight ING runtime PDFs pass the production fill path without encryption or active actions', async () => {
  const expectedFieldCounts = new Map([
    ['ing-income-certificate-2026-03-08', 42],
    ['ing-business-form-2015-11-09', 0],
    ['ing-general-mortgage-information-2026-05-31', 0],
    ['ing-appraisal-guidelines-2026-08-09', 0],
    ['ing-appraiser-conflict-statement-2026-05-31', 4],
    ['ing-mortgage-application-supplement-2025-09-30', 11],
    ['ing-lato-u-siebie-rules-2026', 0],
    ['ing-energy-efficient-home-rules-2026', 0],
  ])
  assert.equal(ING_TEMPLATES.length, expectedFieldCounts.size)

  for (const template of ING_TEMPLATES) {
    assert.match(template.source.fileName, /-sanitized\.pdf$/)
    const sourceBytes = await readFile(new URL(template.source.fileName, mockDirectory))
    assert.equal(sha256(sourceBytes), template.source.sha256)

    const outputBytes = await fillPdfTemplate(template, sourceBytes, new Uint8Array(), {})
    const outputPdf = await PDFDocument.load(outputBytes, { updateMetadata: false })
    const names = outputPdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    assert.equal(outputPdf.getPageCount(), template.source.pageCount, template.id)
    assert.equal(outputPdf.getForm().getFields().length, expectedFieldCounts.get(template.id), template.id)
    assert.equal(outputPdf.catalog.has(PDFName.of('OpenAction')), false, template.id)
    assert.equal(outputPdf.catalog.has(PDFName.of('AA')), false, template.id)
    assert.equal(names?.has(PDFName.of('JavaScript')) ?? false, false, template.id)
    for (const page of outputPdf.getPages()) {
      for (const annotation of page.node.Annots()?.asArray() ?? []) {
        const dictionary = outputPdf.context.lookupMaybe(annotation, PDFDict)
        assert.equal(dictionary?.has(PDFName.of('A')) ?? false, false, template.id)
        assert.equal(dictionary?.has(PDFName.of('AA')) ?? false, false, template.id)
      }
    }
  }
})
