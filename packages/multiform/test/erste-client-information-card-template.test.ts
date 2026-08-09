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

import { CANONICAL_FIELDS } from '../src/canonical-fields.ts'
import { getTemplate } from '../src/registry.ts'
import { instantiateTemplate } from '../src/template-instances.ts'
import { validateTemplateJson } from '../src/template-validation.ts'
import { ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE } from '../src/templates/erste-client-information-card.ts'

const sourcePath = fileURLToPath(new URL(
  '../../../mock-files/erste-karta-informacyjna-klienta-2026-04-25.pdf',
  import.meta.url,
))
const catalogPath = fileURLToPath(new URL(
  '../../database/data/mortgages/official-bank-files.json',
  import.meta.url,
))

test('Erste KIK pins the official 25.04.2026 static PDF and bank-file metadata', async () => {
  const [sourceBytes, catalogBytes] = await Promise.all([
    readFile(sourcePath),
    readFile(catalogPath, 'utf8'),
  ])
  const sha256 = createHash('sha256').update(sourceBytes).digest('hex')
  const officialFiles = JSON.parse(catalogBytes) as Array<{
    bankSlug: string
    fileName: string
    sha256: string
    pageCount: number
    effectiveFrom: string
    downloadUrl: string
  }>
  const catalogEntry = officialFiles.find(file => file.sha256 === sha256)

  assert.equal(sha256, 'a68efa15f28eb014a76cf47896d0fdf68c41852d8889ccb5c8d9b72e70b5b860')
  assert.deepEqual(catalogEntry, {
    ...catalogEntry,
    bankSlug: 'erste',
    fileName: ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE.source.fileName,
    sha256,
    pageCount: 9,
    effectiveFrom: '2026-04-25',
    downloadUrl: 'https://www.erste.pl/regulation_file_server/time20260406115335/download?id=150222&lang=pl_PL',
  })

  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  assert.equal(pdf.getPageCount(), 9)
  const acroForm = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  assert.equal(Boolean(acroForm), false, 'source contains no AcroForm dictionary')
  assert.equal(pdf.getForm().getFields().length, 0)
})

test('Erste KIK maps all 140 audited targets and keeps only signatures manual', () => {
  const template = ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE
  assert.equal(template.bindings.length, 140)
  assert.equal(template.bindings.every(binding => binding.target.kind === 'overlay'), true)
  assert.equal(template.bindings.every(binding => binding.reviewStatus === 'ready'), true)
  assert.deepEqual(template.coverage, {
    status: 'complete',
    inScopeTargetCount: 140,
    mappedTargetCount: 140,
    manualUserActionCount: 2,
    excludedTargetCount: 0,
    notes: template.coverage.notes,
  })
  assert.deepEqual(
    Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
      const page = index + 1
      return [page, template.bindings.filter(binding => (
        binding.target.kind === 'overlay' && binding.target.page === page
      )).length]
    })),
    { 1: 17, 2: 20, 3: 22, 4: 14, 5: 18, 6: 22, 7: 20, 8: 6, 9: 1 },
  )

  const geometry = template.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'overlay')
    if (binding.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) return ''
    return JSON.stringify([binding.target.page, binding.target.box])
  })
  assert.equal(new Set(geometry).size, 140)
  assert.deepEqual(validateTemplateJson(template), {
    kind: 'document-template',
    valid: true,
    fillReady: true,
    errors: [],
    warnings: [],
    summary: {
      bindingCount: 140,
      mappedBindingCount: 140,
      readyBindingCount: 140,
      needsReviewCount: 0,
      unmappedCount: 0,
      activationReady: true,
    },
  })
})

test('Erste KIK is registered and remaps every applicant-owned field per generated copy', () => {
  const template = getTemplate('erste-client-information-card-2026')
  assert.equal(template, ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE)
  assert.deepEqual(template?.repeatFor, {
    collection: 'applicants',
    templateIndex: 0,
    maxInstances: 5,
    itemLabel: 'Wnioskodawca',
  })

  const secondApplicant = instantiateTemplate(ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE, 1)
  const keys = secondApplicant.bindings.map(binding => binding.canonicalKey)
  assert.ok(keys.includes('applicants.1.firstName'))
  assert.ok(keys.includes('applicants.1.liabilities.4.monthlyPayment'))
  assert.ok(keys.includes('application.placeAndDate'))
  assert.equal(keys.some(key => key.startsWith('applicants.0.')), false)
  assert.ok(secondApplicant.requiredCanonicalKeys?.includes('applicants.1.identityDocumentNumber'))
  assert.equal(secondApplicant.requiredCanonicalKeys?.some(key => key.startsWith('applicants.0.')), false)
  assert.deepEqual(
    secondApplicant.bindings.find(binding => binding.canonicalKey === 'application.placeAndDate' && binding.target.kind === 'overlay' && binding.target.page === 9)?.condition,
    { canonicalKey: 'applicants.1.maritalStatus', equals: 'married' },
  )
})

test('Erste KIK canonical catalog exposes every authored applicant field and checkbox value', () => {
  const fields = new Map<string, (typeof CANONICAL_FIELDS)[number]>(
    CANONICAL_FIELDS.map(field => [field.canonicalKey, field]),
  )
  for (const binding of ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE.bindings) {
    if (binding.computed) continue
    const field = fields.get(binding.canonicalKey)
    assert.ok(field, `missing canonical field ${binding.canonicalKey}`)

    if (binding.condition?.canonicalKey !== binding.canonicalKey) continue
    if (field?.type === 'boolean') {
      assert.ok(['true', 'false'].includes(String(binding.condition.equals)))
    }
    else if (field?.type === 'select') {
      assert.ok(
        field.options?.some(option => option.value === binding.condition?.equals),
        `unknown option ${String(binding.condition?.equals)} for ${binding.canonicalKey}`,
      )
    }
  }
})
