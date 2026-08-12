import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  ERSTE_INVESTOR_STATEMENT_TEMPLATE,
  ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE,
} from '@openexpert/multiform'
import { PDFDocument } from 'pdf-lib'

import { fillPdfTemplate } from '../server/utils/multiform-pdf.ts'

const execFileAsync = promisify(execFile)
const fontBytesPromise = readFile(new URL(
  '../public/fonts/DMSans-VariableFont_opsz,wght.ttf',
  import.meta.url,
))

const PRELIMINARY_VALUES: Record<string, unknown> = {
  'application.place': 'Poznań',
  'application.date': '2026-08-09',
  'applicants.0.firstName': 'Alicja',
  'applicants.0.lastName': 'Nowak',
  'applicants.0.pesel': '90010112349',
  'applicants.1.firstName': 'Tomasz',
  'applicants.1.lastName': 'Nowak',
  'applicants.1.pesel': '88050556719',
  'applicants.2.firstName': 'Maria',
  'applicants.2.lastName': 'Kowalska',
  'applicants.2.pesel': '92020267853',
  'applicants.3.firstName': 'Jan',
  'applicants.3.lastName': 'Kowalski',
  'applicants.3.pesel': '85030343211',
  'loan.purpose': 'purchase_primary',
  'investment.totalCost': 980000,
  'investment.renovationCost': 45000,
  'investment.ownFundsPaid': 80000,
  'investment.ownFundsBeforeDisbursement': 90000,
  'investment.ownFundsDuringInvestment': 50000,
  'loan.amount': 760000,
  'loan.arbitraryPurposeAmount': 0,
  'loan.termMonths': 300,
  'loan.interestType': 'periodically_fixed',
  'loan.disbursementType': 'tranches',
  'loan.installmentType': 'equal',
  'loan.gracePeriod': true,
  'loan.gracePeriodMonths': 6,
  'property.type': 'apartment',
  'property.address.street': 'Bukowska',
  'property.address.houseNumber': '12',
  'property.address.unitNumber': '34',
  'property.address.postalCode': '60-812',
  'property.address.city': 'Poznań',
  'property.address.county': 'Poznań',
  'property.address.voivodeship': 'wielkopolskie',
  'property.landRegisterNumber': 'PO1P/00123456/7',
  'property.marketValue': 1010000,
  'collateralProperty.type': 'apartment',
  'collateralProperty.address': 'ul. Bukowska 12/34, 60-812 Poznań',
  'collateralProperty.landRegisterNumber': 'PO1P/00123456/7',
  'collateralProperty.marketValue': 1010000,
  'additionalProducts.enabled': true,
  'additionalProducts.lifeInsurance': true,
  'additionalProducts.propertyInsurance': true,
  'additionalProducts.personalAccount': true,
  'additionalProducts.creditCard': true,
  'additionalProducts.creditCardApplicant': 'Alicja Nowak',
  'additionalProducts.creditCardLimit': 15000,
  'consents.electronicDocumentDelivery': true,
  'applicants.0.postContractDataProcessingConsent': true,
  'applicants.1.postContractDataProcessingConsent': true,
  'applicants.2.postContractDataProcessingConsent': false,
  'applicants.3.postContractDataProcessingConsent': true,
  'application.submissionChannel': 'intermediary',
  'intermediary.kind': 'intermediary_or_partner',
  'intermediary.name': 'OpenExpert Partner sp. z o.o.',
  'intermediary.email': 'wnioski@openexpert.pl',
  'intermediary.phone': '+48 600 700 800',
  'intermediary.acceptingPerson': 'Michał Ekspert',
  'declarations.art17Information': true,
  'declarations.remunerationInformation': true,
  'declarations.intermediaryTransfersToAgent': true,
  'declarations.transferAgentName': 'Anna Agent',
}

const INVESTOR_VALUES: Record<string, unknown> = {
  'application.date': '2026-08-09',
  'loan.purpose': 'purchase_primary',
  'investor.name': 'Nova Development sp. z o.o.',
  'investor.buyerDetails': 'Alicja Nowak i Tomasz Nowak',
  'property.type': 'apartment',
  'investment.totalCost': 980000,
  'investor.garageShareIncluded': true,
  'investor.garageSharePrice': 45000,
  'investor.otherSharesIncluded': true,
  'investor.otherSharesPrice': 12000,
  'investor.paymentTiming': 'before_notarial_deed',
  'property.address.street': 'Bukowska',
  'property.address.houseNumber': '12',
  'property.address.unitNumber': '34',
  'property.address.postalCode': '60-812',
  'property.address.city': 'Poznań',
  'property.address.county': 'Poznań',
  'property.address.voivodeship': 'wielkopolskie',
  'investor.garageShareTargetDescription': 'udział 1/50, ul. Bukowska 12, Poznań, KW PO1P/00987654/3',
  'investor.paymentScheduleType': 'tranches',
  'investor.plotNumbers': '142/7, 142/8, obręb Jeżyce',
  'investor.constructionProgressPercent': 62,
  'investor.expectedOwnershipTransferDate': '2027-06-30',
  ...Object.fromEntries([
    '2026-09-15',
    '2026-10-15',
    '2026-11-15',
    '2026-12-15',
    '2027-01-15',
    '2027-02-15',
    '2027-03-15',
    '2027-04-15',
  ].map((date, index) => [`investorPayments.${index}.date`, date])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `investorPayments.${index}.amount`,
    100000 + index * 5000,
  ])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `investorPayments.${index}.purpose`,
    index % 2 === 0 ? 'za lokal' : 'za udział',
  ])),
}

const HOUSE_INVESTOR_VALUES: Record<string, unknown> = {
  'application.date': '2026-08-09',
  'loan.purpose': 'purchase_primary',
  'investor.name': 'Domy Zielone sp. z o.o.',
  'investor.buyerDetails': 'Maria Kowalska i Jan Kowalski',
  'property.type': 'house',
  'investment.totalCost': 1250000,
  'investor.garageShareIncluded': false,
  'investor.otherSharesIncluded': false,
  'investor.paymentTiming': 'after_notarial_deed',
  'investor.houseTargetDescription': 'działka 88/12, 640 m², Lusowo, ul. Ogrodowa 7',
  'investor.plotNumbers': '88/12, obręb Lusowo',
  'investor.constructionProgressPercent': 84,
  'investor.expectedOwnershipTransferDate': '2027-02-26',
}

async function extractText(pdfBytes: Uint8Array, label: string) {
  const directory = await mkdtemp(join(tmpdir(), `erste-${label}-`))
  try {
    const pdfPath = join(directory, `${label}.pdf`)
    const textPath = join(directory, `${label}.txt`)
    await writeFile(pdfPath, pdfBytes)
    await execFileAsync('pdftotext', ['-layout', pdfPath, textPath])
    return readFile(textPath, 'utf8')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('renders the official 9-page preliminary conditions for four applicants', async () => {
  const sourceBytes = await readFile(new URL(
    '../../../mock-files/erste-wniosek-o-warunki-wstepne-kredytu-hipotecznego-2026-07-20.pdf',
    import.meta.url,
  ))
  const outputBytes = await fillPdfTemplate(
    ERSTE_PRELIMINARY_CONDITIONS_TEMPLATE,
    sourceBytes,
    await fontBytesPromise,
    PRELIMINARY_VALUES,
  )
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  assert.equal(output.getPageCount(), 9)
  assert.equal(output.getForm().getFields().length, 0)
  assert.notEqual(Buffer.compare(Buffer.from(outputBytes), Buffer.from(sourceBytes)), 0)

  const text = await extractText(outputBytes, 'preliminary')
  assert.match(text, /Alicja Nowak/u)
  assert.match(text, /Tomasz Nowak/u)
  assert.match(text, /Maria Kowalska/u)
  assert.match(text, /Jan Kowalski/u)
  assert.match(text, /OpenExpert Partner sp\. z o\.o\./u)
})

test('renders the official 3-page investor statement and all eight payment rows', async () => {
  const sourceBytes = await readFile(new URL(
    '../../../mock-files/erste-oswiadczenie-inwestora-2026-04-25.pdf',
    import.meta.url,
  ))
  const outputBytes = await fillPdfTemplate(
    ERSTE_INVESTOR_STATEMENT_TEMPLATE,
    sourceBytes,
    await fontBytesPromise,
    INVESTOR_VALUES,
  )
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  assert.equal(output.getPageCount(), 3)
  assert.equal(output.getForm().getFields().length, 0)
  assert.notEqual(Buffer.compare(Buffer.from(outputBytes), Buffer.from(sourceBytes)), 0)

  const text = await extractText(outputBytes, 'investor')
  assert.match(text, /Nova Development sp\. z o\.o\./u)
  assert.match(text, /Alicja Nowak i Tomasz Nowak/u)
  assert.equal((text.match(/za lokal/gu) ?? []).length >= 4, true)
  assert.equal((text.match(/za udział/gu) ?? []).length >= 4, true)
  assert.match(text, /142\/7, 142\/8, obręb Jeżyce/u)
})

test('renders the investor statement house branch paid after the notarial deed', async () => {
  const sourceBytes = await readFile(new URL(
    '../../../mock-files/erste-oswiadczenie-inwestora-2026-04-25.pdf',
    import.meta.url,
  ))
  const outputBytes = await fillPdfTemplate(
    ERSTE_INVESTOR_STATEMENT_TEMPLATE,
    sourceBytes,
    await fontBytesPromise,
    HOUSE_INVESTOR_VALUES,
  )
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false })
  assert.equal(output.getPageCount(), 3)
  assert.equal(output.getForm().getFields().length, 0)

  const text = await extractText(outputBytes, 'investor-house')
  assert.match(text, /Domy Zielone sp\. z o\.o\./u)
  assert.match(text, /Maria Kowalska i Jan Kowalski/u)
  assert.match(text, /działka 88\/12, 640 m², Lusowo, ul\. Ogrodowa 7/u)
  assert.match(text, /88\/12, obręb Lusowo/u)
})
