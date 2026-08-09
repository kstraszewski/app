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

import {
  CANONICAL_FIELDS,
  getTemplate,
  getTemplateBySourceSha256,
  instantiateTemplate,
  templateMatchesValues,
  validateTemplateJson,
} from '../src/index.ts'
import { ERSTE_EMPLOYMENT_INCOME_TEMPLATE } from '../src/templates/erste-employment-income.ts'

const EXPECTED_SHA256 = '3d57673da0959a1764e9a7014842c75534740d1e6be6c9a8638bc9ac017df0ef'
const sourcePath = fileURLToPath(new URL(
  '../../../mock-files/erste-zaswiadczenie-albo-oswiadczenie-o-zatrudnieniu-i-zarobkach-2026-04-25.pdf',
  import.meta.url,
))
const catalogPath = fileURLToPath(new URL(
  '../../database/data/mortgages/official-bank-files.json',
  import.meta.url,
))

test('Erste income form preserves the official empty-AcroForm source and its 30-day validity', async () => {
  const [sourceBytes, catalogBytes] = await Promise.all([
    readFile(sourcePath),
    readFile(catalogPath, 'utf8'),
  ])
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), EXPECTED_SHA256)
  assert.equal(ERSTE_EMPLOYMENT_INCOME_TEMPLATE.source.fileName, 'erste-zaswiadczenie-albo-oswiadczenie-o-zatrudnieniu-i-zarobkach-2026-04-25.pdf')
  assert.equal(ERSTE_EMPLOYMENT_INCOME_TEMPLATE.source.sha256, EXPECTED_SHA256)
  assert.equal(ERSTE_EMPLOYMENT_INCOME_TEMPLATE.source.pageCount, 3)
  assert.deepEqual(ERSTE_EMPLOYMENT_INCOME_TEMPLATE.fillMethod, { kind: 'pdf_overlay' })
  assert.equal(ERSTE_EMPLOYMENT_INCOME_TEMPLATE.source.formKind, 'overlay')
  assert.ok(ERSTE_EMPLOYMENT_INCOME_TEMPLATE.coverage.notes?.some(note => /30 dni/.test(note)))

  const officialFiles = JSON.parse(catalogBytes) as Array<{
    bankSlug: string
    category: string
    fileName: string
    sha256: string
    pageCount: number
    effectiveFrom: string
    downloadUrl: string
  }>
  const catalogEntry = officialFiles.find(file => file.sha256 === EXPECTED_SHA256)
  assert.deepEqual(catalogEntry, {
    ...catalogEntry,
    bankSlug: 'erste',
    category: 'income_form',
    fileName: ERSTE_EMPLOYMENT_INCOME_TEMPLATE.source.fileName,
    sha256: EXPECTED_SHA256,
    pageCount: 3,
    effectiveFrom: '2026-04-25',
    downloadUrl: 'https://www.erste.pl/regulation_file_server/time20260406113613/download?id=150033&lang=pl_PL',
  })

  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  assert.equal(pdf.getPageCount(), 3)
  assert.deepEqual(
    pdf.getPages().map(page => page.getSize()),
    Array.from({ length: 3 }, () => ({ width: 594.96, height: 842.52 })),
  )
  assert.equal(pdf.getForm().getFields().length, 0)

  const acroForm = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  assert.ok(acroForm, 'the official source advertises an AcroForm dictionary')
  assert.equal(acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray)?.size(), 0)

  const widgets = pdf.getPages().flatMap(page => (
    (page.node.Annots()?.asArray() ?? []).filter((annotationRef) => {
      const annotation = pdf.context.lookupMaybe(annotationRef, PDFDict)
      return annotation?.get(PDFName.of('Subtype'))?.toString() === '/Widget'
    })
  ))
  assert.equal(widgets.length, 0)
})

test('Erste income form inventories every customer and employer target', () => {
  const template = ERSTE_EMPLOYMENT_INCOME_TEMPLATE
  assert.equal(template.bindings.length, 28)
  assert.equal(template.bindings.every(binding => binding.target.kind === 'overlay'), true)
  assert.equal(template.bindings.every(binding => binding.reviewStatus === 'ready'), true)

  const geometry = template.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'overlay')
    if (binding.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) return ''
    return `${binding.target.page}:${binding.target.box.x}:${binding.target.box.y}:${binding.target.box.width}:${binding.target.box.height}`
  })
  assert.equal(new Set(geometry).size, 28)
  assert.deepEqual(
    Object.fromEntries(Array.from({ length: 3 }, (_, index) => {
      const page = index + 1
      return [page, template.bindings.filter(binding => (
        binding.target.kind === 'overlay' && binding.target.page === page
      )).length]
    })),
    { 1: 15, 2: 13, 3: 0 },
  )
  assert.deepEqual(template.coverage, {
    status: 'complete',
    inScopeTargetCount: 28,
    mappedTargetCount: 28,
    manualUserActionCount: 3,
    excludedTargetCount: 1,
    notes: template.coverage.notes,
  })
  assert.deepEqual(validateTemplateJson(template), {
    kind: 'document-template',
    valid: true,
    fillReady: true,
    errors: [],
    warnings: [],
    summary: {
      bindingCount: 28,
      mappedBindingCount: 28,
      readyBindingCount: 28,
      needsReviewCount: 0,
      unmappedCount: 0,
      activationReady: true,
    },
  })
})

test('Erste income form is registered, repeated per applicant, and limited to supported income sources', () => {
  const template = ERSTE_EMPLOYMENT_INCOME_TEMPLATE
  assert.equal(getTemplate(template.id), template)
  assert.equal(getTemplateBySourceSha256(EXPECTED_SHA256), template)
  assert.deepEqual(template.repeatFor, {
    collection: 'applicants',
    templateIndex: 0,
    maxInstances: 5,
    itemLabel: 'Wnioskodawca',
  })
  assert.deepEqual(template.includeWhen, {
    canonicalKey: 'applicants.0.incomeSource',
    equals: ['employment', 'civil_contract', 'retirement'],
  })
  assert.equal(templateMatchesValues(template, { 'applicants.0.incomeSource': 'employment' }), true)
  assert.equal(templateMatchesValues(template, { 'applicants.0.incomeSource': 'civil_contract' }), true)
  assert.equal(templateMatchesValues(template, { 'applicants.0.incomeSource': 'retirement' }), true)
  assert.equal(templateMatchesValues(template, { 'applicants.0.incomeSource': 'business' }), false)

  const secondApplicant = instantiateTemplate(template, 1)
  assert.deepEqual(secondApplicant.requiredCanonicalKeys, [
    'applicants.1.firstName',
    'applicants.1.lastName',
    'applicants.1.residentialAddress',
    'applicants.1.incomeSource',
    'applicants.1.employerName',
    'applicants.1.employerNip',
    'applicants.1.employerRegon',
    'applicants.1.employerAddress',
    'applicants.1.employmentBenefitType',
    'applicants.1.employmentStartDate',
    'applicants.1.employmentContractDuration',
    'applicants.1.averageNetIncome',
    'applicants.1.incomeCurrency',
    'applicants.1.averageNetIncomeInWords',
    'applicants.1.salaryPaymentMethod',
    'applicants.1.salaryGarnished',
    'applicants.1.adverseEmploymentCircumstances',
    'applicants.1.pesel',
  ])

  const thirdApplicant = instantiateTemplate(template, 2)
  assert.equal(thirdApplicant.repeatFor, undefined)
  assert.deepEqual(thirdApplicant.includeWhen, {
    canonicalKey: 'applicants.2.incomeSource',
    equals: ['employment', 'civil_contract', 'retirement'],
  })
  assert.ok(thirdApplicant.bindings.some(binding => binding.canonicalKey === 'applicants.2.employerName'))
  assert.ok(thirdApplicant.bindings.some(binding => (
    binding.computed
    && binding.canonicalKey === 'applicants.2.fullName'
    && binding.valueFrom?.includes('applicants.2.firstName')
  )))
})

test('canonical catalog includes the complete per-applicant income contract', () => {
  const relativeKeys = [
    'employerName',
    'employerNip',
    'employerRegon',
    'employerRegistryNumber',
    'employerAddress',
    'employmentBenefitType',
    'employmentStartDate',
    'employmentContractDuration',
    'employmentEndDate',
    'jobTitle',
    'averageNetIncome',
    'incomeCurrency',
    'averageNetIncomeInWords',
    'salaryPaymentMethod',
    'salaryGarnished',
    'salaryGarnishmentAmount',
    'adverseEmploymentCircumstances',
  ] as const

  for (const applicantIndex of [0, 1, 2, 3, 4]) {
    for (const relativeKey of relativeKeys) {
      assert.ok(
        CANONICAL_FIELDS.some(field => field.canonicalKey === `applicants.${applicantIndex}.${relativeKey}`),
        `missing applicants.${applicantIndex}.${relativeKey}`,
      )
    }
  }

  const endDate = CANONICAL_FIELDS.find(field => field.canonicalKey === 'applicants.0.employmentEndDate')
  assert.deepEqual(endDate?.requiredWhen, {
    canonicalKey: 'applicants.0.employmentContractDuration',
    equals: 'fixed_term',
  })
  const garnishment = CANONICAL_FIELDS.find(field => field.canonicalKey === 'applicants.0.salaryGarnishmentAmount')
  assert.deepEqual(garnishment?.requiredWhen, {
    canonicalKey: 'applicants.0.salaryGarnished',
    equals: 'true',
  })
})
