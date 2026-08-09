import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getTemplate,
  instantiateTemplate,
  PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE,
  PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE,
  PEKAO_CURRENT_TEMPLATES,
  PEKAO_EMPLOYER_INCOME_CERTIFICATE_TEMPLATE,
  PEKAO_TEMPLATE,
  templateMatchesValues,
  validateTemplateJson,
} from '../src/index.ts'

const mockDirectory = new URL('../../../mock-files/', import.meta.url)
const officialDirectory = new URL('../../database/data/mortgages/official-bank-file-assets/', import.meta.url)

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('aktualne PDF-y Pekao są zarejestrowane i przypięte do oficjalnych bajtów', async () => {
  assert.equal(PEKAO_CURRENT_TEMPLATES.length, 15)
  assert.equal(new Set(PEKAO_CURRENT_TEMPLATES.map(template => template.id)).size, 15)

  for (const template of PEKAO_CURRENT_TEMPLATES) {
    assert.equal(getTemplate(template.id), template)
    const validation = validateTemplateJson(template)
    assert.equal(validation.valid, true, template.id)
    assert.equal(validation.fillReady, true, template.id)
    assert.equal(validation.warnings.length, 0, template.id)

    const [mockBytes, officialBytes] = await Promise.all([
      readFile(new URL(template.source.fileName, mockDirectory)),
      readFile(new URL(template.source.fileName, officialDirectory)),
    ])
    assert.equal(sha256(mockBytes), template.source.sha256, template.id)
    assert.deepEqual(mockBytes, officialBytes, template.id)
  }
})

test('aktualny wniosek Pekao nie używa niezgodnego mapowania wersji 2025', () => {
  assert.equal(PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE.id, 'pekao-mortgage-2026-manual')
  assert.equal(PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE.fillMethod?.kind, 'pdf_manual')
  assert.equal(PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE.source.formKind, 'acroform')
  assert.equal(
    PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE.source.sha256,
    '735c8457af4dec79c31ccb702fd3c2b77a5fdb57939781f5476a04fdd667374a',
  )
  assert.equal(PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE.bindings.length, 0)

  assert.equal(PEKAO_TEMPLATE.id, 'pekao-mortgage-2025')
  assert.equal(
    PEKAO_TEMPLATE.source.sha256,
    'f9d16ec8fc7810c9b8e6301eeb8e0b9c190d9ebc3f29acb356648bf1f06f79bc',
  )
})

test('formularze Pekao per osoba filtrują źródła dochodu', () => {
  const card0 = instantiateTemplate(PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE, 0)
  const card1 = instantiateTemplate(PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE, 1)
  const income0 = instantiateTemplate(PEKAO_EMPLOYER_INCOME_CERTIFICATE_TEMPLATE, 0)
  const income1 = instantiateTemplate(PEKAO_EMPLOYER_INCOME_CERTIFICATE_TEMPLATE, 1)
  const values = {
    'applicants.0.incomeSource': 'employment',
    'applicants.1.incomeSource': 'business',
  }

  assert.equal(templateMatchesValues(card0, values), true)
  assert.equal(templateMatchesValues(card1, values), true)
  assert.equal(templateMatchesValues(income0, values), true)
  assert.equal(templateMatchesValues(income1, values), false)
})

test('Pekao rozróżnia ręczne formularze i materiały tylko do odczytu', () => {
  assert.equal(
    PEKAO_CURRENT_TEMPLATES.filter(template => template.fillMethod?.kind === 'pdf_manual').length,
    10,
  )
  assert.equal(
    PEKAO_CURRENT_TEMPLATES.filter(template => template.fillMethod?.kind === 'pdf_readonly').length,
    5,
  )
  assert.equal(PEKAO_CURRENT_TEMPLATES.every(template => template.bindings.length === 0), true)
})
