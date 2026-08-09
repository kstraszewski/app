import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PDFDocument } from 'pdf-lib'
import type { PDFField } from 'pdf-lib'

import {
  PEKAO_CANONICAL_KEYS_TO_ADD,
  PEKAO_CLIENT_DOCUMENT_REQUIREMENTS,
  PEKAO_COMPLETE_PACKAGE_CHECKED_AT,
  PEKAO_COMPLETE_PACKAGE_DOCUMENTS,
  PEKAO_CURRENT_TEMPLATE_DRIFT,
  PEKAO_MANUAL_ACTIONS,
  PEKAO_OFFICIAL_SOURCE_PAGES,
} from '../src/templates/pekao-complete-package-catalog.ts'

const mockFiles = fileURLToPath(new URL('../../../mock-files/', import.meta.url))
const officialAssets = fileURLToPath(new URL(
  '../../database/data/mortgages/official-bank-file-assets/',
  import.meta.url,
))

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sorted(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

test('Pekao catalogue pins every official source in both package asset locations', async () => {
  assert.equal(PEKAO_COMPLETE_PACKAGE_CHECKED_AT, '2026-08-09')
  assert.equal(PEKAO_COMPLETE_PACKAGE_DOCUMENTS.length, 16)
  assert.equal(new Set(PEKAO_COMPLETE_PACKAGE_DOCUMENTS.map(item => item.code)).size, 16)
  assert.equal(new Set(PEKAO_COMPLETE_PACKAGE_DOCUMENTS.map(item => item.fileName)).size, 16)

  for (const document of PEKAO_COMPLETE_PACKAGE_DOCUMENTS) {
    assert.equal(new URL(document.downloadUrl).hostname, 'www.pekao.com.pl')
    assert.equal(new URL(document.sourcePageUrl).hostname, 'www.pekao.com.pl')

    const [mockBytes, assetBytes] = await Promise.all([
      readFile(`${mockFiles}${document.fileName}`),
      readFile(`${officialAssets}${document.fileName}`),
    ])

    assert.equal(sha256(mockBytes), document.sha256, `${document.code}: mock hash`)
    assert.equal(sha256(assetBytes), document.sha256, `${document.code}: asset hash`)
    assert.deepEqual(mockBytes, assetBytes, `${document.code}: both package sources must use identical official bytes`)

    if (document.mimeType === 'application/pdf') {
      const pdf = await PDFDocument.load(mockBytes, { updateMetadata: false })
      assert.equal(pdf.getPageCount(), document.pageCount, `${document.code}: page count`)
      assert.equal(pdf.getForm().getFields().length, document.acroFormFieldCount, `${document.code}: AcroForm count`)
    }
    else {
      assert.equal(document.fileName.endsWith('.xlsx'), true)
      assert.equal(document.pageCount, null)
      assert.equal(document.acroFormFieldCount, null)
    }
  }
})

test('Pekao completion methods distinguish automatic, manual, read-only and workbook documents', () => {
  const byMethod = PEKAO_COMPLETE_PACKAGE_DOCUMENTS.reduce<Record<string, typeof PEKAO_COMPLETE_PACKAGE_DOCUMENTS[number][]>>(
    (groups, document) => {
      ;(groups[document.fillMethod] ??= []).push(document)
      return groups
    },
    {},
  )

  assert.equal(byMethod.pdf_acroform?.length, 1)
  assert.equal(byMethod.pdf_manual?.length, 9)
  assert.equal(byMethod.pdf_readonly?.length, 5)
  assert.equal(byMethod.xlsx_native?.length, 1)

  assert.deepEqual(byMethod.pdf_acroform?.map(document => document.code), [
    'pekao_mortgage_application',
  ])
  assert.equal(
    byMethod.pdf_readonly?.every(document => document.canonicalKeys.length === 0),
    true,
    'read-only information must not pretend to be filled',
  )
  assert.equal(
    byMethod.pdf_manual?.every(document => document.acroFormFieldCount === 0),
    true,
    'unmapped public forms must be routed to manual completion',
  )
})

test('Pekao package repeats applicant, income and tranche forms at the correct scope', () => {
  const byCode = new Map<string, typeof PEKAO_COMPLETE_PACKAGE_DOCUMENTS[number]>(
    PEKAO_COMPLETE_PACKAGE_DOCUMENTS.map(document => [document.code, document]),
  )

  assert.equal(byCode.get('pekao_applicant_information_card')?.scope, 'each_applicant')
  assert.equal(byCode.get('pekao_personal_data_information_iad')?.scope, 'each_applicant')
  assert.equal(byCode.get('pekao_employer_income_certificate')?.scope, 'each_income_source')
  assert.equal(byCode.get('pekao_applicant_employment_statement')?.scope, 'each_income_source')
  assert.equal(byCode.get('pekao_disbursement_or_tranche_request')?.scope, 'each_disbursement')

  assert.equal(
    byCode.get('pekao_applicant_information_card')?.validity?.includes('60 dni'),
    true,
  )
  for (const code of [
    'pekao_employer_income_certificate',
    'pekao_applicant_employment_statement',
    'pekao_business_statement_unchanged_taxation',
    'pekao_business_statement_changed_taxation',
    'pekao_related_company_or_farm_statement',
  ]) {
    assert.equal(byCode.get(code)?.validity?.includes('Jeden miesiąc'), true, code)
  }

  assert.equal(
    byCode.get('pekao_disbursement_or_tranche_request')?.signatures.some(signature => (
      signature.includes('Wszyscy współkredytobiorcy')
    )),
    true,
  )
})

test('Pekao checklist covers income, property, refinance, insurance and disbursement evidence', () => {
  const requirementCodes = new Set<string>(PEKAO_CLIENT_DOCUMENT_REQUIREMENTS.map(item => item.code))
  for (const code of [
    'income_employer_certificate',
    'business_zus_and_tax_clearance',
    'business_kpir_and_account_statement',
    'pension_or_disability_income',
    'primary_market_transaction_documents',
    'secondary_market_transaction_documents',
    'construction_property_documents',
    'renovation_or_finish_documents',
    'eco_energy_evidence',
    'refinanced_loan_closing_documents',
    'property_insurance_policy_and_payment',
    'contract_specific_disbursement_conditions',
  ]) {
    assert.equal(requirementCodes.has(code), true, `missing requirement ${code}`)
  }

  const refinance = PEKAO_CLIENT_DOCUMENT_REQUIREMENTS.find(item => (
    item.code === 'refinanced_loan_closing_documents'
  ))
  assert.equal(refinance?.requirement, 'bank_requested')
  assert.equal(refinance?.evidence, 'case_specific_bank_request')
  assert.equal(
    refinance?.notes.some(note => note.includes('nie publikuje zamkniętej listy')),
    true,
    'catalogue must not overstate a public refinance checklist that Pekao does not publish',
  )

  const eco = PEKAO_CLIENT_DOCUMENT_REQUIREMENTS.find(item => item.code === 'eco_energy_evidence')
  assert.equal(eco?.notes.some(note => note.includes('świadectwo charakterystyki')), true)
  assert.equal(eco?.notes.some(note => note.includes('projektowana charakterystyka')), true)
})

test('Pekao non-PDF workflow remains explicit instead of inventing bank documents', () => {
  const actions = new Map(PEKAO_MANUAL_ACTIONS.map(action => [action.code, action]))

  assert.equal(actions.get('rkm_eligibility_verification')?.kind, 'manual_action')
  assert.equal(actions.get('rkm_eligibility_verification')?.blocking, true)
  assert.equal(actions.get('big_krd_checks_from_kik')?.kind, 'external_check')
  assert.equal(actions.get('limited_online_mortgage_application')?.kind, 'web_form')
  assert.equal(actions.get('limited_online_mortgage_application')?.blocking, false)
  assert.equal(actions.get('refinance_document_list_confirmation')?.kind, 'manual_action')
  assert.equal(actions.get('tranche_conditions_confirmation')?.kind, 'manual_action')
})

test('all cited discovery and workflow pages stay inside the official Pekao domain', () => {
  for (const url of Object.values(PEKAO_OFFICIAL_SOURCE_PAGES)) {
    const parsed = new URL(url)
    assert.equal(parsed.protocol, 'https:')
    assert.equal(parsed.hostname, 'www.pekao.com.pl')
  }

  for (const item of [...PEKAO_CLIENT_DOCUMENT_REQUIREMENTS, ...PEKAO_MANUAL_ACTIONS]) {
    assert.equal(new URL(item.sourceUrl).hostname, 'www.pekao.com.pl')
  }
})

test('current Pekao application drift is complete and reproducible from official PDFs', async () => {
  const legacyBytes = await readFile(`${mockFiles}${PEKAO_CURRENT_TEMPLATE_DRIFT.existingSourceFileName}`)
  const currentBytes = await readFile(`${mockFiles}${PEKAO_CURRENT_TEMPLATE_DRIFT.currentSourceFileName}`)
  assert.equal(sha256(legacyBytes), PEKAO_CURRENT_TEMPLATE_DRIFT.existingSourceSha256)
  assert.equal(sha256(currentBytes), PEKAO_CURRENT_TEMPLATE_DRIFT.currentSourceSha256)

  const [legacy, current] = await Promise.all([
    PDFDocument.load(legacyBytes, { updateMetadata: false }),
    PDFDocument.load(currentBytes, { updateMetadata: false }),
  ])
  const legacyFields = new Map(legacy.getForm().getFields().map(field => [field.getName(), field]))
  const currentFields = new Map(current.getForm().getFields().map(field => [field.getName(), field]))

  assert.equal(legacyFields.size, PEKAO_CURRENT_TEMPLATE_DRIFT.existingAcroFormFieldCount)
  assert.equal(currentFields.size, PEKAO_CURRENT_TEMPLATE_DRIFT.currentAcroFormFieldCount)
  assert.deepEqual(
    sorted([...legacyFields.keys()].filter(field => !currentFields.has(field))),
    sorted(PEKAO_CURRENT_TEMPLATE_DRIFT.removedFieldNames),
  )
  assert.deepEqual(
    [...currentFields.keys()].filter(field => !legacyFields.has(field)),
    [],
  )

  const widgetGeometry = (field: PDFField) => (
    field.acroField.getWidgets().map(widget => widget.getRectangle())
  )
  const geometryChanged = [...currentFields].flatMap(([fieldName, currentField]) => {
    const legacyField = legacyFields.get(fieldName)
    if (!legacyField) return []
    return JSON.stringify(widgetGeometry(legacyField)) === JSON.stringify(widgetGeometry(currentField))
      ? []
      : [fieldName]
  })
  assert.deepEqual(
    sorted(geometryChanged),
    sorted(PEKAO_CURRENT_TEMPLATE_DRIFT.geometryChangedFieldNames),
  )
})

test('canonical backlog covers the field families absent from the shared form today', () => {
  for (const key of [
    'applicants.*.motherMaidenName',
    'applicants.*.identityDocumentExpiryDate',
    'applicants.*.dependentChildrenCount',
    'applicants.*.fixedNetIncome',
    'pekao.consents.bigInfoMonitor',
    'pekao.business.*',
    'property.agriculturalUse',
    'loan.contractNumber',
    'pekao.disbursement.*',
    'pekao.costEstimate.*',
  ]) {
    assert.equal(PEKAO_CANONICAL_KEYS_TO_ADD.includes(key as never), true, key)
  }
})
