import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasTrustedBankMailAuthentication,
  trustedIntakeSchema,
} from '../agent/lib/intake.ts'

const trustedIntake = {
  intakeId: '11111111-1111-4111-8111-111111111111',
  status: 'claimed',
  provider: 'gmail',
  bankId: '22222222-2222-4222-8222-222222222222',
  bankEmailIdentityId: '33333333-3333-4333-8333-333333333333',
  identityVerdict: 'trusted_bank',
  authenticationStatus: 'failed' as const,
  authenticationPolicy: 'openexpert_mock_dkim_aligned' as const,
  dkimAligned: true,
  dmarcAligned: false,
  replyToMismatch: false,
  sourceSha256: 'a'.repeat(64),
  reasonCodes: ['trusted_bank_identity'],
  claimedAt: '2026-08-21T12:00:00.000Z',
  finalizedAt: null,
  attachments: [],
}

test('accepts only the authoritative OpenExpert mock DKIM exception envelope', () => {
  const parsed = trustedIntakeSchema.parse(trustedIntake)

  assert.equal(hasTrustedBankMailAuthentication(parsed), true)
  assert.equal(hasTrustedBankMailAuthentication({
    ...parsed,
    identityVerdict: 'authentication_failed',
  }), false)
  assert.equal(hasTrustedBankMailAuthentication({
    ...parsed,
    dkimAligned: false,
  }), false)
  assert.equal(hasTrustedBankMailAuthentication({
    ...parsed,
    replyToMismatch: true,
  }), false)
})

test('does not let aligned DKIM bypass the regular DMARC policy', () => {
  const parsed = trustedIntakeSchema.parse({
    ...trustedIntake,
    authenticationPolicy: 'dmarc_aligned',
    authenticationStatus: 'failed',
    dkimAligned: true,
    dmarcAligned: false,
  })

  assert.equal(hasTrustedBankMailAuthentication(parsed), false)
  assert.equal(hasTrustedBankMailAuthentication({
    ...parsed,
    authenticationStatus: 'passed',
    dmarcAligned: true,
  }), true)
})

test('defaults a legacy DB 0084 payload to strict DMARC without enabling DKIM', () => {
  const {
    authenticationPolicy: _authenticationPolicy,
    dkimAligned: _dkimAligned,
    ...legacyIntake
  } = {
    ...trustedIntake,
    authenticationStatus: 'passed' as const,
    dmarcAligned: true,
  }
  const parsed = trustedIntakeSchema.parse(legacyIntake)

  assert.equal(parsed.authenticationPolicy, 'dmarc_aligned')
  assert.equal(parsed.dkimAligned, false)
  assert.equal(hasTrustedBankMailAuthentication(parsed), true)
})

test('rejects an unknown authentication policy at the RPC boundary', () => {
  assert.throws(
    () => trustedIntakeSchema.parse({
      ...trustedIntake,
      authenticationPolicy: 'dkim_aligned',
    }),
    /authenticationPolicy/u,
  )
})
