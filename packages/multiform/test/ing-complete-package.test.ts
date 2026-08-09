import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PDFDocument } from 'pdf-lib'

import {
  ING_CANONICAL_FIELD_GAPS,
  ING_EVIDENCE_REQUIREMENTS,
  ING_OFFICIAL_EVIDENCE,
  ING_OFFICIAL_PACKAGE_DOCUMENTS,
} from '../src/templates/ing-complete-package.ts'

const assetDirectory = fileURLToPath(new URL(
  '../../database/data/mortgages/official-bank-file-assets/',
  import.meta.url,
))
const mockDirectory = fileURLToPath(new URL('../../../mock-files/', import.meta.url))

function assertOfficialIngUrl(value: string) {
  const url = new URL(value)
  assert.equal(url.protocol, 'https:')
  assert.ok(
    url.hostname === 'ing.pl' || url.hostname.endsWith('.ing.pl'),
    `${value} must use an official ING host`,
  )
}

test('ING manifest never substitutes a synthetic PDF for a bank-owned application flow', () => {
  const onlineApplication = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-mortgage-online-flow-2026'
  ))

  assert.ok(onlineApplication)
  assert.equal(onlineApplication.method, 'web_form')
  assert.equal('asset' in onlineApplication, false)

  const expertApplication = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-mortgage-application-expert-flow-2026'
  ))
  assert.ok(expertApplication)
  assert.equal(expertApplication.method, 'manual_action')
  assert.equal('asset' in expertApplication, false)
  assert.match(expertApplication.notes.join(' '), /does not link a reusable application PDF/i)

  const applicantData = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-applicant-data-expert-flow-2026'
  ))
  assert.ok(applicantData)
  assert.equal(applicantData.method, 'manual_action')
  assert.equal('asset' in applicantData, false)

  const riskForm = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-valuation-risk-form-2026'
  ))
  assert.ok(riskForm)
  assert.equal(riskForm.method, 'web_form')
  assert.equal('asset' in riskForm, false)

  assert.equal(
    ING_OFFICIAL_PACKAGE_DOCUMENTS.some(document => (
      (document.method === 'web_form' || document.method === 'manual_action') && 'asset' in document
    )),
    false,
  )
})

test('ING document and evidence identifiers are unique and all sources are official', () => {
  const ids = [
    ...ING_OFFICIAL_PACKAGE_DOCUMENTS.map(document => document.id),
    ...ING_EVIDENCE_REQUIREMENTS.map(requirement => requirement.id),
  ]
  assert.equal(new Set(ids).size, ids.length)

  for (const document of ING_OFFICIAL_PACKAGE_DOCUMENTS) {
    assertOfficialIngUrl(document.sourcePageUrl)
    if ('asset' in document && document.asset) {
      assertOfficialIngUrl(document.asset.downloadUrl)
      assert.ok(
        document.method === 'pdf_manual' || document.method === 'pdf_readonly',
        `${document.id} has bytes but is not classified as a PDF method`,
      )
    }
  }
  for (const evidence of ING_OFFICIAL_EVIDENCE) assertOfficialIngUrl(evidence.url)
})

test('ING official PDF assets and mock mirrors are byte-pinned and have the reviewed page counts', async () => {
  let assetCount = 0

  for (const document of ING_OFFICIAL_PACKAGE_DOCUMENTS) {
    if (!('asset' in document)) continue
    const asset = document.asset
    assetCount += 1
    const assetBytes = await readFile(`${assetDirectory}${asset.fileName}`)
    const mockBytes = await readFile(`${mockDirectory}${asset.fileName}`)
    const digest = createHash('sha256').update(assetBytes).digest('hex')

    assert.equal(digest, asset.sha256, document.id)
    assert.deepEqual(mockBytes, assetBytes, `${document.id} mock mirror differs`)

    const pdf = await PDFDocument.load(assetBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    })
    assert.equal(pdf.getPageCount(), asset.pageCount, document.id)
  }

  assert.equal(assetCount, 8)
})

test('ING package distinguishes manual, read-only and conditional bank documents', () => {
  const income = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-income-certificate-2026-03-08'
  ))
  assert.ok(income)
  assert.equal(income.method, 'pdf_manual')
  assert.match(income.validity, /One month/i)
  assert.equal(income.repeatForApplicants, true)

  const generalInformation = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-general-mortgage-information-2026-05-31'
  ))
  assert.ok(generalInformation)
  assert.equal(generalInformation.method, 'pdf_readonly')
  assert.deepEqual(generalInformation.canonicalKeys, [])

  const personalisedInformation = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-standardised-information-form-case-generated-2026'
  ))
  assert.ok(personalisedInformation)
  assert.equal(personalisedInformation.method, 'manual_action')
  assert.equal('asset' in personalisedInformation, false)
  assert.match(personalisedInformation.notes.join(' '), /bank-generated document/i)

  const supplement = ING_OFFICIAL_PACKAGE_DOCUMENTS.find(document => (
    document.id === 'ing-mortgage-application-supplement-2025-09-30'
  ))
  assert.ok(supplement)
  assert.equal(supplement.method, 'pdf_manual')
  assert.match(supplement.requiredFor.join(' '), /only when ING declares/i)
  assert.match(supplement.signature, /each listed applicant/i)
})

test('ING property, valuation and income branches cover every published mortgage route', () => {
  const requirementIds = new Set<string>(ING_EVIDENCE_REQUIREMENTS.map(requirement => requirement.id))
  for (const id of [
    'identity-photo-document',
    'business-tax-no-arrears',
    'business-zus-no-arrears',
    'business-financial-statements',
    'primary-market-transaction-documents',
    'secondary-market-property-documents',
    'construction-property-documents',
    'renovation-property-documents',
    'building-plot-documents',
    'external-appraisal',
    'bank-appraisal-order',
    'energy-performance-certificate',
    'energy-efficient-house-evidence',
    'refinance-balance-information',
    'refinance-closure-confirmation',
  ]) {
    assert.ok(requirementIds.has(id), `missing ING requirement ${id}`)
  }

  assert.ok(ING_CANONICAL_FIELD_GAPS.includes('property.market'))
  assert.ok(ING_CANONICAL_FIELD_GAPS.includes('application.channel'))
  assert.ok(ING_CANONICAL_FIELD_GAPS.includes('applicants.*.incomeCreditedToIngMonths'))
  assert.ok(ING_CANONICAL_FIELD_GAPS.includes('applicants.*.businessAccountingMethodCurrent'))
})
