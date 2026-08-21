import assert from 'node:assert/strict'
import test from 'node:test'

import {
  APPLICATION_SEAT_PRICE_PLN,
  buildApplicationRegistrationUrl,
  buildLoginUrl,
  normalizeApplicationSeatCount,
} from '../app/utils/landing-registration.ts'

test('normalizes paid seat counts to the supported 1-100 range', () => {
  assert.equal(normalizeApplicationSeatCount(0), 1)
  assert.equal(normalizeApplicationSeatCount('12'), 12)
  assert.equal(normalizeApplicationSeatCount(12.9), 12)
  assert.equal(normalizeApplicationSeatCount(101), 100)
  assert.equal(normalizeApplicationSeatCount('not-a-number'), 1)
})

test('builds an application registration URL with only the pricing intent', () => {
  const url = new URL(buildApplicationRegistrationUrl('https://crm.openexpert.app', 5))

  assert.equal(url.origin, 'https://crm.openexpert.app')
  assert.equal(url.pathname, '/register')
  assert.deepEqual([...url.searchParams.entries()], [
    ['kind', 'application'],
    ['plan', 'application_monthly'],
    ['seats', '5'],
    ['source', 'landing_pricing'],
  ])
  assert.equal(Number(url.searchParams.get('seats')) * APPLICATION_SEAT_PRICE_PLN, 1000)
})

test('builds the login URL from the configured CRM origin', () => {
  assert.equal(
    buildLoginUrl('https://crm.openexpert.app/some-path'),
    'https://crm.openexpert.app/login',
  )
})
