import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  directoryBookingDateUrl,
  directoryBookingUrl,
  directoryHydrationData,
} from '../app/utils/directory.ts'

describe('directoryHydrationData', () => {
  const payload = {
    directory: {
      generatedAt: '2026-07-28T15:00:00.000Z',
      facilities: [],
    },
  }

  it('reuses the matching SSR payload during hydration', () => {
    assert.equal(
      directoryHydrationData(true, payload, 'directory'),
      payload.directory,
    )
  })

  it('ignores cached signed image URLs on a later client navigation', () => {
    assert.equal(
      directoryHydrationData(false, payload, 'directory'),
      undefined,
    )
  })
})

describe('directoryBookingUrl', () => {
  it('preselects the expert and service behind the advertised availability', () => {
    assert.equal(
      directoryBookingUrl(
        'https://client.openexpert.app/path',
        'widget/key',
        'expert-id',
        'service-id',
      ),
      'https://client.openexpert.app/book/widget%2Fkey?expertId=expert-id&serviceId=service-id',
    )
  })

  it('links an advertised day to its own service and date', () => {
    assert.equal(
      directoryBookingDateUrl(
        'https://client.openexpert.app/book/widget?expertId=expert-id&serviceId=old-service',
        'date-service',
        '2026-08-17',
      ),
      'https://client.openexpert.app/book/widget?expertId=expert-id&serviceId=date-service&date=2026-08-17',
    )
  })
})
