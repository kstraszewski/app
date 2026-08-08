import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertMultiformEmailArchiveSize,
  MAX_MULTIFORM_EMAIL_ARCHIVE_BYTES,
  multiformPackageEmailTemplate,
  normalizeMultiformDeliveryRequestId,
  normalizeMultiformPeselPassword,
} from '../server/utils/multiform-package-email.ts'

test('normalizes an 11-digit PESEL password without exposing partial values', () => {
  assert.equal(normalizeMultiformPeselPassword('850 101 123 45'), '85010112345')
  assert.equal(normalizeMultiformPeselPassword('8501011234'), '')
  assert.equal(normalizeMultiformPeselPassword('8501011234A'), '')
})

test('builds accessible HTML and plain text without embedding the PESEL value', () => {
  const pesel = '85010112345'
  const template = multiformPackageEmailTemplate({ recipientName: 'Jan <Kowalski>' })

  assert.equal(template.subject, 'Dokumenty do wniosków bankowych')
  assert.match(template.html, /<html lang="pl">/u)
  assert.match(template.html, /Jan &lt;Kowalski&gt;/u)
  assert.match(template.text, /Hasłem jest Twój numer PESEL/u)
  assert.ok(!template.html.includes(pesel))
  assert.ok(!template.text.includes(pesel))
})

test('accepts only UUID delivery request identifiers', () => {
  assert.equal(
    normalizeMultiformDeliveryRequestId('9427198C-BF6C-4B2D-8530-68A5117C5679'),
    '9427198c-bf6c-4b2d-8530-68a5117c5679',
  )
  assert.equal(normalizeMultiformDeliveryRequestId('request-1'), '')
})

test('enforces the Resend attachment size boundary', () => {
  assert.doesNotThrow(() => assertMultiformEmailArchiveSize(new Uint8Array([1])))
  assert.throws(() => assertMultiformEmailArchiveSize(new Uint8Array()), /pusta/u)
  assert.throws(
    () => assertMultiformEmailArchiveSize(new Uint8Array(MAX_MULTIFORM_EMAIL_ARCHIVE_BYTES + 1)),
    /40 MB/u,
  )
})
