import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BOOKING_MAGIC_LINK_RESPONSE_FLOOR_MS,
  bookingMagicLinkResponseDelay,
  buildBookingMagicLinkCallbackPath,
  normalizeBookingMagicLinkDate,
  normalizeBookingMagicLinkEmail,
  normalizeBookingMagicLinkUuid,
  parseBookingMagicLinkIntent,
} from '../server/utils/booking-magic-link.ts'

const widgetKey = '11111111-1111-4111-8111-111111111111'
const expertId = '22222222-2222-4222-8222-222222222222'
const serviceId = '33333333-3333-4333-8333-333333333333'
const bookingDate = '2026-08-17'

const catalog = {
  widget: { key: widgetKey },
  experts: [{ userId: expertId }],
  services: [{ id: serviceId }],
}

describe('booking magic-link input', () => {
  it('normalizes an email and UUID identifiers', () => {
    assert.equal(
      normalizeBookingMagicLinkEmail(' Client@Example.COM '),
      'client@example.com',
    )
    assert.equal(
      normalizeBookingMagicLinkUuid(widgetKey.toUpperCase()),
      widgetKey,
    )
    assert.equal(normalizeBookingMagicLinkDate(bookingDate), bookingDate)
    assert.equal(normalizeBookingMagicLinkDate('2026-02-30'), null)
  })

  it('rejects an invalid required identity without preserving arbitrary callbacks', () => {
    assert.equal(parseBookingMagicLinkIntent({
      email: 'not-an-email',
      widgetKey,
      callbackURL: 'https://attacker.example/steal',
    }), null)

    assert.deepEqual(parseBookingMagicLinkIntent({
      email: 'client@example.com',
      widgetKey,
      callbackURL: 'https://attacker.example/steal',
      expertId: '../../admin',
      serviceId,
      date: 'not-a-date',
    }), {
      email: 'client@example.com',
      widgetKey,
      expertId: null,
      serviceId,
      date: null,
    })
  })
})

describe('booking magic-link callback', () => {
  it('builds only a local booking path with catalog-backed selections', () => {
    const intent = parseBookingMagicLinkIntent({
      email: 'client@example.com',
      widgetKey,
      expertId,
      serviceId,
      date: bookingDate,
    })
    assert.ok(intent)
    assert.equal(
      buildBookingMagicLinkCallbackPath(intent, catalog),
      `/book/${widgetKey}?expertId=${expertId}&serviceId=${serviceId}&date=${bookingDate}`,
    )
  })

  it('drops unknown selections and rejects a catalog for another widget', () => {
    const intent = parseBookingMagicLinkIntent({
      email: 'client@example.com',
      widgetKey,
      expertId: '44444444-4444-4444-8444-444444444444',
      serviceId: '55555555-5555-4555-8555-555555555555',
      date: bookingDate,
    })
    assert.ok(intent)
    assert.equal(
      buildBookingMagicLinkCallbackPath(intent, catalog),
      `/book/${widgetKey}?date=${bookingDate}`,
    )
    assert.equal(buildBookingMagicLinkCallbackPath(intent, {
      ...catalog,
      widget: { key: '66666666-6666-4666-8666-666666666666' },
    }), null)
  })
})

describe('booking magic-link response timing', () => {
  it('keeps a response floor without adding delay after it elapses', () => {
    assert.equal(
      bookingMagicLinkResponseDelay(1_000, 1_250),
      BOOKING_MAGIC_LINK_RESPONSE_FLOOR_MS - 250,
    )
    assert.equal(bookingMagicLinkResponseDelay(1_000, 2_000), 0)
    assert.equal(
      bookingMagicLinkResponseDelay(1_000, 900),
      BOOKING_MAGIC_LINK_RESPONSE_FLOOR_MS,
    )
  })
})
