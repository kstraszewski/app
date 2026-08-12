import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDaysToIsoDate,
  BOOKING_WEEK_DAYS,
  bookingDateRange,
  isoDateForTimestamp,
  NEXT_AVAILABLE_SLOT_SEARCH_DAYS,
} from '../app/utils/booking-slots.ts'
import {
  bookingConsentDecisionsValue,
  catalogAllowedOrigins,
  dateValue,
  idempotencyKeyValue,
  isoDateTimeValue,
  publicWidgetKey,
  sanitizePublicCatalog,
} from '../server/utils/booking-public.ts'

const firstUuid = '11111111-1111-4111-8111-111111111111'
const secondUuid = '22222222-2222-4222-8222-222222222222'

function statusCode(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'statusCode' in error
    ? Number(error.statusCode)
    : undefined
}

test('public booking tokens and dates are strictly validated', () => {
  assert.equal(publicWidgetKey(' widget-key_123 '), 'widget-key_123')
  assert.equal(idempotencyKeyValue('request.key-123'), 'request.key-123')
  assert.equal(dateValue('2026-08-12'), '2026-08-12')
  assert.equal(
    isoDateTimeValue('2026-08-12T14:30:00+02:00', 'startsAt'),
    '2026-08-12T12:30:00.000Z',
  )
  assert.throws(
    () => publicWidgetKey('../booking'),
    error => statusCode(error) === 404,
  )
  assert.throws(
    () => dateValue('2026-02-30'),
    error => statusCode(error) === 400,
  )
  assert.throws(
    () => isoDateTimeValue('2026-08-12T14:30:00', 'startsAt'),
    error => statusCode(error) === 400,
  )
})

test('consent decisions accept both API naming styles and reject duplicates', () => {
  assert.deepEqual(
    bookingConsentDecisionsValue([
      { definitionId: firstUuid, version_id: secondUuid, granted: true },
    ]),
    [{ definition_id: firstUuid, version_id: secondUuid, granted: true }],
  )
  assert.throws(
    () => bookingConsentDecisionsValue([
      { definitionId: firstUuid, versionId: secondUuid, granted: true },
      { definition_id: firstUuid, version_id: firstUuid, granted: false },
    ]),
    error => statusCode(error) === 400,
  )
})

test('catalog origins are normalized and invalid values are ignored', () => {
  assert.deepEqual(
    catalogAllowedOrigins({
      _private: {
        allowed_origins: [
          'https://partner.example/path',
          'http://localhost:3000/widget',
          'javascript:alert(1)',
          123,
        ],
      },
    }),
    ['https://partner.example', 'http://localhost:3000'],
  )
})

test('public catalog exposes only the booking contract', () => {
  const catalog = sanitizePublicCatalog({
    widget: {
      title: 'Konsultacja',
      theme: 'light',
      booking_mode: 'expert',
      widget_type: 'calendar',
      allowed_origins: ['https://private.example'],
    },
    facility: {
      id: firstUuid,
      name: 'OpenExpert Warszawa',
      address_line1: 'Prosta 1',
      postal_code: '00-001',
      city: 'Warszawa',
      timezone: 'Europe/Warsaw',
    },
    services: [{ id: secondUuid, name: 'Spotkanie', duration_minutes: 60 }],
    experts: [{ user_id: firstUuid, full_name: 'Anna Nowak', service_ids: [secondUuid] }],
    consents: [],
    internal: { secret: true },
  }, 'widget-key_123')

  assert.equal(catalog.widget.key, 'widget-key_123')
  assert.equal(catalog.facility.address, 'Prosta 1, 00-001 Warszawa')
  assert.equal(catalog.services[0]?.durationMinutes, 60)
  assert.deepEqual(catalog.experts[0]?.serviceIds, [secondUuid])
  assert.equal(catalog.capacityPolicyRevision, null)
  assert.equal('allowed_origins' in catalog.widget, false)
  assert.equal('internal' in catalog, false)
})

test('slot date helpers preserve CRM range and facility timezone behavior', () => {
  assert.equal(BOOKING_WEEK_DAYS, 7)
  assert.equal(NEXT_AVAILABLE_SLOT_SEARCH_DAYS, 31)
  assert.equal(addDaysToIsoDate('2026-07-25', 31), '2026-08-25')
  assert.deepEqual(
    bookingDateRange('2026-07-29', BOOKING_WEEK_DAYS),
    { date: '2026-07-29', endDate: '2026-08-04' },
  )
  assert.equal(
    isoDateForTimestamp('2026-07-31T22:30:00.000Z', 'Europe/Warsaw'),
    '2026-08-01',
  )
})
