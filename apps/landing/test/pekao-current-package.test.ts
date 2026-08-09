import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'

import {
  instantiateTemplate,
  PEKAO_APPLICANT_EMPLOYMENT_STATEMENT_TEMPLATE,
  PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE,
  PEKAO_BUSINESS_STATEMENT_TEMPLATE,
  PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE,
  PEKAO_EMPLOYER_INCOME_CERTIFICATE_TEMPLATE,
  PEKAO_GENERAL_MORTGAGE_INFORMATION_TEMPLATE,
  PEKAO_IAD_INFORMATION_TEMPLATE,
  templateMatchesValues,
  type DocumentTemplate,
} from '@openexpert/multiform'
import { unzipSync } from 'fflate'
import { PDFDocument, PDFName } from 'pdf-lib'

import { createPdfBundle } from '../server/utils/multiform-pdf.ts'

const root = new URL('../../../', import.meta.url)
const mockDirectory = new URL('mock-files/', root)
const fontUrl = new URL('apps/landing/public/fonts/DMSans-VariableFont_opsz,wght.ttf', root)
const outputDirectory = new URL('output/pdf/pekao-current-package-test/', root)

function namedDocument(template: DocumentTemplate, outputName?: string) {
  return {
    fileName: template.source.fileName,
    template,
    sourceBytes: readFile(new URL(template.source.fileName, mockDirectory)),
    ...(outputName ? { outputName } : {}),
    directory: 'Bank Pekao',
  }
}

test('bieżąca paczka Pekao dla pary zawiera właściwe formularze i nie używa starego mapowania', async () => {
  const values = {
    'applicants.0.incomeSource': 'employment',
    'applicants.1.incomeSource': 'business',
  }
  const applicantCard0 = instantiateTemplate(PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE, 0)
  const applicantCard1 = instantiateTemplate(PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE, 1)
  const iad0 = instantiateTemplate(PEKAO_IAD_INFORMATION_TEMPLATE, 0)
  const iad1 = instantiateTemplate(PEKAO_IAD_INFORMATION_TEMPLATE, 1)
  const incomeCertificate0 = instantiateTemplate(PEKAO_EMPLOYER_INCOME_CERTIFICATE_TEMPLATE, 0)
  const employmentStatement0 = instantiateTemplate(PEKAO_APPLICANT_EMPLOYMENT_STATEMENT_TEMPLATE, 0)
  const businessStatement1 = instantiateTemplate(PEKAO_BUSINESS_STATEMENT_TEMPLATE, 1)

  assert.equal(templateMatchesValues(incomeCertificate0, values), true)
  assert.equal(templateMatchesValues(businessStatement1, values), true)

  const requested = [
    namedDocument(PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE),
    namedDocument(applicantCard0, 'pekao-karta-informacyjna-alicja.pdf'),
    namedDocument(applicantCard1, 'pekao-karta-informacyjna-tomasz.pdf'),
    namedDocument(iad0, 'pekao-formularz-iad-alicja.pdf'),
    namedDocument(iad1, 'pekao-formularz-iad-tomasz.pdf'),
    namedDocument(PEKAO_GENERAL_MORTGAGE_INFORMATION_TEMPLATE),
    namedDocument(incomeCertificate0, 'pekao-zaswiadczenie-o-zatrudnieniu-alicja.pdf'),
    namedDocument(employmentStatement0, 'pekao-oswiadczenie-o-zatrudnieniu-alicja.pdf'),
    namedDocument(businessStatement1, 'pekao-oswiadczenie-o-dzialalnosci-tomasz.pdf'),
  ]
  const documents = await Promise.all(requested.map(async document => ({
    ...document,
    sourceBytes: await document.sourceBytes,
  })))
  const zipBytes = await createPdfBundle(documents, await readFile(fontUrl), values)
  const files = unzipSync(zipBytes)
  const names = Object.keys(files).sort()

  assert.deepEqual(names, [
    'Bank Pekao/01-wnioski/pekao-formularz-iad-alicja.pdf',
    'Bank Pekao/01-wnioski/pekao-formularz-iad-tomasz.pdf',
    'Bank Pekao/01-wnioski/pekao-informacje-ogolne-kredyt-hipoteczny-2026-06.pdf',
    'Bank Pekao/01-wnioski/pekao-karta-informacyjna-alicja.pdf',
    'Bank Pekao/01-wnioski/pekao-karta-informacyjna-tomasz.pdf',
    'Bank Pekao/01-wnioski/pekao-oswiadczenie-o-dzialalnosci-tomasz.pdf',
    'Bank Pekao/01-wnioski/pekao-oswiadczenie-o-zatrudnieniu-alicja.pdf',
    'Bank Pekao/01-wnioski/pekao-wniosek-o-kredyt-mieszkaniowy-2026-06-02.pdf',
    'Bank Pekao/01-wnioski/pekao-zaswiadczenie-o-zatrudnieniu-alicja.pdf',
  ])

  const expectedPages = new Map([
    ['pekao-wniosek-o-kredyt-mieszkaniowy-2026-06-02.pdf', 6],
    ['pekao-karta-informacyjna-alicja.pdf', 8],
    ['pekao-karta-informacyjna-tomasz.pdf', 8],
    ['pekao-formularz-iad-alicja.pdf', 3],
    ['pekao-formularz-iad-tomasz.pdf', 3],
    ['pekao-informacje-ogolne-kredyt-hipoteczny-2026-06.pdf', 16],
    ['pekao-zaswiadczenie-o-zatrudnieniu-alicja.pdf', 2],
    ['pekao-oswiadczenie-o-zatrudnieniu-alicja.pdf', 2],
    ['pekao-oswiadczenie-o-dzialalnosci-tomasz.pdf', 6],
  ])
  let pageCount = 0
  for (const [name, bytes] of Object.entries(files)) {
    const baseName = name.split('/').at(-1) ?? ''
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    assert.equal(pdf.catalog.has(PDFName.of('OpenAction')), false, baseName)
    assert.equal(pdf.catalog.has(PDFName.of('AA')), false, baseName)
    assert.equal(pdf.getPageCount(), expectedPages.get(baseName), baseName)
    pageCount += pdf.getPageCount()
  }
  assert.equal(pageCount, 54)

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(new URL('pekao-standard-couple-current-stage.zip', outputDirectory), zipBytes)
  await writeFile(
    new URL('qa-report.json', outputDirectory),
    `${JSON.stringify({ files: names, pageCount, status: 'pass' }, null, 2)}\n`,
  )
})
