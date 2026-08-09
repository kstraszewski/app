import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE,
  validateTemplateJson,
} from '../src/index.ts'

const sourceUrl = new URL(
  '../../../mock-files/pekao-kosztorys-budowlano-remontowy-2026-03-05.xlsx',
  import.meta.url,
)

test('Pekao construction cost estimate uses the reviewed native XLSX method', async () => {
  const template = PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE
  const validation = validateTemplateJson(template)

  assert.equal(template.fillMethod?.kind, 'xlsx_native')
  assert.equal(template.source.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(template.source.workbook?.formulaCellCount, 455)
  assert.equal(template.bindings.length, 35)
  assert.equal(template.bindings.every(binding => binding.target.kind === 'xlsx_cell'), true)
  assert.equal(new Set(template.bindings.map(binding => (
    binding.target.kind === 'xlsx_cell'
      ? `${binding.target.sheet}:${binding.target.cell}`
      : ''
  ))).size, 35)
  assert.equal(validation.valid, true, JSON.stringify(validation.errors))
  assert.equal(validation.summary.activationReady, true, JSON.stringify(validation.warnings))

  const bytes = await readFile(sourceUrl)
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    template.source.sha256,
  )
})
