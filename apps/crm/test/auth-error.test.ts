import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  authErrorCode,
  authErrorText,
  isFreshSessionRequired,
} from '../app/utils/auth-error.ts'

describe('auth errors', () => {
  it('reads Better Auth errors from top-level fields', () => {
    const error = { code: 'session_not_fresh', message: 'Session is not fresh' }

    assert.equal(authErrorCode(error), 'SESSION_NOT_FRESH')
    assert.equal(authErrorText(error), 'Session is not fresh')
    assert.equal(isFreshSessionRequired(error), true)
  })

  it('reads wrapped API errors from data fields', () => {
    const error = {
      data: {
        code: 'FRESH_AUTHENTICATION_REQUIRED',
        message: 'Please sign in again',
      },
    }

    assert.equal(authErrorCode(error), 'FRESH_AUTHENTICATION_REQUIRED')
    assert.equal(authErrorText(error), 'Please sign in again')
    assert.equal(isFreshSessionRequired(error), true)
  })

  it('recognizes the upstream message when a response omits the code', () => {
    assert.equal(isFreshSessionRequired({ message: 'Session is not fresh' }), true)
  })

  it('does not classify unrelated authentication errors as stale sessions', () => {
    assert.equal(isFreshSessionRequired({ code: 'INVALID_PASSWORD' }), false)
    assert.equal(isFreshSessionRequired(null), false)
  })
})
