import assert from 'node:assert/strict'
import test from 'node:test'

import {
  APPLICATION_BILLING_PLANS,
  buildApplicationRegistrationUrl,
  buildLoginUrl,
  normalizeApplicationSeatCount,
} from '../app/utils/landing-registration.ts'

test('normalizes individual and team seats to their plan limits', () => {
  assert.equal(normalizeApplicationSeatCount(0), 1)
  assert.equal(normalizeApplicationSeatCount('12'), 1)
  assert.equal(normalizeApplicationSeatCount(1, 'team'), 3)
  assert.equal(normalizeApplicationSeatCount(12.9, 'team'), 12)
  assert.equal(normalizeApplicationSeatCount(101, 'team'), 100)
  assert.equal(normalizeApplicationSeatCount('not-a-number'), 1)
})

test('builds a team registration URL with only the pricing intent', () => {
  const url = new URL(buildApplicationRegistrationUrl('https://crm.openexpert.app', 'team', 5))

  assert.equal(url.origin, 'https://crm.openexpert.app')
  assert.equal(url.pathname, '/register')
  assert.deepEqual([...url.searchParams.entries()], [
    ['kind', 'application'],
    ['plan', 'team'],
    ['seats', '5'],
    ['source', 'landing_pricing'],
  ])
  assert.equal(
    Number(url.searchParams.get('seats')) * APPLICATION_BILLING_PLANS.team.seatPricePln,
    750,
  )
})

test('forces the individual registration intent to exactly one seat', () => {
  const url = new URL(buildApplicationRegistrationUrl('https://crm.openexpert.app', 'individual', 10))
  assert.equal(url.searchParams.get('plan'), 'individual')
  assert.equal(url.searchParams.get('seats'), '1')
})

test('builds the login URL from the configured CRM origin', () => {
  assert.equal(
    buildLoginUrl('https://crm.openexpert.app/some-path'),
    'https://crm.openexpert.app/login',
  )
})
