import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertOpenExpertPassword,
  getOpenExpertPasswordIssue,
  getOpenExpertPasswordRequirements,
  OpenExpertPasswordPolicyError,
} from '../src/password-policy.ts'

test('accepts a strong password including Unicode letters', () => {
  assert.equal(getOpenExpertPasswordIssue('ŻółwBezpieczny7'), null)
  assert.deepEqual(getOpenExpertPasswordRequirements('ŻółwBezpieczny7'), {
    minimumLength: true,
    acceptableLength: true,
    lowercase: true,
    uppercase: true,
    number: true,
  })
})

test('rejects missing character classes', () => {
  assert.match(getOpenExpertPasswordIssue('same-malelitery7') ?? '', /wielką literę/u)
  assert.match(getOpenExpertPasswordIssue('SAME-WIELKIE7') ?? '', /małą literę/u)
  assert.match(getOpenExpertPasswordIssue('BrakCyfryTutaj') ?? '', /cyfrę/u)
})

test('rejects passwords that bcrypt would truncate by UTF-8 byte length', () => {
  const password = `${'Aą1'.repeat(24)}z`
  assert.ok(password.length <= 128)
  assert.ok(new TextEncoder().encode(password).byteLength > 72)
  assert.throws(
    () => assertOpenExpertPassword(password),
    OpenExpertPasswordPolicyError,
  )
})

test('enforces the exact minimum-character and bcrypt byte boundaries', () => {
  assert.notEqual(getOpenExpertPasswordIssue(`Aa1${'x'.repeat(6)}`), null)
  assert.equal(getOpenExpertPasswordIssue(`Aa1${'x'.repeat(7)}`), null)

  const exactly72Bytes = `Aa1${'x'.repeat(69)}`
  const exactly73Bytes = `${exactly72Bytes}x`
  assert.equal(new TextEncoder().encode(exactly72Bytes).byteLength, 72)
  assert.equal(new TextEncoder().encode(exactly73Bytes).byteLength, 73)
  assert.equal(getOpenExpertPasswordIssue(exactly72Bytes), null)
  assert.notEqual(getOpenExpertPasswordIssue(exactly73Bytes), null)
})
