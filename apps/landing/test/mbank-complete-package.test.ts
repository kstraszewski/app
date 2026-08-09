import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'

import {
  instantiateTemplate,
  MBANK_APPLICANT_DATA_TEMPLATE,
  MBANK_BUSINESS_DATA_TEMPLATE,
  MBANK_EMPLOYMENT_INCOME_TEMPLATE,
  MBANK_GENERAL_INFORMATION_TEMPLATE,
  MBANK_INFORMATION_REQUEST_TEMPLATE,
  MBANK_RISK_INFORMATION_TEMPLATE,
  type DocumentTemplate,
} from '@openexpert/multiform'
import { unzipSync } from 'fflate'
import { PDFDocument, PDFName } from 'pdf-lib'

import { createPdfBundle } from '../server/utils/multiform-pdf.ts'

const root = new URL('../../../', import.meta.url)
const mockDirectory = new URL('mock-files/', root)
const fontUrl = new URL('apps/landing/public/fonts/DMSans-VariableFont_opsz,wght.ttf', root)
const outputDirectory = new URL('output/pdf/mbank-complete-package-test/', root)

function namedDocument(
  template: DocumentTemplate,
  outputName?: string,
) {
  return {
    fileName: template.source.fileName,
    template,
    sourceBytes: readFile(new URL(template.source.fileName, mockDirectory)),
    ...(outputName ? { outputName } : {}),
    directory: 'mBank',
  }
}

test('mBank standard couple package contains the complete public first-stage form set', async () => {
  const applicant0 = instantiateTemplate(MBANK_APPLICANT_DATA_TEMPLATE, 0)
  const applicant1 = instantiateTemplate(MBANK_APPLICANT_DATA_TEMPLATE, 1)
  const employment0 = instantiateTemplate(MBANK_EMPLOYMENT_INCOME_TEMPLATE, 0)
  const business1 = instantiateTemplate(MBANK_BUSINESS_DATA_TEMPLATE, 1)
  const values = {
    'applicants.0.incomeSource': 'employment',
    'applicants.1.incomeSource': 'business',
  }
  const requested = [
    namedDocument(MBANK_INFORMATION_REQUEST_TEMPLATE),
    namedDocument(applicant0, 'mbank-zalacznik-dane-wnioskodawcy-alicja.pdf'),
    namedDocument(applicant1, 'mbank-zalacznik-dane-wnioskodawcy-tomasz.pdf'),
    namedDocument(employment0, 'mbank-zaswiadczenie-o-zatrudnieniu-alicja.pdf'),
    namedDocument(business1, 'mbank-zalacznik-dzialalnosc-tomasz.pdf'),
    namedDocument(MBANK_GENERAL_INFORMATION_TEMPLATE),
    namedDocument(MBANK_RISK_INFORMATION_TEMPLATE),
  ]
  const documents = await Promise.all(requested.map(async document => ({
    ...document,
    sourceBytes: await document.sourceBytes,
  })))
  const zipBytes = await createPdfBundle(
    documents,
    await readFile(fontUrl),
    values,
  )
  const files = unzipSync(zipBytes)
  const names = Object.keys(files).sort()

  assert.deepEqual(names, [
    'mBank/01-wnioski/mbank-informacja-o-ryzykach-2026-03-04.pdf',
    'mBank/01-wnioski/mbank-ogolne-informacje-kredyt-hipoteczny.pdf',
    'mBank/01-wnioski/mbank-wniosek-o-formularz-informacyjny-2026-03-31.pdf',
    'mBank/01-wnioski/mbank-zalacznik-dane-wnioskodawcy-alicja.pdf',
    'mBank/01-wnioski/mbank-zalacznik-dane-wnioskodawcy-tomasz.pdf',
    'mBank/01-wnioski/mbank-zalacznik-dzialalnosc-tomasz.pdf',
    'mBank/01-wnioski/mbank-zaswiadczenie-o-zatrudnieniu-alicja.pdf',
  ])

  const expectedPages = new Map([
    ['mbank-wniosek-o-formularz-informacyjny-2026-03-31.pdf', 11],
    ['mbank-zalacznik-dane-wnioskodawcy-alicja.pdf', 9],
    ['mbank-zalacznik-dane-wnioskodawcy-tomasz.pdf', 9],
    ['mbank-zaswiadczenie-o-zatrudnieniu-alicja.pdf', 2],
    ['mbank-zalacznik-dzialalnosc-tomasz.pdf', 3],
    ['mbank-ogolne-informacje-kredyt-hipoteczny.pdf', 5],
    ['mbank-informacja-o-ryzykach-2026-03-04.pdf', 29],
  ])
  let pageCount = 0
  for (const [name, bytes] of Object.entries(files)) {
    const baseName = name.split('/').at(-1) ?? ''
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    assert.equal(pdf.catalog.has(PDFName.of('OpenAction')), false)
    assert.equal(pdf.getPageCount(), expectedPages.get(baseName), baseName)
    pageCount += pdf.getPageCount()
  }
  assert.equal(pageCount, 68)

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(new URL('mbank-standard-couple-public-stage.zip', outputDirectory), zipBytes)
  await writeFile(
    new URL('qa-report.json', outputDirectory),
    `${JSON.stringify({ files: names, pageCount, status: 'pass' }, null, 2)}\n`,
  )
})
