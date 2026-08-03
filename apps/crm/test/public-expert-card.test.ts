import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publicDirectoryCardCandidate,
  publicDirectoryExpertCardEligible,
  selectPublicDirectoryCard,
} from '../server/utils/public-expert-card.ts'

const expertId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const facilityId = '33333333-3333-4333-8333-333333333333'
const serviceId = '44444444-4444-4444-8444-444444444444'

function catalog(
  widgetKey: string,
  options: {
    bookingMode?: 'facility' | 'expert' | 'both'
    fixedExpertId?: string | null
    expertName?: string
  } = {},
) {
  return {
    widget: {
      key: widgetKey,
      widgetType: 'calendar',
      bookingMode: options.bookingMode ?? 'both',
      fixedExpertUserId: options.fixedExpertId ?? null,
    },
    facility: {
      id: facilityId,
      name: 'Centrum Warszawa',
      address: 'ul. Prosta 1, Warszawa',
    },
    services: [{
      id: serviceId,
      name: 'Konsultacja hipoteczna',
      durationMinutes: 60,
    }],
    experts: [{
      userId: expertId,
      name: options.expertName ?? 'Anna Nowak',
      avatarUrl: '/avatars/experts/anna-nowak.webp',
      serviceIds: [serviceId],
    }],
  }
}

test('parses the same public fields used by an expert directory card', () => {
  const widgetKey = '55555555-5555-4555-8555-555555555555'
  const candidate = publicDirectoryCardCandidate(
    catalog(widgetKey),
    { organizationId, widgetKey },
    expertId,
  )

  assert.deepEqual(candidate, {
    organizationId,
    widgetKey,
    bookingMode: 'both',
    fixedExpertId: null,
    name: 'Anna Nowak',
    avatarUrl: '/avatars/experts/anna-nowak.webp',
    facility: {
      id: facilityId,
      name: 'Centrum Warszawa',
      address: 'ul. Prosta 1, Warszawa',
    },
    services: [{
      id: serviceId,
      name: 'Konsultacja hipoteczna',
      durationMinutes: 60,
    }],
  })
})

test('keeps a facility-only appearance but does not create a standalone expert card', () => {
  const widgetKey = '66666666-6666-4666-8666-666666666666'
  const candidate = publicDirectoryCardCandidate(
    catalog(widgetKey, { bookingMode: 'facility' }),
    { organizationId, widgetKey },
    expertId,
  )

  assert.ok(candidate)
  assert.equal(publicDirectoryExpertCardEligible(candidate, expertId), false)
  assert.equal(selectPublicDirectoryCard([candidate], expertId), null)
})

test('prefers a fixed-expert widget over generic expert and both modes', () => {
  const bothKey = '77777777-7777-4777-8777-777777777777'
  const expertKey = '88888888-8888-4888-8888-888888888888'
  const fixedKey = '99999999-9999-4999-8999-999999999999'
  const candidates = [
    publicDirectoryCardCandidate(
      catalog(bothKey, { bookingMode: 'both' }),
      { organizationId, widgetKey: bothKey },
      expertId,
    ),
    publicDirectoryCardCandidate(
      catalog(expertKey, { bookingMode: 'expert' }),
      { organizationId, widgetKey: expertKey },
      expertId,
    ),
    publicDirectoryCardCandidate(
      catalog(fixedKey, { bookingMode: 'both', fixedExpertId: expertId }),
      { organizationId, widgetKey: fixedKey },
      expertId,
    ),
  ].filter(candidate => candidate !== null)

  assert.equal(selectPublicDirectoryCard(candidates, expertId)?.widgetKey, fixedKey)
})

test('rejects catalogs where the expert has no bookable public service', () => {
  const widgetKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const raw = catalog(widgetKey)
  raw.experts[0]!.serviceIds = []

  assert.equal(publicDirectoryCardCandidate(
    raw,
    { organizationId, widgetKey },
    expertId,
  ), null)
})
