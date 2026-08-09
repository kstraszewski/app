import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const manifestUrl = new URL('../data/mortgages/official-bank-files.json', import.meta.url)
const assetsUrl = new URL('../data/mortgages/official-bank-file-assets/', import.meta.url)
const productCatalogUrl = new URL('../data/mortgages/pl-2026-07-12.json', import.meta.url)

const expectedErsteDocuments = new Map([
  ['erste-oprocentowanie-kredytow-hipotecznych-2026-07-28.pdf', { effectiveFrom: '2026-07-28', pageCount: 13, sha256: '11bc1dc12a591652ed53008a6ef2b1326e1e07c79477a2c6ebe1e95cfe1fb2b4' }],
  ['erste-wniosek-o-kredyt-hipoteczny-2026-07-20.pdf', { effectiveFrom: '2026-07-20', pageCount: 9, sha256: '8f43ba0fe5f1557b1c2d35d44142aa364a79773500ea94944fe1ff9913d668d7' }],
  ['erste-informacja-ogolna-kredyty-hipoteczne-2026-07-18.pdf', { effectiveFrom: '2026-07-18', pageCount: 20, sha256: 'f974c17bdfe62b1e4639fcadfd06a5e07f3d82e2c65ed0986bf15ead9fb7ea90' }],
  ['erste-informacja-o-ryzykach-i-kosztach-kredytu-hipotecznego-2026-06-08.pdf', { effectiveFrom: '2026-06-08', pageCount: 14, sha256: '689dd31ea190130d7ba88aa4965c84433b29137f4cc846fddc3db749e6701756' }],
  ['erste-zaswiadczenie-albo-oswiadczenie-o-zatrudnieniu-i-zarobkach-2026-04-25.pdf', { effectiveFrom: '2026-04-25', pageCount: 3, sha256: '3d57673da0959a1764e9a7014842c75534740d1e6be6c9a8638bc9ac017df0ef' }],
  ['erste-wniosek-o-warunki-wstepne-kredytu-hipotecznego-2026-07-20.pdf', { effectiveFrom: '2026-07-20', pageCount: 9, sha256: '009bc99152508b2b4e4f05a504ac785fc0cb7c3331e3c89a5b719a366f9ff2a5' }],
  ['erste-oswiadczenie-inwestora-2026-04-25.pdf', { effectiveFrom: '2026-04-25', pageCount: 3, sha256: '2e92bf86367b182432901544d15ee4fa01e50607e7b6caeffd94f5df5c5289c7' }],
  ['erste-karta-informacyjna-klienta-2026-04-25.pdf', { effectiveFrom: '2026-04-25', pageCount: 9, sha256: 'a68efa15f28eb014a76cf47896d0fdf68c41852d8889ccb5c8d9b72e70b5b860' }],
  ['erste-rkm-warunki-gwarancji-splaty-2026-07-06.pdf', { effectiveFrom: '2026-07-06', pageCount: 8, sha256: 'a84216986d4cc957f44811de79cc72c7c15af2d65c5ac072b5b10f2e28091787' }],
  ['erste-rkm-warunki-kredytu-i-splaty-2026-07-06.pdf', { effectiveFrom: '2026-07-06', pageCount: 13, sha256: '57ddb5687a037cdc9b6c97eff92b6ca2b7c431c383cfec3f8cdd40d3f4ee3dfe' }],
])

const generatedErsteTemplateFiles = [
  'erste-wniosek-o-kredyt-hipoteczny-2026-07-20.pdf',
  'erste-wniosek-o-warunki-wstepne-kredytu-hipotecznego-2026-07-20.pdf',
  'erste-zaswiadczenie-albo-oswiadczenie-o-zatrudnieniu-i-zarobkach-2026-04-25.pdf',
  'erste-oswiadczenie-inwestora-2026-04-25.pdf',
  'erste-karta-informacyjna-klienta-2026-04-25.pdf',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function ensurePdfJsGlobals() {
  globalThis.DOMMatrix ||= class DOMMatrix {}
  globalThis.Path2D ||= class Path2D {}
  globalThis.ImageData ||= class ImageData {}
}

test('każdy plik bankowy ma unikalną, przypiętą kopię PDF albo XLSX', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  assert.ok(manifest.length >= 87)
  assert.equal(new Set(manifest.map(entry => entry.fileName)).size, manifest.length)

  for (const entry of manifest) {
    const bytes = await readFile(new URL(entry.fileName, assetsUrl))
    assert.equal(sha256(bytes), entry.sha256, entry.fileName)
    if (entry.mimeType === 'application/pdf') {
      assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-', entry.fileName)
      assert.ok(Number.isInteger(entry.pageCount) && entry.pageCount > 0, entry.fileName)
    } else {
      assert.equal(
        entry.mimeType,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        entry.fileName,
      )
      assert.equal(bytes.subarray(0, 4).toString('binary'), 'PK\u0003\u0004', entry.fileName)
      assert.equal(entry.pageCount, null, entry.fileName)
    }
    if (entry.derivation === 'sanitized_static') {
      assert.match(entry.originalSourceSha256, /^[0-9a-f]{64}$/u, entry.fileName)
      assert.notEqual(entry.originalSourceSha256, entry.sha256, entry.fileName)
    }
  }
})

test('katalog Erste przypina wyłącznie oficjalne źródła, daty i sumy kontrolne', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  const entries = manifest.filter(entry => entry.bankSlug === 'erste')

  assert.equal(entries.length, expectedErsteDocuments.size)
  assert.deepEqual(
    entries.map(entry => entry.fileName).sort(),
    [...expectedErsteDocuments.keys()].sort(),
  )

  for (const entry of entries) {
    const expected = expectedErsteDocuments.get(entry.fileName)
    assert.ok(expected, `Nieoczekiwany dokument Erste: ${entry.fileName}`)
    assert.equal(entry.downloadUrl.startsWith('https://www.erste.pl/'), true)
    assert.equal(entry.sourcePageUrl.startsWith('https://www.erste.pl/'), true)
    assert.equal(entry.mimeType, 'application/pdf')
    assert.equal(entry.effectiveFrom, expected.effectiveFrom)
    assert.equal(entry.effectiveTo, null)
    assert.equal(entry.pageCount, expected.pageCount)
    assert.equal(entry.sha256, expected.sha256)

    const bytes = await readFile(new URL(entry.fileName, assetsUrl))
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-')
    assert.equal(sha256(bytes), expected.sha256)
  }
})

test('liczba stron każdego przypiętego dokumentu Erste zgadza się z PDF', async () => {
  ensurePdfJsGlobals()
  const crmRequire = createRequire(new URL('../../../apps/crm/package.json', import.meta.url))
  const pdfjs = await import(pathToFileURL(
    crmRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
  ).href)

  for (const [fileName, expected] of expectedErsteDocuments) {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await readFile(new URL(fileName, assetsUrl))),
      useWorkerFetch: false,
      isEvalSupported: false,
    })
    try {
      const document = await loadingTask.promise
      assert.equal(document.numPages, expected.pageCount, fileName)
    } finally {
      await loadingTask.destroy()
    }
  }
})

test('formularze Erste nie zawierają aktywnych pól i wymagają bezpiecznego overlayu', async () => {
  ensurePdfJsGlobals()
  const crmRequire = createRequire(new URL('../../../apps/crm/package.json', import.meta.url))
  const pdfjs = await import(pathToFileURL(
    crmRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
  ).href)

  for (const fileName of generatedErsteTemplateFiles) {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await readFile(new URL(fileName, assetsUrl))),
      useWorkerFetch: false,
      isEvalSupported: false,
    })
    try {
      const document = await loadingTask.promise
      const fields = await document.getFieldObjects()
      assert.equal(Object.keys(fields ?? {}).length, 0, fileName)
    } finally {
      await loadingTask.destroy()
    }
  }
})

test('wymagania Erste rozróżniają dokumenty per klient, per sprawa i warunkowe RKM', async () => {
  const catalog = JSON.parse(await readFile(productCatalogUrl, 'utf8'))
  const erste = catalog.products.find(item => item.bank?.slug === 'erste')
  assert.ok(erste)

  const requirements = new Map(
    erste.version.documentRequirements.map(requirement => [requirement.code, requirement]),
  )
  const informationCard = requirements.get('erste_client_information_card')
  assert.equal(informationCard.scope, 'each_applicant')
  assert.equal(informationCard.stage, 'analysis')
  assert.equal(informationCard.evidence, 'confirmed_bank_source')
  assert.equal(informationCard.templateId, 'erste-client-information-card-2026')
  assert.deepEqual(informationCard.readiness.signatures, ['each_applicant'])

  const incomeForm = requirements.get('erste_employment_income_form')
  assert.equal(incomeForm.scope, 'each_applicant')
  assert.equal(incomeForm.applicability, 'case_requested')
  assert.equal(incomeForm.readiness.maxAgeDays, 30)
  assert.deepEqual(incomeForm.readiness.signatures, ['each_applicant', 'third_party'])

  const preliminaryApplication = requirements.get('erste_preliminary_conditions_application')
  assert.equal(preliminaryApplication.scope, 'case')
  assert.equal(preliminaryApplication.applicability, 'always')
  assert.deepEqual(preliminaryApplication.readiness.signatures, ['each_applicant', 'bank_employee'])

  const riskInformation = requirements.get('erste_risk_cost_information')
  assert.equal(riskInformation.readiness.deliveryEvidenceRequired, true)
  assert.equal(riskInformation.readiness.blocksSubmission, true)

  const investorStatement = requirements.get('erste_investor_statement')
  assert.equal(investorStatement.applicability, 'case_requested')
  assert.equal(investorStatement.when, undefined)
  assert.deepEqual(investorStatement.readiness.signatures, ['third_party'])

  const rkmGuarantee = requirements.get('erste_rkm_guarantee_conditions')
  assert.equal(rkmGuarantee.applicability, 'conditional')
  assert.equal(rkmGuarantee.when, undefined)
  assert.equal(rkmGuarantee.readiness.deliveryEvidenceRequired, true)
  assert.deepEqual(rkmGuarantee.readiness.signatures, ['each_applicant'])

  const rkmFamily = requirements.get('erste_rkm_credit_and_family_repayment_conditions')
  assert.equal(rkmFamily.applicability, 'conditional')
  assert.equal(rkmFamily.when, undefined)
  assert.equal(rkmFamily.readiness.deliveryEvidenceRequired, true)
  assert.deepEqual(rkmFamily.readiness.signatures, ['each_applicant'])
})

test('katalog mBanku obejmuje aktualny publiczny etap wniosku, załączniki i formularze dochodowe', async () => {
  const [manifest, catalog] = await Promise.all([
    readFile(manifestUrl, 'utf8').then(JSON.parse),
    readFile(productCatalogUrl, 'utf8').then(JSON.parse),
  ])
  const entries = manifest.filter(entry => entry.bankSlug === 'mbank')
  const expectedFiles = new Set([
    'mbank-wniosek-o-formularz-informacyjny-2026-03-31.pdf',
    'mbank-zalacznik-dane-wnioskodawcy-2026-01-01.pdf',
    'mbank-zalacznik-dzialalnosc-gospodarcza-2026-03-31.pdf',
    'mbank-zaswiadczenie-o-zatrudnieniu-umowa-o-prace-2026-01-16-sanitized.pdf',
    'mbank-zaswiadczenie-umowa-cywilnoprawna-2026-08-09.pdf',
    'mbank-ogolne-informacje-kredyt-hipoteczny.pdf',
    'mbank-informacja-o-ryzykach-2026-03-04.pdf',
    'mbank-regulamin-kredytow-hipotecznych-2025-05-28.pdf',
    'mbank-umowa-ramowa-cesji-2025-05-26.pdf',
  ])
  assert.deepEqual(new Set(entries.map(entry => entry.fileName)), expectedFiles)
  for (const entry of entries) {
    assert.equal(new URL(entry.downloadUrl).hostname.endsWith('.mbank.pl'), true, entry.fileName)
    const bytes = await readFile(new URL(entry.fileName, assetsUrl))
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-', entry.fileName)
    assert.equal(sha256(bytes), entry.sha256, entry.fileName)
  }
  const sanitizedEmployment = entries.find(entry => entry.derivation === 'sanitized_static')
  assert.equal(
    sanitizedEmployment?.originalSourceSha256,
    'cb9ba9d02d91bba3327cb4899d539b97369cebcaaa0f30ce4c962036717406ab',
  )
  assert.equal(sanitizedEmployment?.textExtraction, 'unsupported')

  const mbank = catalog.products.find(item => item.bank?.slug === 'mbank')
  assert.ok(mbank)
  assert.deepEqual(mbank.version.multiformTemplateIds, [
    'mbank-information-request-2026',
    'mbank-applicant-data-2026',
    'mbank-business-data-2026',
    'mbank-employment-income-2026',
    'mbank-civil-contract-income-2026',
    'mbank-general-mortgage-information-2026',
    'mbank-risk-information-2026',
  ])
  const requirements = new Map(
    mbank.version.documentRequirements.map(requirement => [requirement.code, requirement]),
  )
  assert.equal(requirements.get('mbank_employment_income').readiness.maxAgeDays, 30)
  assert.equal(requirements.get('mbank_civil_contract_income').readiness.maxAgeDays, 30)
  assert.equal(requirements.get('mbank_general_mortgage_information').readiness.deliveryEvidenceRequired, true)
  assert.equal(requirements.get('mbank_risk_information').readiness.deliveryEvidenceRequired, true)
  assert.equal(requirements.get('mbank_final_mortgage_application').templateId, undefined)
  assert.equal(requirements.get('mbank_final_mortgage_application').readiness.blocksSubmission, true)
  assert.equal(requirements.get('property_insurance_policy').stage, 'disbursement')
  assert.equal(requirements.get('mbank_pesel_reservation_check').stage, 'agreement')
})
