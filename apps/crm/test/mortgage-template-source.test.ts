import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  ERSTE_TEMPLATE,
  PEKAO_TEMPLATE,
  PKO_TEMPLATE,
} from '@openexpert/multiform'

import {
  maxMortgageTemplatePdfBytes,
  normalizeMortgageTemplatePdfAsset,
  validateMortgageTemplatePdf,
} from '../server/utils/mortgage-template-source.ts'

const workspaceRoot = new URL('../../../', import.meta.url)
const templates = [ERSTE_TEMPLATE, PEKAO_TEMPLATE, PKO_TEMPLATE]

for (const template of templates) {
  test(`accepts the registered ${template.id} PDF asset`, async () => {
    const bytes = new Uint8Array(await readFile(
      new URL(`mock-files/${template.source.fileName}`, workspaceRoot),
    ))

    assert.deepEqual(
      validateMortgageTemplatePdf(bytes, template.source.sha256),
      { valid: true, sha256: template.source.sha256 },
    )
  })
}

test('rejects a modified registered PDF', async () => {
  const bytes = new Uint8Array(await readFile(
    new URL(`mock-files/${ERSTE_TEMPLATE.source.fileName}`, workspaceRoot),
  ))
  bytes[bytes.length - 1] ^= 0x01

  const result = validateMortgageTemplatePdf(bytes, ERSTE_TEMPLATE.source.sha256)
  assert.equal(result.valid, false)
  if (result.valid) assert.fail('Expected checksum mismatch.')
  assert.equal(result.reason, 'checksum_mismatch')
})

test('rejects an invalid PDF header and an oversized asset', () => {
  assert.deepEqual(
    validateMortgageTemplatePdf(
      new TextEncoder().encode('<html>not a PDF</html>'),
      'a'.repeat(64),
    ),
    { valid: false, reason: 'invalid_pdf' },
  )
  assert.deepEqual(
    validateMortgageTemplatePdf(
      new Uint8Array(maxMortgageTemplatePdfBytes + 1),
      'a'.repeat(64),
    ),
    { valid: false, reason: 'too_large' },
  )
})

test('normalizes Nitro raw assets without changing their bytes', () => {
  const source = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D])
  assert.deepEqual(normalizeMortgageTemplatePdfAsset(source), source)
  assert.equal(normalizeMortgageTemplatePdfAsset(null), null)
  assert.equal(normalizeMortgageTemplatePdfAsset({}), null)
})
