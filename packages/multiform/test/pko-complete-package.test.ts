import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
} from 'pdf-lib'

import {
  instantiateTemplate,
  templateMatchesValues,
  validateTemplateJson,
} from '../src/index.ts'
import {
  PKO_CASE_REQUIREMENTS,
  PKO_MISSING_CANONICAL_KEYS,
  PKO_OFFICIAL_PACKAGE_DOCUMENTS,
  type PkoOfficialPackageDocument,
} from '../src/templates/pko-complete-package-catalog.ts'
import {
  PKO_DIGITAL_INFORMATION_TEMPLATES,
  PKO_POST_CONTRACT_TEMPLATES,
  PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES,
} from '../src/templates/pko-supplemental.ts'
import { PKO_TEMPLATE } from '../src/templates/pko.ts'

const officialDirectory = fileURLToPath(new URL(
  '../../database/data/mortgages/official-bank-file-assets/',
  import.meta.url,
))
const mockDirectory = fileURLToPath(new URL('../../../mock-files/', import.meta.url))
const fieldAuditPath = fileURLToPath(new URL(
  '../src/templates/pko-package-field-audit.json',
  import.meta.url,
))
const officialManifestPath = fileURLToPath(new URL(
  '../../database/data/mortgages/official-bank-files.json',
  import.meta.url,
))
const productCatalogPath = fileURLToPath(new URL(
  '../../database/data/mortgages/pl-2026-07-12.json',
  import.meta.url,
))

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertOfficialPkoUrl(value: string) {
  const url = new URL(value)
  assert.equal(url.protocol, 'https:')
  assert.ok(
    url.hostname === 'pkobp.pl'
      || url.hostname.endsWith('.pkobp.pl')
      || url.hostname === 'pkobh.pl'
      || url.hostname.endsWith('.pkobh.pl'),
    `${value} must use an official PKO BP / PKO BH host`,
  )
}

function inspectPdfActions(pdf: PDFDocument) {
  const actionTypes: string[] = []
  const scripts: string[] = []

  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict
      ? object
      : object instanceof PDFRawStream
        ? object.dict
        : undefined
    if (!dict) continue

    const actionType = dict.lookup(PDFName.of('S'))
    if (!(actionType instanceof PDFName)) continue
    const name = actionType.decodeText()
    if (name !== 'JavaScript') {
      actionTypes.push(name)
      continue
    }

    const script = dict.lookup(PDFName.of('JS'))
    if (script instanceof PDFString || script instanceof PDFHexString) {
      scripts.push(script.decodeText())
    }
    else if (script instanceof PDFRawStream) {
      scripts.push(new TextDecoder().decode(decodePDFRawStream(script).decode()))
    }
  }

  return { actionTypes, scripts }
}

test('PKO supplemental templates validate and keep initial, digital and post-contract stages separate', () => {
  assert.equal(PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES.length, 19)
  assert.equal(PKO_DIGITAL_INFORMATION_TEMPLATES.length, 5)
  assert.equal(PKO_POST_CONTRACT_TEMPLATES.length, 1)

  const initialIds = new Set(PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES.map(template => template.id))
  const digitalIds = new Set(PKO_DIGITAL_INFORMATION_TEMPLATES.map(template => template.id))
  const postContractIds = new Set(PKO_POST_CONTRACT_TEMPLATES.map(template => template.id))
  assert.equal([...digitalIds].some(id => initialIds.has(id)), false)
  assert.equal([...postContractIds].some(id => initialIds.has(id)), false)

  const allTemplates = [
    ...PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES,
    ...PKO_DIGITAL_INFORMATION_TEMPLATES,
    ...PKO_POST_CONTRACT_TEMPLATES,
  ]
  assert.equal(new Set(allTemplates.map(template => template.id)).size, allTemplates.length)

  for (const template of allTemplates) {
    const validation = validateTemplateJson(template)
    assert.equal(validation.valid, true, `${template.id}: ${JSON.stringify(validation.errors)}`)
    assert.equal(validation.fillReady, true, template.id)
    assert.ok(
      template.fillMethod?.kind === 'pdf_manual' || template.fillMethod?.kind === 'pdf_readonly',
      template.id,
    )
    assert.equal(template.bindings.length, 0, template.id)
  }
})

test('PKO official PDF catalogue is byte-pinned, mirrored and page-count reviewed', async () => {
  let assetCount = 0

  for (const document of PKO_OFFICIAL_PACKAGE_DOCUMENTS as readonly PkoOfficialPackageDocument[]) {
    assertOfficialPkoUrl(document.sourcePageUrl)
    if (!document.asset) {
      assert.equal(document.method, 'web_form', document.id)
      continue
    }

    assetCount += 1
    assertOfficialPkoUrl(document.asset.downloadUrl)
    const [officialBytes, mockBytes] = await Promise.all([
      readFile(`${officialDirectory}${document.asset.fileName}`),
      readFile(`${mockDirectory}${document.asset.fileName}`),
    ])
    assert.equal(sha256(officialBytes), document.asset.sha256, document.id)
    assert.deepEqual(mockBytes, officialBytes, `${document.id}: mock mirror differs`)

    const pdf = await PDFDocument.load(officialBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    })
    assert.equal(pdf.getPageCount(), document.asset.pageCount, document.id)
  }

  assert.equal(assetCount, 26)
})

test('PKO runtime PDFs are published in the official bank-file manifest with exact source metadata', async () => {
  const manifest = JSON.parse(await readFile(officialManifestPath, 'utf8')) as Array<{
    bankSlug: string
    fileName: string
    sha256: string
    downloadUrl: string
    sourcePageUrl: string
    pageCount: number
  }>
  const byFileName = new Map(manifest.map(entry => [entry.fileName, entry]))
  const pkoEntries = manifest.filter(entry => entry.bankSlug === 'pko-bp')
  const packageAssets = (PKO_OFFICIAL_PACKAGE_DOCUMENTS as readonly PkoOfficialPackageDocument[]).flatMap(document => (
    document.asset ? [document.asset] : []
  ))

  assert.equal(pkoEntries.length, 26)
  assert.equal(pkoEntries.reduce((sum, entry) => sum + entry.pageCount, 0), 88)
  assert.deepEqual(
    new Set(pkoEntries.map(entry => entry.fileName)),
    new Set(packageAssets.map(asset => asset.fileName)),
  )
  assert.equal(new Set(pkoEntries.map(entry => entry.sha256)).size, pkoEntries.length)

  for (const document of PKO_OFFICIAL_PACKAGE_DOCUMENTS as readonly PkoOfficialPackageDocument[]) {
    if (!document.asset) continue
    const entry = byFileName.get(document.asset.fileName)
    assert.ok(entry, document.asset.fileName)
    assert.equal(entry.bankSlug, 'pko-bp', document.id)
    assert.equal(entry.sha256, document.asset.sha256, document.id)
    assert.equal(entry.downloadUrl, document.asset.downloadUrl, document.id)
    assert.equal(entry.sourcePageUrl, document.sourcePageUrl, document.id)
    assert.equal(entry.pageCount, document.asset.pageCount, document.id)
  }
})

test('PKO two-applicant Własny Kąt package resolves to 12 intentional PDFs and 36 pages', async () => {
  const values = {
    'loan.pkoRoute': 'dual_pko_bh_first',
    'loan.interestType': 'periodically_fixed',
    'loan.program': 'standard',
    'applicants.0.employmentEvidenceType': 'self_declaration',
    'applicants.1.employmentEvidenceType': 'self_declaration',
  }
  const templates = [PKO_TEMPLATE, ...PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES]
  const instances = templates.flatMap(template => (
    template.repeatFor
      ? [instantiateTemplate(template, 0), instantiateTemplate(template, 1)]
      : [template]
  ))
  const selected = instances.filter(template => templateMatchesValues(template, values))

  assert.deepEqual(selected.map(template => template.id), [
    'pko-bp-mortgage-2022',
    'pko-bp-applicant-data-2026-05-21',
    'pko-bp-applicant-data-2026-05-21',
    'pko-bp-employment-declaration-current-2026-08-09',
    'pko-bp-employment-declaration-current-2026-08-09',
    'pko-bp-risk-information-current-2026-08-09',
    'pko-bp-general-mortgage-information-current-2026-08-09',
    'pko-bh-general-mortgage-information-current-2026-08-09',
    'pko-bp-benchmark-fallback-current-2026-08-09',
    'pko-bh-benchmark-fallback-current-2026-08-09',
    'pko-bp-interest-types-current-2026-08-09',
    'pko-bp-fixed-rate-information-current-2026-08-09',
  ])
  assert.equal(selected.length, 12)
  assert.equal(selected.reduce((sum, template) => sum + template.source.pageCount, 0), 36)

  for (const template of selected) {
    const bytes = await readFile(`${officialDirectory}${template.source.fileName}`)
    assert.equal(sha256(bytes), template.source.sha256, template.label)
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    assert.equal(pdf.getPageCount(), template.source.pageCount, template.label)
  }
})

test('PKO package has no byte duplicates, embedded payloads or dangerous PDF actions', async () => {
  const documents = (PKO_OFFICIAL_PACKAGE_DOCUMENTS as readonly PkoOfficialPackageDocument[]).filter(
    document => document.asset,
  )
  const hashes = new Set<string>()
  const dangerousActionTypes = new Set([
    'GoToR',
    'ImportData',
    'Launch',
    'Movie',
    'Rendition',
    'Sound',
    'SubmitForm',
  ])
  const dangerousJavaScript = /(?:app\.launchURL|app\.openDoc|collab\.collectEmailInfo|eval\s*\(|exportDataObject|importDataObject|mailDoc|mailForm|net\.(?:http|soap)|submitForm|util\.readFileIntoStream)/i

  for (const document of documents) {
    const asset = document.asset!
    assert.equal(hashes.has(asset.sha256), false, `${asset.fileName}: duplicate bytes`)
    hashes.add(asset.sha256)

    const bytes = await readFile(`${officialDirectory}${asset.fileName}`)
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    assert.equal(names?.has(PDFName.of('EmbeddedFiles')) ?? false, false, asset.fileName)

    const { actionTypes, scripts } = inspectPdfActions(pdf)
    for (const actionType of actionTypes) {
      assert.equal(dangerousActionTypes.has(actionType), false, `${asset.fileName}: ${actionType}`)
    }
    for (const script of scripts) {
      assert.doesNotMatch(script, dangerousJavaScript, asset.fileName)
    }
  }

  assert.equal(hashes.size, 26)
})

test('PKO product catalogue exposes the complete adviser package and does not require a client operat', async () => {
  const catalog = JSON.parse(await readFile(productCatalogPath, 'utf8')) as {
    products: Array<{
      bank: { slug: string }
      version: {
        documentRequirements: Array<{
          code: string
          itemKind: string
          templateId?: string
        }>
        multiformTemplateIds: string[]
      }
    }>
  }
  const product = catalog.products.find(entry => entry.bank.slug === 'pko-bp')
  assert.ok(product)

  const expectedTemplateIds = new Set([
    'pko-bp-mortgage-2022',
    ...PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES.map(template => template.id),
  ])
  assert.deepEqual(new Set(product.version.multiformTemplateIds), expectedTemplateIds)
  assert.equal(
    product.version.multiformTemplateIds.some(id => (
      PKO_DIGITAL_INFORMATION_TEMPLATES.some(template => template.id === id)
      || PKO_POST_CONTRACT_TEMPLATES.some(template => template.id === id)
    )),
    false,
  )

  const valuation = product.version.documentRequirements.find(requirement => (
    requirement.code === 'valuation.bank_assessment'
  ))
  assert.ok(valuation)
  assert.equal(valuation.itemKind, 'external_check')
  assert.equal(
    product.version.documentRequirements.some(requirement => (
      requirement.code === 'valuation.appraisal_report' && requirement.itemKind === 'client_document'
    )),
    false,
  )
})

test('PKO active supplementary forms retain a complete exact field snapshot', async () => {
  const audit = JSON.parse(await readFile(fieldAuditPath, 'utf8')) as {
    auditedAt: string
    documents: Array<{
      fileName: string
      fieldCount: number
      customerFieldCount: number
      technicalFieldCount: number
      fields: Array<{ name: string }>
    }>
  }

  assert.equal(audit.auditedAt, '2026-08-09')
  const expected = new Map<string, readonly [number, number, number]>([
    ['pko-bp-dane-wnioskodawcy-2026-05-21.pdf', [107, 89, 18]],
    ['pko-bp-zobowiazania-do-splaty-2025-09-30.pdf', [68, 59, 9]],
    ['pko-bp-oproznione-miejsce-hipoteczne-2025-05-13.pdf', [42, 31, 11]],
    ['pko-bp-posiadane-nieruchomosci-2025-05-13.pdf', [45, 37, 8]],
    ['pko-bp-kosztorys-dom-2025-07-31.pdf', [141, 127, 14]],
    ['pko-bp-kosztorys-lokal-2024-04-15.pdf', [63, 51, 12]],
  ])

  assert.equal(audit.documents.length, expected.size)
  for (const document of audit.documents) {
    const counts = expected.get(document.fileName)
    assert.ok(counts, document.fileName)
    assert.deepEqual(
      [document.fieldCount, document.customerFieldCount, document.technicalFieldCount],
      counts,
      document.fileName,
    )
    assert.equal(document.fields.length, document.fieldCount, document.fileName)
    assert.equal(new Set(document.fields.map(field => field.name)).size, document.fieldCount, document.fileName)
  }
})

test('PKO applicant and RKM documents repeat and filter without leaking between applicants', () => {
  const applicantTemplate = PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES.find(template => (
    template.id === 'pko-bp-applicant-data-2026-05-21'
  ))
  const employmentTemplate = PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES.find(template => (
    template.id === 'pko-bp-employment-declaration-current-2026-08-09'
  ))
  const rkmTemplate = PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES.find(template => (
    template.id === 'pko-bp-rkm-eligibility-declaration-2026-07-10'
  ))
  assert.ok(applicantTemplate)
  assert.ok(employmentTemplate)
  assert.ok(rkmTemplate)

  const values = {
    'loan.program': 'rkm',
    'applicants.0.employmentEvidenceType': 'self_declaration',
    'applicants.1.employmentEvidenceType': 'employer_certificate',
  }
  assert.equal(templateMatchesValues(instantiateTemplate(applicantTemplate, 0), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(applicantTemplate, 1), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(employmentTemplate, 0), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(employmentTemplate, 1), values), false)
  assert.equal(templateMatchesValues(instantiateTemplate(rkmTemplate, 0), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(rkmTemplate, 1), values), true)
})

test('PKO checklist covers transaction, income, valuation, bank-generated and post-contract branches', () => {
  const ids = new Set<string>(PKO_CASE_REQUIREMENTS.map(requirement => requirement.id))
  for (const id of [
    'pko-identity-verification',
    'pko-income-evidence',
    'pko-income-public-arrears-evidence',
    'pko-secondary-market-transaction-documents',
    'pko-primary-market-transaction-documents',
    'pko-construction-legal-documents',
    'pko-refinance-creditor-documents',
    'pko-land-register-check',
    'pko-property-valuation',
    'pko-personalized-esis',
    'pko-credit-decision-and-contract',
    'pko-notarial-sale-deed',
    'pko-mortgage-court-filing',
    'pko-property-insurance-assignment',
    'pko-construction-completion-evidence',
    'pko-energy-certificate-green-margin',
  ]) {
    assert.ok(ids.has(id), `missing PKO requirement ${id}`)
  }

  const valuation = PKO_CASE_REQUIREMENTS.find(requirement => requirement.id === 'pko-property-valuation')
  assert.ok(valuation)
  assert.equal(valuation.method, 'bank_generated')
  assert.match(valuation.notes.join(' '), /nie wymaga operatu klienta/i)

  const energyCertificate = PKO_CASE_REQUIREMENTS.find(requirement => (
    requirement.id === 'pko-energy-certificate-green-margin'
  ))
  assert.ok(energyCertificate)
  assert.equal(energyCertificate.stage, 'post_contract')
  assert.equal(energyCertificate.blocksApplication, false)
})

test('PKO canonical gap manifest contains the routing keys needed before active annex mapping', () => {
  assert.ok(PKO_MISSING_CANONICAL_KEYS.packageRouting.includes('application.submissionChannel'))
  assert.ok(PKO_MISSING_CANONICAL_KEYS.packageRouting.includes('loan.pkoRoute'))
  assert.ok(PKO_MISSING_CANONICAL_KEYS.applicantAnnex.includes('applicants.*.identityDocumentExpiryDate'))
  assert.ok(PKO_MISSING_CANONICAL_KEYS.ownedProperties.includes('ownedResidentialProperties.*.usableArea'))
  assert.ok(PKO_MISSING_CANONICAL_KEYS.rkm.includes('rkm.guarantee.amount'))
})
