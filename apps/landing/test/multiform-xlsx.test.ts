import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE } from '@openexpert/multiform'
import { strFromU8, unzipSync } from 'fflate'

import { createDocumentBundle, fillDocumentTemplate } from '../server/utils/multiform-pdf.ts'
import { fillXlsxTemplate } from '../server/utils/multiform-xlsx.ts'

const sourceUrl = new URL(
  '../../../mock-files/pekao-kosztorys-budowlano-remontowy-2026-03-05.xlsx',
  import.meta.url,
)

const values = {
  'applicants.0.firstName': 'Anna',
  'applicants.0.lastName': 'Nowak',
  'property.type': 'house',
  'property.usableArea': 145.5,
  'loan.purpose': 'construction',
  'property.address.postalCode': '05-500',
  'property.address.voivodeship': 'mazowieckie',
  'property.address.city': 'Piaseczno',
  'property.address.street': 'Słoneczna',
  'property.address.houseNumber': '12',
  'property.hasBasement': true,
  'property.buildingFootprintArea': 110,
  'property.totalArea': 175,
  'property.aboveGroundFloors': 2,
  'property.buildingForm': 'detached',
  'loan.amount': 640_000,
  'property.preWorksValue': 180_000,
  'investment.completionDate': '2027-12-31',
  'loan.disbursementType': 'tranches',
  'tranches.0.ownFundsBeforeDisbursement': 50_000,
  'tranches.0.date': '2026-12-15',
  'tranches.0.amount': 120_000,
} as const

function worksheetXml(files: Record<string, Uint8Array>, path = 'xl/worksheets/sheet1.xml') {
  const bytes = files[path]
  assert.ok(bytes, path)
  return strFromU8(bytes)
}

function cellXml(xml: string, address: string) {
  const match = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*?(?:\\s*/>|>[\\s\\S]*?</c>)`, 'u').exec(xml)
  assert.ok(match, address)
  return match[0]
}

function formulas(files: Record<string, Uint8Array>) {
  return Object.entries(files)
    .filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(path))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, bytes]) => (
      [...strFromU8(bytes).matchAll(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/gu)]
        .map(match => `${path}:${match[0]}`)
    ))
}

function formulaCount(files: Record<string, Uint8Array>) {
  return Object.entries(files)
    .filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(path))
    .reduce((count, [, bytes]) => count + [...strFromU8(bytes).matchAll(/<f(?:\s|>)/gu)].length, 0)
}

test('native XLSX filling preserves Pekao formulas, styles and protected workbook structure', async () => {
  const source = await readFile(sourceUrl)
  const output = fillXlsxTemplate(
    PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE,
    source,
    values,
  )
  const sourceFiles = unzipSync(source)
  const outputFiles = unzipSync(output)
  const outputSheet = worksheetXml(outputFiles)

  assert.match(cellXml(outputSheet, 'F3'), /Anna Nowak/u)
  assert.match(cellXml(outputSheet, 'J3'), /Dom jednorodzinny/u)
  assert.match(cellXml(outputSheet, 'H4'), /Budowa/u)
  assert.match(cellXml(outputSheet, 'J5'), /Słoneczna 12/u)
  assert.match(cellXml(outputSheet, 'F6'), /TAK/u)
  assert.match(cellXml(outputSheet, 'J10'), /<v>640000<\/v>/u)
  assert.match(cellXml(outputSheet, 'H74'), /<v>46752<\/v>/u)
  assert.match(cellXml(outputSheet, 'G77'), /<v>50000<\/v>/u)
  assert.match(cellXml(outputSheet, 'H77'), /<v>46371<\/v>/u)
  assert.match(cellXml(outputSheet, 'I77'), /<v>120000<\/v>/u)

  assert.deepEqual(formulas(outputFiles), formulas(sourceFiles))
  assert.equal(formulaCount(outputFiles), 455)
  assert.deepEqual(outputFiles['xl/styles.xml'], sourceFiles['xl/styles.xml'])
  assert.deepEqual(outputFiles['xl/worksheets/sheet2.xml'], sourceFiles['xl/worksheets/sheet2.xml'])
  assert.deepEqual(outputFiles['xl/worksheets/sheet3.xml'], sourceFiles['xl/worksheets/sheet3.xml'])
  assert.equal(outputFiles['xl/calcChain.xml'], undefined)

  const workbook = strFromU8(outputFiles['xl/workbook.xml']!)
  assert.match(workbook, /<workbookProtection\b[^>]*lockStructure="1"/u)
  assert.match(workbook, /<sheet name="Wyliczenia"[^>]*state="hidden"/u)
  assert.match(workbook, /<calcPr\b[^>]*calcMode="auto"[^>]*fullCalcOnLoad="1"[^>]*forceFullCalc="1"/u)
  assert.doesNotMatch(workbook, /<calcPr[^>]*\/\s+calcMode=/u)
})

test('generic document renderer and ZIP bundle keep the XLSX extension', async () => {
  const source = await readFile(sourceUrl)
  const filled = await fillDocumentTemplate(
    PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE,
    source,
    new Uint8Array(),
    values,
  )
  assert.equal(formulaCount(unzipSync(filled)), 455)

  const archive = await createDocumentBundle([
    {
      fileName: PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE.source.fileName,
      template: PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE,
      sourceBytes: source,
      directory: 'Pekao',
    },
  ], new Uint8Array(), values)
  const entries = unzipSync(archive)
  assert.deepEqual(Object.keys(entries), [
    'Pekao/01-wnioski/uzupelniony-pekao-kosztorys-budowlano-remontowy-2026-03-05.xlsx',
  ])
  assert.equal(formulaCount(unzipSync(Object.values(entries)[0]!)), 455)
})
