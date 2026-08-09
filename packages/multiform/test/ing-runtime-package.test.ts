import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  getTemplate,
  ING_APPLICATION_SUPPLEMENT_TEMPLATE,
  ING_INITIAL_PACKAGE_TEMPLATE_IDS,
  ING_TEMPLATES,
  instantiateTemplate,
  prepareBundle,
  resolveTemplateFillMethod,
  templateInstanceIndexes,
  templateMatchesValues,
  validateTemplateJson,
} from '../src/index.ts'

interface ProductDocumentRequirement {
  code: string
  itemKind: string
  applicability: string
  allowedMimeTypes: string[]
  templateId?: string
  notes?: string
}

interface MortgageProductSnapshot {
  bank: { slug: string }
  version: {
    calculatorSchemaVersion?: number
    documentRequirements: ProductDocumentRequirement[]
    multiformTemplateIds: string[]
  }
}

const productCatalogPath = fileURLToPath(new URL(
  '../../database/data/mortgages/pl-2026-07-12.json',
  import.meta.url,
))
const officialFilesPath = fileURLToPath(new URL(
  '../../database/data/mortgages/official-bank-files.json',
  import.meta.url,
))

async function ingProduct() {
  const catalog = JSON.parse(await readFile(productCatalogPath, 'utf8')) as {
    products: MortgageProductSnapshot[]
  }
  const product = catalog.products.find(candidate => candidate.bank.slug === 'ing')
  assert.ok(product)
  return product
}

function requirementMap(product: Awaited<ReturnType<typeof ingProduct>>) {
  return new Map(product.version.documentRequirements.map(requirement => [
    requirement.code,
    requirement,
  ]))
}

test('all audited ING PDFs are registered as valid manual or read-only runtime templates', () => {
  assert.equal(ING_TEMPLATES.length, 8)
  assert.equal(new Set(ING_TEMPLATES.map(template => template.id)).size, 8)

  for (const template of ING_TEMPLATES) {
    assert.equal(getTemplate(template.id), template)
    const method = resolveTemplateFillMethod(template).kind
    assert.ok(method === 'pdf_manual' || method === 'pdf_readonly')
    assert.equal(template.bindings.length, 0)

    const validation = validateTemplateJson(template)
    assert.equal(validation.valid, true, `${template.id}: ${JSON.stringify(validation.errors)}`)
    assert.equal(validation.fillReady, true, `${template.id}: ${JSON.stringify(validation.warnings)}`)
  }
})

test('ING one-applicant employment package resolves only applicable initial PDFs', async () => {
  const product = await ingProduct()
  assert.equal(product.version.calculatorSchemaVersion, 2)
  assert.deepEqual(product.version.multiformTemplateIds, ING_INITIAL_PACKAGE_TEMPLATE_IDS)
  assert.deepEqual(
    product.version.documentRequirements
      .flatMap(requirement => requirement.templateId ? [requirement.templateId] : [])
      .sort(),
    [...product.version.multiformTemplateIds].sort(),
  )

  const bundle = prepareBundle(product.version.multiformTemplateIds)
  assert.deepEqual(bundle.warnings, [])

  const values = {
    'applicants.0.incomeSource': 'employment',
    'property.appraisalSource': 'bank_provider',
  }
  const documents = bundle.documents.flatMap(template => (
    templateInstanceIndexes(template, { applicants: 1 })
      .map(index => instantiateTemplate(template, index))
      .filter(instance => templateMatchesValues(instance, values))
  ))

  assert.deepEqual(documents.map(document => document.id), [
    'ing-income-certificate-2026-03-08',
    'ing-general-mortgage-information-2026-05-31',
  ])
  assert.deepEqual(documents.map(document => resolveTemplateFillMethod(document).kind), [
    'pdf_manual',
    'pdf_readonly',
  ])
  assert.equal(documents[0]?.repeatFor, undefined)
  assert.match(documents[0]?.label ?? '', /Wnioskodawca 1/)

  const requirements = requirementMap(product)
  for (const code of [
    'identity_document',
    'ing_mortgage_application_flow',
    'ing_applicant_data_flow',
    'ing_income_certificate',
    'land_register_verification',
    'ing_valuation_choice',
    'ing_general_mortgage_information',
  ]) {
    assert.ok(requirements.has(code), `missing ING initial requirement ${code}`)
  }
})

test('ING own-appraisal branch adds the appraiser information and manual statement exactly once', async () => {
  const product = await ingProduct()
  const bundle = prepareBundle(product.version.multiformTemplateIds)
  const values = {
    'applicants.0.incomeSource': 'employment',
    'property.appraisalSource': 'self_provided',
  }
  const documents = bundle.documents.flatMap(template => (
    templateInstanceIndexes(template, { applicants: 1 })
      .map(index => instantiateTemplate(template, index))
      .filter(instance => templateMatchesValues(instance, values))
  ))

  assert.deepEqual(documents.map(document => document.id), [
    'ing-income-certificate-2026-03-08',
    'ing-general-mortgage-information-2026-05-31',
    'ing-appraisal-guidelines-2026-08-09',
    'ing-appraiser-conflict-statement-2026-05-31',
  ])
})

test('ING has no invented final application PDF and keeps bank-owned steps explicit', async () => {
  const product = await ingProduct()
  const requirements = requirementMap(product)
  const application = requirements.get('ing_mortgage_application_flow')
  assert.ok(application)
  assert.equal(application.itemKind, 'manual_action')
  assert.deepEqual(application.allowedMimeTypes, [])
  assert.equal(application.templateId, undefined)
  assert.match(application.notes ?? '', /web_form/i)
  assert.match(application.notes ?? '', /manual_action/i)
  assert.match(application.notes ?? '', /nie publikuje aktualnego pustego PDF-u/i)

  const riskForm = requirements.get('ing_appraisal_risk_form')
  assert.ok(riskForm)
  assert.equal(riskForm.itemKind, 'manual_action')
  assert.equal(riskForm.templateId, undefined)
  assert.match(riskForm.notes ?? '', /web_form/i)

  const supplement = requirements.get('ing_application_supplement')
  assert.ok(supplement)
  assert.equal(supplement.applicability, 'case_requested')
  assert.equal(supplement.templateId, undefined)
  assert.equal(
    product.version.multiformTemplateIds.includes(ING_APPLICATION_SUPPLEMENT_TEMPLATE.id),
    false,
  )
  assert.equal(
    ING_TEMPLATES.some(template => /wniosek o kredyt hipoteczny$/i.test(template.label)),
    false,
  )
})

test('official bank-file catalogue pins every registered ING PDF to the audited source', async () => {
  const officialFiles = JSON.parse(await readFile(officialFilesPath, 'utf8')) as Array<{
    bankSlug: string
    fileName: string
    sha256: string
    downloadUrl: string
    sourcePageUrl: string
    pageCount: number
    originalSourceSha256?: string
    derivation?: string
  }>
  const ingFiles = officialFiles.filter(file => file.bankSlug === 'ing')
  assert.equal(ingFiles.length, 8)
  const expectedProvenance = new Map<string, readonly [string, string]>([
    ['ing-zaswiadczenie-o-dochodach-2026-03-08-sanitized.pdf', ['175a6d3563103d0b34986f5fecb44558f1ec96c08e7f894242169d0a40e37329', 'sanitized_interactive']],
    ['ing-formularz-dzialalnosc-gospodarcza-2015-11-09-sanitized.pdf', ['eb97264f95158fb9fccbbbf86c7350055cbfac6f677fbcd581f50f90ce47718e', 'sanitized_static']],
    ['ing-informacje-ogolne-kredyt-hipoteczny-2026-05-31-sanitized.pdf', ['db5269a6e426fceb8d2f42ead1b4e25cc6d03a23207a3c7a167e01a19f24a8df', 'sanitized_static']],
    ['ing-wytyczne-do-operatu-2026-08-09-sanitized.pdf', ['191d7774f4531d7c227199acedb630b94fdf5111844fd1bc424e372b31f2dd7b', 'sanitized_static']],
    ['ing-oswiadczenie-rzeczoznawcy-brak-konfliktu-2026-05-31-sanitized.pdf', ['3defe96d2c8817dc6b5c812a2944d98e6c5cfbd1fb30377b899deec49c4dbb98', 'sanitized_interactive']],
    ['ing-uzupelnienie-wniosku-produkt-hipoteczny-2025-09-30-sanitized.pdf', ['55e1b0491a36876e01eda0bf548a810a0c96fc4ef6c98e8020f36d836a4d736f', 'sanitized_interactive']],
    ['ing-regulamin-lato-u-siebie-2026-sanitized.pdf', ['eecbacc7590b5a116fef2ca100093b4f9154184b0c912e30726cdef9423d6cb4', 'sanitized_static']],
    ['ing-regulamin-kredyt-na-dom-energooszczedny-2026-sanitized.pdf', ['149e449d49ddafd3607092c8ec92578fca9e177cac532b19dd22add917f70345', 'sanitized_static']],
  ])

  for (const template of ING_TEMPLATES) {
    const official = ingFiles.find(file => file.fileName === template.source.fileName)
    assert.ok(official, `missing official ING source ${template.source.fileName}`)
    assert.equal(official.sha256, template.source.sha256)
    assert.equal(official.pageCount, template.source.pageCount)
    assert.match(new URL(official.downloadUrl).hostname, /(^|\.)ing\.pl$/)
    assert.match(new URL(official.sourcePageUrl).hostname, /(^|\.)ing\.pl$/)
    const provenance = expectedProvenance.get(official.fileName)
    assert.ok(provenance, official.fileName)
    assert.equal(official.originalSourceSha256, provenance[0])
    assert.equal(official.derivation, provenance[1])
    assert.notEqual(official.originalSourceSha256, official.sha256)
  }
})
