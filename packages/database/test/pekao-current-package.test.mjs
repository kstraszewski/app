import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../data/mortgages/official-bank-files.json', import.meta.url)
const assetDirectory = new URL('../data/mortgages/official-bank-file-assets/', import.meta.url)
const productCatalogUrl = new URL('../data/mortgages/pl-2026-07-12.json', import.meta.url)

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('Pliki banku Pekao obejmują cały audytowany zestaw PDF i natywny kosztorys XLSX', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  const entries = manifest.filter(entry => entry.bankSlug === 'pekao')
  assert.equal(entries.length, 16)
  assert.equal(entries.filter(entry => entry.mimeType === 'application/pdf').length, 15)
  assert.equal(
    entries.filter(entry => entry.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').length,
    1,
  )

  for (const entry of entries) {
    const bytes = await readFile(new URL(entry.fileName, assetDirectory))
    assert.equal(sha256(bytes), entry.sha256, entry.fileName)
    assert.equal(entry.downloadUrl.startsWith('https://www.pekao.com.pl/'), true, entry.fileName)
    assert.equal(entry.sourcePageUrl.startsWith('https://www.pekao.com.pl/'), true, entry.fileName)
    if (entry.mimeType === 'application/pdf') {
      assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-', entry.fileName)
      assert.equal(Number.isInteger(entry.pageCount) && entry.pageCount > 0, true, entry.fileName)
    }
    else {
      assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', entry.fileName)
      assert.equal(entry.fileName.endsWith('.xlsx'), true)
      assert.equal(entry.pageCount, null)
    }
  }
})

test('produkt Pekao używa aktualnego manualnego PDF zamiast starego mapowania i ma pełną checklistę', async () => {
  const catalog = JSON.parse(await readFile(productCatalogUrl, 'utf8'))
  const pekao = catalog.products.find(item => item.bank?.slug === 'pekao')
  assert.ok(pekao)

  const templateIds = pekao.version.multiformTemplateIds
  assert.equal(templateIds.includes('pekao-mortgage-2025'), false)
  assert.equal(templateIds.includes('pekao-mortgage-2026-manual'), true)
  assert.equal(templateIds.length, 7)
  assert.deepEqual(
    pekao.version.documentRequirements.flatMap(requirement => (
      requirement.templateId ? [requirement.templateId] : []
    )),
    templateIds,
  )

  const requirements = new Map(
    pekao.version.documentRequirements.map(requirement => [requirement.code, requirement]),
  )
  assert.equal(requirements.get('pekao_applicant_information_card').scope, 'each_applicant')
  assert.equal(requirements.get('pekao_applicant_information_card').readiness.maxAgeDays, 60)
  assert.equal(requirements.get('pekao_iad_information').readiness.deliveryEvidenceRequired, true)
  assert.equal(requirements.get('pekao_employer_income_certificate').readiness.maxAgeDays, 30)
  assert.equal(requirements.get('pekao_business_statement').readiness.maxAgeDays, 30)
  assert.equal(requirements.get('pekao_business_changed_taxation').templateId, undefined)
  assert.equal(requirements.get('pekao_construction_cost_estimate').allowedMimeTypes.length, 0)
  assert.equal(requirements.get('pekao_general_construction_information').applicability, 'conditional')
  assert.equal(requirements.get('pekao_general_family_information').applicability, 'conditional')
  assert.equal(requirements.get('refinanced_loan_closing_documents').applicability, 'case_requested')
  assert.equal(requirements.get('pekao_disbursement_request').stage, 'tranche')
  assert.equal(requirements.get('property_insurance_policy').stage, 'disbursement')
  assert.equal(requirements.get('pekao_big_krd_checks').scope, 'each_applicant')
})
