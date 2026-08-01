import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OpenExpertAuthConfigurationError,
  readOpenExpertAuthEnv,
} from '../src/env.ts'

test('readOpenExpertAuthEnv returns secure project defaults', () => {
  const config = readOpenExpertAuthEnv({
    BETTER_AUTH_URL: 'https://auth.openexpert.app',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgresql://user:pass@example.com/openexpert',
    BETTER_AUTH_COOKIE_DOMAIN: '.openexpert.app',
  })

  assert.equal(config.databaseSchema, 'identity')
  assert.equal(config.requireEmailVerification, true)
  assert.equal(config.minPasswordLength, 10)
  assert.equal(config.cookieDomain, '.openexpert.app')
})

test('readOpenExpertAuthEnv rejects missing required values', () => {
  assert.throws(
    () => readOpenExpertAuthEnv({}),
    OpenExpertAuthConfigurationError,
  )
})

test('readOpenExpertAuthEnv enables social providers only with complete credentials', () => {
  const config = readOpenExpertAuthEnv({
    BETTER_AUTH_URL: 'https://auth.openexpert.app',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgresql://user:pass@example.com/openexpert',
    BETTER_AUTH_GOOGLE_CLIENT_ID: 'google-client',
    BETTER_AUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
  })

  assert.deepEqual(config.socialProviders, {
    google: {
      clientId: 'google-client',
      clientSecret: 'google-secret',
      disableSignUp: true,
    },
    apple: undefined,
  })

  assert.throws(
    () => readOpenExpertAuthEnv({
      BETTER_AUTH_URL: 'https://auth.openexpert.app',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      DATABASE_URL: 'postgresql://user:pass@example.com/openexpert',
      BETTER_AUTH_APPLE_CLIENT_ID: 'apple-client',
    }),
    OpenExpertAuthConfigurationError,
  )
})
