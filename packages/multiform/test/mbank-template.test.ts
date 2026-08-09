import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createHash } from 'node:crypto'

import {
  getTemplate,
  instantiateTemplate,
  MBANK_TEMPLATES,
  templateMatchesValues,
  validateTemplateJson,
} from '../src/index.ts'

const mockDirectory = new URL('../../../mock-files/', import.meta.url)
const officialDirectory = new URL('../../database/data/mortgages/official-bank-file-assets/', import.meta.url)

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('mBank templates pin every packaged PDF to an audited local bank-file source', async () => {
  assert.equal(MBANK_TEMPLATES.length, 8)
  for (const template of MBANK_TEMPLATES) {
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

test('mBank manual application forms repeat and filter by each applicant income source', () => {
  const applicant = getTemplate('mbank-applicant-data-2026')
  const business = getTemplate('mbank-business-data-2026')
  const employment = getTemplate('mbank-employment-income-2026')
  const civil = getTemplate('mbank-civil-contract-income-2026')
  assert.ok(applicant?.repeatFor)
  assert.ok(business?.repeatFor)
  assert.ok(employment?.repeatFor)
  assert.ok(civil?.repeatFor)

  const values = {
    'applicants.0.incomeSource': 'employment',
    'applicants.1.incomeSource': 'business',
    'applicants.2.incomeSource': 'civil_contract',
  }
  assert.equal(templateMatchesValues(instantiateTemplate(applicant, 0), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(applicant, 2), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(employment, 0), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(employment, 1), values), false)
  assert.equal(templateMatchesValues(instantiateTemplate(business, 1), values), true)
  assert.equal(templateMatchesValues(instantiateTemplate(business, 2), values), false)
  assert.equal(templateMatchesValues(instantiateTemplate(civil, 2), values), true)
})

test('mBank distinguishes hand-completed forms from read-only disclosures', () => {
  const methods = new Map(MBANK_TEMPLATES.map(template => [template.id, template.fillMethod?.kind]))
  assert.equal(methods.get('mbank-information-request-2026'), 'pdf_manual')
  assert.equal(methods.get('mbank-applicant-data-2026'), 'pdf_manual')
  assert.equal(methods.get('mbank-general-mortgage-information-2026'), 'pdf_readonly')
  assert.equal(methods.get('mbank-risk-information-2026'), 'pdf_readonly')
  for (const template of MBANK_TEMPLATES) {
    assert.equal(template.bindings.length, 0)
  }
})
