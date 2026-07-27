import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  directoryCatalogSnapshot,
  type DirectoryCatalogSnapshot,
} from '../server/utils/directory-catalog.ts'
import {
  buildDirectoryFacilityDetail,
  directoryRouteSlug,
  selectDirectoryFacilityCatalog,
} from '../server/utils/directory-facility-detail.ts'
import {
  directoryCoordinates,
  formatDirectoryAddress,
} from '../server/utils/directory-facilities.ts'

const FACILITY_ID = '11111111-1111-4111-8111-111111111111'
const SERVICE_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_SERVICE_ID = '33333333-3333-4333-8333-333333333333'
const EXPERT_ID = '44444444-4444-4444-8444-444444444444'
const WIDGET_ID = '55555555-5555-4555-8555-555555555555'

function catalog(
  input: Partial<DirectoryCatalogSnapshot> = {},
): DirectoryCatalogSnapshot {
  return {
    widgetKey: WIDGET_ID,
    bookingMode: 'both',
    fixedExpertId: null,
    facilityKey: FACILITY_ID,
    facility: {
      name: 'OpenExpert Szczecin Centrum',
      address: 'al. Wojska Polskiego 42, 70-475 Szczecin, PL',
      timezone: 'Europe/Warsaw',
    },
    services: [{
      key: SERVICE_ID,
      value: { name: 'Konsultacja', durationMinutes: 60 },
    }],
    experts: [{
      expertId: EXPERT_ID,
      name: 'Anna Nowak',
      serviceKeys: [SERVICE_ID],
    }],
    ...input,
  }
}

describe('public directory route values', () => {
  it('accepts stable slugs and rejects malformed or oversized paths', () => {
    assert.equal(directoryRouteSlug('openexpert-local'), 'openexpert-local')
    assert.equal(directoryRouteSlug(' Szczecin-Centrum '), null)
    assert.equal(directoryRouteSlug('../szczecin'), null)
    assert.equal(directoryRouteSlug('a'.repeat(101)), null)
  })

  it('publishes coordinates only as a valid WGS84 pair', () => {
    assert.deepEqual(directoryCoordinates(53.4305362, 14.5418219), {
      latitude: 53.4305362,
      longitude: 14.5418219,
    })
    assert.equal(directoryCoordinates(53.43, null), null)
    assert.equal(directoryCoordinates(91, 14.54), null)
    assert.equal(directoryCoordinates(Number.NaN, 14.54), null)
  })

  it('formats an address without empty separators', () => {
    assert.equal(formatDirectoryAddress({
      addressLine1: ' al. Wojska Polskiego 42 ',
      addressLine2: null,
      postalCode: '70-475',
      city: 'Szczecin',
      countryCode: 'PL',
    }), 'al. Wojska Polskiego 42, 70-475 Szczecin, PL')
  })
})

describe('directory catalog exposure gate', () => {
  it('accepts only a valid calendar catalog with a bookable service-expert pair', () => {
    const snapshot = directoryCatalogSnapshot({
      widget: {
        key: WIDGET_ID,
        widgetType: 'calendar',
        bookingMode: 'both',
      },
      facility: {
        id: FACILITY_ID,
        name: 'OpenExpert Szczecin Centrum',
        timezone: 'Europe/Warsaw',
      },
      services: [{
        id: SERVICE_ID,
        name: 'Konsultacja',
        durationMinutes: 60,
      }],
      experts: [{
        userId: EXPERT_ID,
        name: 'Anna Nowak',
        serviceIds: [SERVICE_ID, OTHER_SERVICE_ID],
      }],
    }, WIDGET_ID)

    assert.deepEqual(snapshot?.experts[0]?.serviceKeys, [SERVICE_ID])
    assert.equal(snapshot?.services.length, 1)
    assert.equal(directoryCatalogSnapshot({
      widget: { key: WIDGET_ID, widgetType: 'mortgage_capacity' },
      facility: { id: FACILITY_ID, name: 'Placówka' },
    }, WIDGET_ID), null)
  })

  it('uses the same deterministic facility-widget preference as the list API', () => {
    const expertWidget = catalog({
      bookingMode: 'expert',
      widgetKey: '66666666-6666-4666-8666-666666666666',
    })
    const facilityWidget = catalog({
      bookingMode: 'facility',
      widgetKey: '77777777-7777-4777-8777-777777777777',
    })

    assert.equal(
      selectDirectoryFacilityCatalog(
        [expertWidget, facilityWidget],
        FACILITY_ID,
      )?.widgetKey,
      facilityWidget.widgetKey,
    )
  })
})

describe('directory facility detail payload', () => {
  it('whitelists catalog services and maps public contact, hours and experts', () => {
    const detail = buildDirectoryFacilityDetail({
      organizationSlug: 'openexpert-local',
      facility: {
        id: FACILITY_ID,
        organization_id: '88888888-8888-4888-8888-888888888888',
        name: ' OpenExpert Szczecin Centrum ',
        slug: 'szczecin-centrum',
        description: ' Placówka demonstracyjna. ',
        timezone: 'Europe/Warsaw',
        address_line1: 'al. Wojska Polskiego 42',
        address_line2: null,
        postal_code: '70-475',
        city: 'Szczecin',
        country_code: 'PL',
        latitude: 53.4305362,
        longitude: 14.5418219,
        phone: ' +48 91 881 24 60 ',
        email: 'szczecin@openexpert.local',
      },
      catalog: catalog(),
      openingHours: [
        { weekday: 1, opens_at: '08:00:00', closes_at: '18:00:00' },
        { weekday: 0, opens_at: '08:00:00', closes_at: '18:00:00' },
      ],
      services: [
        {
          id: OTHER_SERVICE_ID,
          slug: 'nieopublikowana',
          name: 'Nieopublikowana',
          description: null,
          duration_minutes: 30,
        },
        {
          id: SERVICE_ID,
          slug: 'konsultacja',
          name: 'Konsultacja',
          description: 'Omówienie potrzeb.',
          duration_minutes: 60,
        },
      ],
      gallery: [{
        thumbnailUrl: 'https://storage.example/thumbnail',
        fallbackUrl: 'https://storage.example/original',
        alt: 'Recepcja',
      }],
    })

    assert.equal(detail.organizationSlug, 'openexpert-local')
    assert.equal(detail.facilitySlug, 'szczecin-centrum')
    assert.equal(detail.services.length, 1)
    assert.equal(detail.services[0]?.serviceId, SERVICE_ID)
    assert.deepEqual(detail.experts, [{
      expertId: EXPERT_ID,
      name: 'Anna Nowak',
      serviceIds: [SERVICE_ID],
    }])
    assert.deepEqual(detail.openingHours.map(hour => hour.weekday), [0, 1])
    assert.equal(detail.contact.phone, '+48 91 881 24 60')
    assert.equal(detail.address, 'al. Wojska Polskiego 42, 70-475 Szczecin, PL')
    assert.equal('storage_path' in detail.gallery[0]!, false)
  })
})
