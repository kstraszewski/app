import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authSmsBody,
  resolveAuthSmsConfig,
} from '../server/utils/auth-sms.ts'

test('resolves a local development phone-auth configuration', () => {
  const config = resolveAuthSmsConfig({
    enabled: true,
    provider: 'local',
    ttlSeconds: 420,
    maxOtpAttempts: 4,
  })

  assert.equal(config.enabled, true)
  assert.equal(config.provider, 'local')
  assert.equal(config.demoAutoFill, true)
  assert.equal(config.ttlSeconds, 420)
  assert.equal(config.maxOtpAttempts, 4)
})

test('rejects an insecure production SMS provider', () => {
  assert.throws(() => resolveAuthSmsConfig({
    enabled: true,
    provider: 'local',
  }, { production: true }))

  assert.throws(() => resolveAuthSmsConfig({
    enabled: true,
    provider: 'http',
    gatewayUrl: 'http://sms.example.com/send',
    gatewayToken: 'secret',
  }, { production: true }))
})

test('builds purpose-specific OTP messages without unrelated data', () => {
  assert.equal(
    authSmsBody('phone-verification', '012345', 300),
    'OpenExpert: kod logowania lub potwierdzenia numeru: 012345. Ważny 5 min. Nie podawaj go nikomu.',
  )
  assert.match(
    authSmsBody('phone-password-reset', '987654', 300),
    /ustawienia nowego hasła: 987654/u,
  )
})
