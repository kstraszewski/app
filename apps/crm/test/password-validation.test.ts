import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getPasswordIssue,
  getPasswordRequirements,
} from '../app/utils/password-validation.ts'

test('reports password requirements independently for real-time feedback', () => {
  assert.deepEqual(getPasswordRequirements(''), {
    minimumLength: false,
    acceptableLength: true,
    lowercase: false,
    uppercase: false,
    number: false,
  })

  assert.deepEqual(getPasswordRequirements('Bezpieczne1'), {
    minimumLength: true,
    acceptableLength: true,
    lowercase: true,
    uppercase: true,
    number: true,
  })
})

test('keeps validation messages understandable without exposing byte limits', () => {
  const longAsciiPassword = `Aa1${'x'.repeat(70)}`
  const longUnicodePassword = `Aa1${'ą'.repeat(35)}`

  assert.equal(getPasswordIssue(longAsciiPassword), 'Hasło jest za długie. Skróć je, szczególnie jeśli zawiera polskie znaki lub symbole.')
  assert.equal(getPasswordIssue(longUnicodePassword), 'Hasło jest za długie. Skróć je, szczególnie jeśli zawiera polskie znaki lub symbole.')
  assert.equal(getPasswordIssue(longAsciiPassword)?.includes('bajt'), false)
})

test('validates every visible password rule', () => {
  assert.equal(getPasswordIssue('KROTKIE123'), 'Dodaj do hasła małą literę.')
  assert.equal(getPasswordIssue('krotkie123'), 'Dodaj do hasła wielką literę.')
  assert.equal(getPasswordIssue('KrotkieHaslo'), 'Dodaj do hasła cyfrę.')
  assert.equal(getPasswordIssue('Bezpieczne1'), null)
})
