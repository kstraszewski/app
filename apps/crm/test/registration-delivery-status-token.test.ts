import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRegistrationDeliveryStatusToken,
  verifyRegistrationDeliveryStatusToken,
} from '../server/lib/registration-delivery-status-token.ts'

const secret = 'registration-status-test-secret-with-enough-entropy'
const payload = {
  invitationId: '965cc0a2-43b5-4e98-9757-06d79f8793d2',
  expiresAt: '2026-08-22T12:00:00.000Z',
}

test('registration delivery receipt is signed, scoped and expires', () => {
  const token = createRegistrationDeliveryStatusToken(payload, secret)
  assert.deepEqual(
    verifyRegistrationDeliveryStatusToken(token, secret, Date.parse('2026-08-21T12:00:00Z')),
    payload,
  )
  assert.equal(
    verifyRegistrationDeliveryStatusToken(token, secret, Date.parse(payload.expiresAt)),
    null,
  )
  assert.equal(
    verifyRegistrationDeliveryStatusToken(token, `${secret}-wrong`, Date.parse('2026-08-21T12:00:00Z')),
    null,
  )
})

test('registration delivery receipt rejects tampering and malformed payloads', () => {
  const token = createRegistrationDeliveryStatusToken(payload, secret)
  const [body, signature] = token.split('.')
  assert.equal(
    verifyRegistrationDeliveryStatusToken(`${body}x.${signature}`, secret, Date.parse('2026-08-21T12:00:00Z')),
    null,
  )
  assert.equal(verifyRegistrationDeliveryStatusToken('invalid', secret), null)
  assert.equal(verifyRegistrationDeliveryStatusToken('', secret), null)
})
