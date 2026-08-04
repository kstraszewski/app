import assert from 'node:assert/strict'
import test from 'node:test'

import { APIError } from 'better-auth/api'

import {
  getOpenExpertNewPasswordField,
  requireOpenExpertPasskeyAuthenticationOptions,
  requireOpenExpertPasskeyUserVerification,
} from '../src/security.ts'

test('targets only operations that create or replace a password', () => {
  assert.equal(getOpenExpertNewPasswordField({ path: '/sign-up/email' }), 'password')
  assert.equal(getOpenExpertNewPasswordField({ path: '/reset-password' }), 'newPassword')
  assert.equal(getOpenExpertNewPasswordField({ path: '/change-password' }), 'newPassword')
  assert.equal(
    getOpenExpertNewPasswordField({ path: '/phone-number/reset-password' }),
    'newPassword',
  )
  assert.equal(getOpenExpertNewPasswordField({ operationId: 'setPassword' }), 'newPassword')
  assert.equal(getOpenExpertNewPasswordField({ path: '/sign-in/email' }), null)
  assert.equal(getOpenExpertNewPasswordField({ path: '/verify-password' }), null)
})

test('requires verified passkey user presence', () => {
  assert.doesNotThrow(() => requireOpenExpertPasskeyUserVerification(true))
  assert.throws(
    () => requireOpenExpertPasskeyUserVerification(false),
    (error: unknown) => error instanceof APIError
      && error.statusCode === 401
      && error.body?.code === 'PASSKEY_USER_VERIFICATION_REQUIRED',
  )
})

test('forces required user verification in passkey authentication options', () => {
  assert.deepEqual(
    requireOpenExpertPasskeyAuthenticationOptions({
      challenge: 'challenge',
      userVerification: 'preferred',
    }),
    {
      challenge: 'challenge',
      userVerification: 'required',
    },
  )
  assert.equal(requireOpenExpertPasskeyAuthenticationOptions(null), null)
})
