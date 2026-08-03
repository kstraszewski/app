import assert from 'node:assert/strict'
import test from 'node:test'

import {
  maskOpenExpertPhone,
  normalizeOpenExpertPhone,
} from '../src/phone.ts'

test('normalizes Polish and international phone numbers to E.164', () => {
  assert.equal(normalizeOpenExpertPhone('501 234 567'), '+48501234567')
  assert.equal(normalizeOpenExpertPhone('48 501-234-567'), '+48501234567')
  assert.equal(normalizeOpenExpertPhone('0048 501 234 567'), '+48501234567')
  assert.equal(normalizeOpenExpertPhone('+49 (151) 23456789'), '+4915123456789')
})

test('rejects ambiguous or invalid phone numbers', () => {
  assert.equal(normalizeOpenExpertPhone('123'), null)
  assert.equal(normalizeOpenExpertPhone('+0123456789'), null)
  assert.equal(normalizeOpenExpertPhone('call-me'), null)
  assert.equal(normalizeOpenExpertPhone('+48 501 234 567 890 123'), null)
})

test('masks all but the country prefix and last digits', () => {
  assert.equal(maskOpenExpertPhone('+48501234567'), '+48 ••• ••• 567')
  assert.equal(maskOpenExpertPhone('invalid'), '••• ••• •••')
})
