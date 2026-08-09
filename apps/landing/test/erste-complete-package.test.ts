import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  CANONICAL_COLLECTIONS,
  CANONICAL_FIELDS,
  ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE,
  ERSTE_EMPLOYMENT_INCOME_TEMPLATE,
  ERSTE_GENERAL_MORTGAGE_INFORMATION_TEMPLATE,
  ERSTE_INVESTOR_STATEMENT_TEMPLATE,
  ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE,
  ERSTE_RISK_COST_INFORMATION_TEMPLATE,
  ERSTE_RKM_FAMILY_CONDITIONS_TEMPLATE,
  ERSTE_RKM_GUARANTEE_TEMPLATE,
  ERSTE_TEMPLATE,
  instantiateTemplate,
  prepareBundle,
  templateMatchesValues,
  type CanonicalFieldDefinition,
  type DocumentTemplate,
} from '@openexpert/multiform'
import { unzipSync } from 'fflate'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import {
  isCanonicalFieldRequired,
  isCanonicalFieldVisible,
} from '../server/utils/multiform-api.ts'
import { createPdfBundle } from '../server/utils/multiform-pdf.ts'

const execFileAsync = promisify(execFile)
const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(testDirectory, '../../..')
const mockFilesDirectory = join(repositoryRoot, 'mock-files')
const outputDirectory = join(repositoryRoot, 'output/pdf/erste-complete-package-test')
const fontPath = join(
  repositoryRoot,
  'apps/landing/public/fonts/DMSans-VariableFont_opsz,wght.ttf',
)

const candidateTemplates = [
  ERSTE_TEMPLATE,
  ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE,
  ERSTE_INVESTOR_STATEMENT_TEMPLATE,
  ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE,
  ERSTE_EMPLOYMENT_INCOME_TEMPLATE,
  ERSTE_RISK_COST_INFORMATION_TEMPLATE,
  ERSTE_GENERAL_MORTGAGE_INFORMATION_TEMPLATE,
  ERSTE_RKM_GUARANTEE_TEMPLATE,
  ERSTE_RKM_FAMILY_CONDITIONS_TEMPLATE,
] as const

const sourceChecksums = new Map(candidateTemplates.map(template => [
  template.id,
  template.source.sha256,
]))

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function fixtureDefault(field: CanonicalFieldDefinition): string | number | boolean {
  const key = field.canonicalKey

  if (key.endsWith('.pesel')) return '85010112345'
  if (key.endsWith('.email') || key === 'intermediary.email') return 'qa.erste@example.local'
  if (key.toLocaleLowerCase('pl-PL').includes('postalcode')) return '60-812'
  if (key.toLocaleLowerCase('pl-PL').endsWith('nip')) return '7790001234'
  if (key.toLocaleLowerCase('pl-PL').endsWith('regon')) return '302000123'
  if (key.toLocaleLowerCase('pl-PL').includes('phone')) return '+48600700800'
  if (key.toLocaleLowerCase('pl-PL').includes('landregisternumber')) return 'PO1P/00123456/7'
  if (key.toLocaleLowerCase('pl-PL').includes('accountnumber')) return '12105000997603123456789123'
  if (key.toLocaleLowerCase('pl-PL').includes('currency')) return 'PLN'
  if (key.toLocaleLowerCase('pl-PL').includes('address')) return 'ul. Bukowska 12/34, 60-812 Poznań'
  if (key.toLocaleLowerCase('pl-PL').includes('date') || field.type === 'date') return '2026-08-09'
  if (field.options?.length) return field.options[0]!.value
  if (field.type === 'boolean') return false
  if (field.type === 'currency') return Math.max(1_000, field.validation?.min ?? 0)
  if (field.type === 'number') {
    const value = Math.max(1, field.validation?.min ?? 0)
    return field.validation?.integer ? Math.ceil(value) : value
  }
  return 'Test'
}

function templateInputKeys(templates: readonly DocumentTemplate[]) {
  return new Set(templates.flatMap(template => [
    ...(template.includeWhen ? [template.includeWhen.canonicalKey] : []),
    ...(template.requiredCanonicalKeys ?? []),
    ...template.bindings.flatMap(binding => [
      binding.canonicalKey,
      ...(binding.valueFrom ?? []),
      ...(binding.condition ? [binding.condition.canonicalKey] : []),
    ]),
  ]))
}

function completeScenarioValues(activeTemplates: readonly DocumentTemplate[]) {
  const keys = templateInputKeys([
    ...activeTemplates,
    ERSTE_RKM_GUARANTEE_TEMPLATE,
    ERSTE_RKM_FAMILY_CONDITIONS_TEMPLATE,
  ])
  const values: Record<string, string | number | boolean> = Object.fromEntries(
    CANONICAL_FIELDS
      .filter(field => keys.has(field.canonicalKey))
      .map(field => [field.canonicalKey, fixtureDefault(field)]),
  )

  Object.assign(values, {
    'application.place': 'Poznań',
    'application.date': '2026-08-09',
    'application.submissionChannel': 'intermediary',

    'applicants.0.firstName': 'Alicja',
    'applicants.0.middleName': 'Maria',
    'applicants.0.lastName': 'Nowak',
    'applicants.0.pesel': '90010112349',
    'applicants.0.birthDate': '1990-01-01',
    'applicants.0.identityDocumentType': 'dowód osobisty',
    'applicants.0.identityDocumentNumber': 'ABA123456',
    'applicants.0.birthPlace': 'Poznań',
    'applicants.0.countryOfResidence': 'Polska',
    'applicants.0.citizenship': 'polskie',
    'applicants.0.phone': '+48600111222',
    'applicants.0.email': 'alicja.nowak@example.local',
    'applicants.0.residentialAddress': 'ul. Bukowska 12/34, 60-812 Poznań',
    'applicants.0.correspondenceAddress': 'ul. Bukowska 12/34, 60-812 Poznań',
    'applicants.0.maritalStatus': 'married',
    'applicants.0.maritalPropertyCommunity': true,
    'applicants.0.housingStatus': 'owner',
    'applicants.0.householdSize': 2,
    'applicants.0.childBenefitCount': 0,
    'applicants.0.education': 'higher',
    'applicants.0.occupation': 'analityczka finansowa',
    'applicants.0.employmentCategory': 'private_enterprise',
    'applicants.0.incomeSource': 'employment',
    'applicants.0.employmentTenure': 'up_to_5_years',
    'applicants.0.businessActiveOrRecentlySuspended': false,
    'applicants.0.monthlyMaintenanceCosts': 2_400,
    'applicants.0.alimonyAndLegalBurdens': 0,
    'applicants.0.collectionProceedings': false,
    'applicants.0.employerName': 'OpenExpert Technologie sp. z o.o.',
    'applicants.0.employerNip': '7790001234',
    'applicants.0.employerRegon': '302000123',
    'applicants.0.employerRegistryNumber': 'KRS 0000123456',
    'applicants.0.employerAddress': 'ul. Półwiejska 10, 61-888 Poznań',
    'applicants.0.employmentBenefitType': 'umowa o pracę',
    'applicants.0.employmentStartDate': '2022-03-01',
    'applicants.0.employmentContractDuration': 'indefinite',
    'applicants.0.jobTitle': 'analityczka finansowa',
    'applicants.0.averageNetIncome': 12_500,
    'applicants.0.incomeCurrency': 'PLN',
    'applicants.0.averageNetIncomeInWords': 'dwanaście tysięcy pięćset złotych',
    'applicants.0.salaryPaymentMethod': 'bank_transfer',
    'applicants.0.salaryGarnished': false,
    'applicants.0.adverseEmploymentCircumstances': false,

    'applicants.1.firstName': 'Tomasz',
    'applicants.1.middleName': 'Piotr',
    'applicants.1.lastName': 'Zieliński',
    'applicants.1.pesel': '88050556719',
    'applicants.1.birthDate': '1988-05-05',
    'applicants.1.identityDocumentType': 'dowód osobisty',
    'applicants.1.identityDocumentNumber': 'CBZ654321',
    'applicants.1.birthPlace': 'Gniezno',
    'applicants.1.countryOfResidence': 'Polska',
    'applicants.1.citizenship': 'polskie',
    'applicants.1.phone': '+48600333444',
    'applicants.1.email': 'tomasz.zielinski@example.local',
    'applicants.1.residentialAddress': 'ul. Bukowska 12/34, 60-812 Poznań',
    'applicants.1.correspondenceAddress': 'ul. Bukowska 12/34, 60-812 Poznań',
    'applicants.1.maritalStatus': 'married',
    'applicants.1.maritalPropertyCommunity': true,
    'applicants.1.housingStatus': 'owner',
    'applicants.1.householdSize': 2,
    'applicants.1.childBenefitCount': 0,
    'applicants.1.education': 'higher',
    'applicants.1.occupation': 'architekt',
    'applicants.1.employmentCategory': 'self_employed',
    'applicants.1.incomeSource': 'business',
    'applicants.1.businessLegalForm': 'jednoosobowa działalność gospodarcza',
    'applicants.1.pkdCode': '71.11.Z',
    'applicants.1.employmentTenure': 'over_10_years',
    'applicants.1.businessActiveOrRecentlySuspended': true,
    'applicants.1.monthlyMaintenanceCosts': 2_400,
    'applicants.1.alimonyAndLegalBurdens': 0,
    'applicants.1.collectionProceedings': false,

    'loan.program': 'standard',
    'loan.rkmGuarantee': false,
    'loan.purpose': 'purchase_primary',
    'loan.amount': 760_000,
    'loan.termMonths': 300,
    'loan.repaymentDay': 10,
    'loan.installmentType': 'equal',
    'loan.interestType': 'periodically_fixed',
    'loan.disbursementType': 'tranches',
    'loan.gracePeriod': false,
    'loan.commissionType': 'not_financed',
    'loan.currency': 'PLN',
    'loan.cpiPremiumFinancing': false,
    'loan.mortgageEstablishmentMode': 'notarial_deed',

    'tranches.0.date': '2026-09-15',
    'tranches.0.amount': 380_000,
    'tranches.0.accountOwner': 'Nova Development sp. z o.o.',
    'tranches.1.date': '2027-02-15',
    'tranches.1.amount': 380_000,
    'tranches.1.accountOwner': 'Nova Development sp. z o.o.',

    'investment.totalCost': 980_000,
    'investment.renovationCost': 0,
    'investment.ownFundsPaid': 80_000,
    'investment.ownFundsBeforeDisbursement': 90_000,
    'investment.ownFundsDuringInvestment': 50_000,

    'property.type': 'apartment',
    'property.address.street': 'Bukowska',
    'property.address.houseNumber': '12',
    'property.address.unitNumber': '34',
    'property.address.postalCode': '60-812',
    'property.address.city': 'Poznań',
    'property.address.county': 'Poznań',
    'property.address.voivodeship': 'wielkopolskie',
    'property.landRegisterNumber': 'PO1P/00123456/7',
    'property.marketValue': 1_010_000,
    'property.ownershipType': 'apartment_ownership',
    'property.ownershipSequence': 'first',
    'property.appraisalSource': 'bank_provider',

    'collateralProperty.type': 'apartment',
    'collateralProperty.address': 'ul. Bukowska 12/34, 60-812 Poznań',
    'collateralProperty.landRegisterNumber': 'PO1P/00123456/7',
    'collateralProperty.marketValue': 1_010_000,

    'additionalProducts.enabled': false,
    'additionalProducts.lifeInsurance': false,
    'additionalProducts.propertyInsurance': false,
    'additionalProducts.personalAccount': false,
    'additionalProducts.creditCard': false,

    'consents.electronicDocumentDelivery': true,
    'applicants.0.postContractDataProcessingConsent': true,
    'applicants.1.postContractDataProcessingConsent': true,
    'intermediary.kind': 'intermediary_or_partner',
    'intermediary.name': 'OpenExpert Partner sp. z o.o.',
    'intermediary.email': 'wnioski@openexpert.pl',
    'intermediary.phone': '+48600700800',
    'intermediary.acceptingPerson': 'Michał Ekspert',
    'declarations.art17Information': true,
    'declarations.remunerationInformation': true,
    'declarations.intermediaryTransfersToAgent': false,
    'declarations.selectedLoanRiskVariant': 'periodically_fixed',

    'investor.name': 'Nova Development sp. z o.o.',
    'investor.buyerDetails': 'Alicja Nowak i Tomasz Zieliński',
    'investor.garageShareIncluded': true,
    'investor.garageSharePrice': 45_000,
    'investor.otherSharesIncluded': false,
    'investor.paymentTiming': 'before_notarial_deed',
    'investor.garageShareTargetDescription': 'miejsce postojowe nr 18, udział 1/50',
    'investor.paymentScheduleType': 'tranches',
    'investor.plotNumbers': '142/7, 142/8, obręb Jeżyce',
    'investor.constructionProgressPercent': 62,
    'investor.expectedOwnershipTransferDate': '2027-06-30',
  })

  for (let index = 0; index < 8; index += 1) {
    values[`investorPayments.${index}.date`] = `202${index < 4 ? 6 : 7}-${String((index % 4) + 9).padStart(2, '0')}-15`
    values[`investorPayments.${index}.amount`] = 80_000 + index * 5_000
    values[`investorPayments.${index}.purpose`] = index % 2 === 0 ? 'lokal mieszkalny' : 'etap inwestycji'
  }

  const collectionLimits: Readonly<Record<string, number>> = {
    applicants: 2,
    tranches: 2,
    investorPayments: 8,
    households: 1,
    liabilities: 0,
    mortgageDischarges: 0,
    collateralProperties: 1,
  }
  for (const field of CANONICAL_FIELDS) {
    if (/^applicants\.\d+\.liabilities\./u.test(field.canonicalKey)) {
      delete values[field.canonicalKey]
      continue
    }
    if (
      field.collection
      && field.collection.index >= (collectionLimits[field.collection.key] ?? 0)
    ) {
      delete values[field.canonicalKey]
      continue
    }
    if (!isCanonicalFieldVisible(field, values)) delete values[field.canonicalKey]
  }
  // The official form exposes this amount unconditionally even though it is
  // irrelevant for a pure purchase-primary scenario. Leaving it absent is the
  // only semantically correct representation of "not applicable".
  delete values['loan.arbitraryPurposeAmount']

  return values
}

async function extractText(pdfBytes: Uint8Array, outputName: string) {
  const textAuditDirectory = join(repositoryRoot, 'tmp/pdfs/erste-complete-package-test/text')
  await mkdir(textAuditDirectory, { recursive: true })
  const pdfPath = join(textAuditDirectory, outputName)
  const textPath = join(textAuditDirectory, `${outputName}.txt`)
  await writeFile(pdfPath, pdfBytes)
  await execFileAsync('pdftotext', ['-layout', pdfPath, textPath])
  return readFile(textPath, 'utf8')
}

async function attachmentPdf(title: string, owner: string) {
  const pdf = await PDFDocument.create()
  const fixedDate = new Date('2026-08-09T12:00:00.000Z')
  pdf.setTitle(title)
  pdf.setAuthor('OpenExpert QA')
  pdf.setCreator('OpenExpert automated mortgage-package test')
  pdf.setProducer('pdf-lib')
  pdf.setCreationDate(fixedDate)
  pdf.setModificationDate(fixedDate)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595.28, 841.89])
  page.drawText('OpenExpert QA - representative case attachment', {
    x: 60,
    y: 760,
    size: 16,
    font,
    color: rgb(0.05, 0.05, 0.05),
  })
  page.drawText(title, { x: 60, y: 710, size: 14, font })
  page.drawText(`Owner: ${owner}`, { x: 60, y: 680, size: 11, font })
  page.drawText('Synthetic file used only by the automated mortgage-package test.', {
    x: 60,
    y: 630,
    size: 10,
    font,
  })
  return pdf.save({ updateFieldAppearances: false })
}

test('Erste complete standard couple package contains the exact applicable official forms', async () => {
  const kikApplicant0 = instantiateTemplate(ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE, 0)
  const kikApplicant1 = instantiateTemplate(ERSTE_CLIENT_INFORMATION_CARD_TEMPLATE, 1)
  const incomeApplicant0 = instantiateTemplate(ERSTE_EMPLOYMENT_INCOME_TEMPLATE, 0)
  const incomeApplicant1 = instantiateTemplate(ERSTE_EMPLOYMENT_INCOME_TEMPLATE, 1)

  const activeTemplates = [
    ERSTE_TEMPLATE,
    ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE,
    ERSTE_INVESTOR_STATEMENT_TEMPLATE,
    kikApplicant0,
    kikApplicant1,
    incomeApplicant0,
    ERSTE_RISK_COST_INFORMATION_TEMPLATE,
    ERSTE_GENERAL_MORTGAGE_INFORMATION_TEMPLATE,
  ] as const
  const values = completeScenarioValues(activeTemplates)
  assert.equal(values['loan.arbitraryPurposeAmount'], undefined)

  assert.equal(templateMatchesValues(ERSTE_INVESTOR_STATEMENT_TEMPLATE, values), true)
  assert.equal(templateMatchesValues(kikApplicant0, values), true)
  assert.equal(templateMatchesValues(kikApplicant1, values), true)
  assert.equal(templateMatchesValues(incomeApplicant0, values), true)
  assert.equal(templateMatchesValues(incomeApplicant1, values), false)
  assert.equal(templateMatchesValues(ERSTE_RKM_GUARANTEE_TEMPLATE, values), false)
  assert.equal(templateMatchesValues(ERSTE_RKM_FAMILY_CONDITIONS_TEMPLATE, values), false)

  const additionalRequiredKeys = new Set(activeTemplates.flatMap(template => (
    template.requiredCanonicalKeys ?? []
  )))
  const activeInputKeys = templateInputKeys([
    ...activeTemplates,
    ERSTE_RKM_GUARANTEE_TEMPLATE,
    ERSTE_RKM_FAMILY_CONDITIONS_TEMPLATE,
  ])
  const activeFields = CANONICAL_FIELDS.filter(field => activeInputKeys.has(field.canonicalKey))
  const missingRequiredFields = activeFields.flatMap(field => (
    isCanonicalFieldRequired(field, values, additionalRequiredKeys)
      && !hasValue(values[field.canonicalKey])
      ? [field.canonicalKey]
      : []
  ))
  assert.deepEqual(missingRequiredFields, [])

  const applicantCollection = CANONICAL_COLLECTIONS.find(collection => collection.key === 'applicants')
  assert.ok(applicantCollection)
  const missingApplicantCollectionFields = [0, 1].flatMap(index => (
    applicantCollection.requiredRelativeKeys.flatMap(relativeKey => {
      const key = `applicants.${index}.${relativeKey}`
      const field = activeFields.find(candidate => candidate.canonicalKey === key)
      return field && isCanonicalFieldVisible(field, values) && !hasValue(values[key]) ? [key] : []
    })
  ))
  assert.deepEqual(missingApplicantCollectionFields, [])

  const prepared = prepareBundle(candidateTemplates.map(template => template.id))
  assert.equal(prepared.warnings.length, 0)

  const outputNames = [
    '01-wniosek-glowny.pdf',
    '02-warunki-wstepne.pdf',
    '03-oswiadczenie-inwestora.pdf',
    '04-karta-informacyjna-alicja-nowak.pdf',
    '05-karta-informacyjna-tomasz-zielinski.pdf',
    '06-zaswiadczenie-dochodowe-alicja-nowak.pdf',
    '07-informacja-o-ryzykach-i-kosztach.pdf',
    '08-informacja-ogolna.pdf',
  ] as const

  const sourceAudit: Array<Record<string, unknown>> = []
  const documents = await Promise.all(activeTemplates.map(async (template, index) => {
    const sourceFileName = candidateTemplates.find(candidate => candidate.id === template.id)?.source.fileName
      ?? template.source.fileName
    const sourceBytes = await readFile(join(mockFilesDirectory, sourceFileName))
    const actualSourceSha = sha256(sourceBytes)
    const sourcePdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })

    assert.equal(actualSourceSha, sourceChecksums.get(template.id), template.id)
    assert.equal(actualSourceSha, template.source.sha256, template.id)
    assert.equal(sourcePdf.getPageCount(), template.source.pageCount, template.id)
    sourceAudit.push({
      templateId: template.id,
      fileName: sourceFileName,
      sha256: actualSourceSha,
      pageCount: sourcePdf.getPageCount(),
    })

    return {
      fileName: sourceFileName,
      outputName: outputNames[index],
      template,
      sourceBytes,
      directory: 'Erste Bank Polska',
    }
  }))

  const attachmentDefinitions = [
    {
      sourceName: 'dowod-tozsamosci.pdf',
      archivedName: 'dowod-tozsamosci.pdf',
      title: 'Identity document - applicant 1',
      owner: 'Alicja Nowak',
    },
    {
      sourceName: 'dowod-tozsamosci.pdf',
      archivedName: 'dowod-tozsamosci-2.pdf',
      title: 'Identity document - applicant 2',
      owner: 'Tomasz Zielinski',
    },
    {
      sourceName: 'dokument-dochodowy.pdf',
      archivedName: 'dokument-dochodowy.pdf',
      title: 'Employment and income evidence',
      owner: 'Alicja Nowak',
    },
    {
      sourceName: 'wyciag-z-rachunku.pdf',
      archivedName: 'wyciag-z-rachunku.pdf',
      title: 'Personal bank statement',
      owner: 'Alicja Nowak',
    },
    {
      sourceName: 'pit-dzialalnosc-gospodarcza.pdf',
      archivedName: 'pit-dzialalnosc-gospodarcza.pdf',
      title: 'Business tax return',
      owner: 'Tomasz Zielinski',
    },
    {
      sourceName: 'wyciag-z-rachunku.pdf',
      archivedName: 'wyciag-z-rachunku-2.pdf',
      title: 'Business bank statement',
      owner: 'Tomasz Zielinski',
    },
    {
      sourceName: 'dokumenty-prawne-nieruchomosci.pdf',
      archivedName: 'dokumenty-prawne-nieruchomosci.pdf',
      title: 'Property legal documents',
      owner: 'Case property',
    },
    {
      sourceName: 'operat-szacunkowy.pdf',
      archivedName: 'operat-szacunkowy.pdf',
      title: 'Property valuation report',
      owner: 'Case property',
    },
  ] as const
  const attachmentEntries = await Promise.all(attachmentDefinitions.map(async definition => ({
    ...definition,
    bytes: await attachmentPdf(definition.title, definition.owner),
  })))
  const attachments = attachmentEntries.map(attachment => ({
    fileName: attachment.sourceName,
    bytes: attachment.bytes,
    mimeType: 'application/pdf',
    directory: 'Erste Bank Polska',
  }))

  const archive = await createPdfBundle(
    documents,
    await readFile(fontPath),
    values,
    attachments,
  )
  const files = unzipSync(archive)
  const archiveNames = Object.keys(files).sort((left, right) => left.localeCompare(right, 'pl'))
  const expectedFormArchiveNames = outputNames.map(name => `Erste Bank Polska/01-wnioski/${name}`)
    .sort((left, right) => left.localeCompare(right, 'pl'))
  const expectedAttachmentArchiveNames = attachmentEntries.map(attachment => (
    `Erste Bank Polska/02-dokumenty/${attachment.archivedName}`
  )).sort((left, right) => left.localeCompare(right, 'pl'))
  const expectedArchiveNames = [
    ...expectedFormArchiveNames,
    ...expectedAttachmentArchiveNames,
  ].sort((left, right) => left.localeCompare(right, 'pl'))
  assert.deepEqual(archiveNames, expectedArchiveNames)
  assert.equal(new Set(archiveNames).size, 16)
  assert.equal(archiveNames.some(name => /rkm|gwarancj/iu.test(name)), false)
  assert.equal(archiveNames.some(name => /tomasz.*dochod|dochod.*tomasz/iu.test(name)), false)

  await mkdir(outputDirectory, { recursive: true })
  const zipPath = join(outputDirectory, 'erste-standard-couple-complete.zip')
  await writeFile(zipPath, archive)

  const expectedPageCounts = [9, 9, 3, 9, 9, 3, 14, 20] as const
  const generatedAudit: Array<Record<string, unknown>> = []
  const extractedTexts: string[] = []
  for (const [index, archiveName] of expectedFormArchiveNames.entries()) {
    const bytes = files[archiveName]
    assert.ok(bytes, archiveName)
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    assert.equal(pdf.getPageCount(), expectedPageCounts[index], archiveName)
    assert.equal(pdf.getForm().getFields().length, 0, archiveName)
    const outputName = basename(archiveName)
    await writeFile(join(outputDirectory, outputName), bytes)
    const text = await extractText(bytes, outputName)
    extractedTexts.push(text)
    generatedAudit.push({
      archiveName,
      outputFile: outputName,
      sha256: sha256(bytes),
      pageCount: pdf.getPageCount(),
    })
  }

  assert.equal(generatedAudit.reduce((sum, item) => sum + Number(item.pageCount), 0), 76)

  const attachmentAudit: Array<Record<string, unknown>> = []
  for (const attachment of attachmentEntries) {
    const archiveName = `Erste Bank Polska/02-dokumenty/${attachment.archivedName}`
    const archivedBytes = files[archiveName]
    assert.ok(archivedBytes, archiveName)
    assert.deepEqual(archivedBytes, attachment.bytes, archiveName)
    assert.equal(sha256(archivedBytes), sha256(attachment.bytes), archiveName)
    const pdf = await PDFDocument.load(archivedBytes, { updateMetadata: false })
    assert.equal(pdf.getPageCount(), 1, archiveName)
    await writeFile(join(outputDirectory, attachment.archivedName), archivedBytes)
    attachmentAudit.push({
      archiveName,
      sourceName: attachment.sourceName,
      outputFile: attachment.archivedName,
      sha256: sha256(archivedBytes),
      pageCount: pdf.getPageCount(),
    })
  }
  assert.equal(attachmentAudit.length, 8)
  assert.equal(
    generatedAudit.reduce((sum, item) => sum + Number(item.pageCount), 0)
      + attachmentAudit.reduce((sum, item) => sum + Number(item.pageCount), 0),
    84,
  )

  const [mainText, preliminaryText, investorText, kik0Text, kik1Text, income0Text] = extractedTexts
  assert.match(mainText!, /Alicja Nowak/u)
  assert.match(mainText!, /Tomasz Zieliński/u)
  assert.doesNotMatch(mainText!, /85010112345/u)
  assert.match(preliminaryText!, /Alicja Nowak/u)
  assert.match(preliminaryText!, /Tomasz Zieliński/u)
  assert.doesNotMatch(preliminaryText!, /85010112345/u)
  assert.match(investorText!, /Alicja Nowak i Tomasz Zieliński/u)

  assert.match(kik0Text!, /Alicja/u)
  assert.match(kik0Text!, /Nowak/u)
  assert.doesNotMatch(kik0Text!, /Tomasz|Zieliński|88050556719/u)
  assert.match(kik1Text!, /Tomasz/u)
  assert.match(kik1Text!, /Zieliński/u)
  assert.doesNotMatch(kik1Text!, /Alicja|90010112349/u)
  assert.match(income0Text!, /Alicja Nowak/u)
  assert.match(income0Text!, /OpenExpert Technologie sp\. z o\.o\./u)
  assert.doesNotMatch(income0Text!, /Tomasz|Zieliński|88050556719/u)

  const qaReport = {
    scenario: {
      applicants: [
        { name: 'Alicja Nowak', incomeSource: 'employment' },
        { name: 'Tomasz Zieliński', incomeSource: 'business' },
      ],
      loanProgram: 'standard',
      loanPurpose: 'purchase_primary',
      generatedBankFormCount: expectedFormArchiveNames.length,
      generatedBankFormPageCount: 76,
      attachmentCount: expectedAttachmentArchiveNames.length,
      packagePdfCount: expectedArchiveNames.length,
      packagePageCount: 84,
      rkmIncluded: false,
    },
    requiredFieldAudit: {
      activeFieldCount: activeFields.length,
      explicitTemplateRequiredKeyCount: additionalRequiredKeys.size,
      missingRequiredFields,
      missingApplicantCollectionFields,
    },
    sourceAudit: sourceAudit.sort((left, right) => String(left.templateId).localeCompare(String(right.templateId))),
    generatedAudit,
    attachmentAudit,
    archiveNames: expectedArchiveNames,
    assertions: {
      applicant0KikContainsOnlyApplicant0: true,
      applicant1KikContainsOnlyApplicant1: true,
      applicant0IncomeContainsOnlyApplicant0: true,
      applicant1IncomeExcludedForBusiness: true,
      rkmDocumentsExcludedForStandardProgram: true,
      allAttachmentsStoredUnderBankDocumentFolder: true,
      collidingAttachmentNamesMadeUnique: true,
      attachmentChecksumsPreserved: true,
    },
  }
  await writeFile(
    join(outputDirectory, 'qa-report.json'),
    `${JSON.stringify(qaReport, null, 2)}\n`,
  )
})
