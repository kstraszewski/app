import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  portalExpertBookingCandidate,
  portalExpertBookingPath,
  selectPortalExpertBookingCandidate,
} from '../shared/utils/portal-expert-booking.ts'

const expertId = '11111111-1111-4111-8111-111111111111'
const otherExpertId = '22222222-2222-4222-8222-222222222222'
const facilityId = '33333333-3333-4333-8333-333333333333'
const serviceId = '44444444-4444-4444-8444-444444444444'

function catalog(
  widgetKey: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    widget: {
      key: widgetKey,
      widgetType: 'calendar',
      bookingMode: 'both',
      fixedExpertUserId: null,
      ...overrides,
    },
    facility: {
      id: facilityId,
      name: 'OpenExpert Centrum',
      address: 'ul. Jasna 1, Warszawa',
    },
    services: [{
      id: serviceId,
      name: 'Konsultacja hipoteczna',
      durationMinutes: 45,
    }],
    experts: [{
      userId: expertId,
      serviceIds: [serviceId],
    }],
  }
}

describe('portal expert booking catalog', () => {
  it('keeps only services actually assigned to the client expert', () => {
    const widgetKey = '55555555-5555-4555-8555-555555555555'
    const candidate = portalExpertBookingCandidate(
      catalog(widgetKey),
      { organizationId: 'organization-a', widgetKey },
      expertId,
    )

    assert.deepEqual(candidate?.services, [{
      id: serviceId,
      name: 'Konsultacja hipoteczna',
      durationMinutes: 45,
    }])
    assert.equal(candidate?.facility.name, 'OpenExpert Centrum')
  })

  it('does not claim a facility-only or another fixed expert widget', () => {
    const facilityWidgetKey = '66666666-6666-4666-8666-666666666666'
    assert.equal(portalExpertBookingCandidate(
      catalog(facilityWidgetKey, { bookingMode: 'facility' }),
      { organizationId: 'organization-a', widgetKey: facilityWidgetKey },
      expertId,
    ), null)

    const fixedWidgetKey = '77777777-7777-4777-8777-777777777777'
    assert.equal(portalExpertBookingCandidate(
      catalog(fixedWidgetKey, {
        bookingMode: 'expert',
        fixedExpertUserId: otherExpertId,
      }),
      { organizationId: 'organization-a', widgetKey: fixedWidgetKey },
      expertId,
    ), null)
  })

  it('prefers a widget fixed to the assigned expert', () => {
    const sharedWidgetKey = '88888888-8888-4888-8888-888888888888'
    const fixedWidgetKey = '99999999-9999-4999-8999-999999999999'
    const shared = portalExpertBookingCandidate(
      catalog(sharedWidgetKey, { bookingMode: 'expert' }),
      { organizationId: 'organization-a', widgetKey: sharedWidgetKey },
      expertId,
    )
    const fixed = portalExpertBookingCandidate(
      catalog(fixedWidgetKey, {
        bookingMode: 'expert',
        fixedExpertUserId: expertId,
      }),
      { organizationId: 'organization-a', widgetKey: fixedWidgetKey },
      expertId,
    )

    assert.equal(selectPortalExpertBookingCandidate(
      [shared, fixed].filter(candidate => candidate !== null),
      expertId,
    )?.widgetKey, fixedWidgetKey)
  })

  it('builds a same-origin route pinned to the assigned expert', () => {
    const widgetKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    assert.equal(
      portalExpertBookingPath(widgetKey, expertId),
      `/book/${widgetKey}?expertId=${expertId}`,
    )
    assert.equal(portalExpertBookingPath('not-a-widget', expertId), '')
  })
})
