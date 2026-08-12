import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bookingWidgetEmbedUrl,
  bookingWidgetPublicUrl,
  bookingWidgetScriptUrl,
  legacyBookingRedirectUrl,
} from '../shared/utils/booking-widget-urls.ts'

describe('booking widget client portal URLs', () => {
  const clientBaseUrl = 'https://client.openexpert.app/ignored/path/'

  it('builds public, embed and script URLs on the client portal origin', () => {
    assert.equal(
      bookingWidgetPublicUrl(clientBaseUrl, 'widget/key'),
      'https://client.openexpert.app/book/widget%2Fkey',
    )
    assert.equal(
      bookingWidgetEmbedUrl(clientBaseUrl, 'widget/key'),
      'https://client.openexpert.app/book/widget%2Fkey?embed=1',
    )
    assert.equal(
      bookingWidgetScriptUrl(clientBaseUrl),
      'https://client.openexpert.app/booking-widget.js',
    )
  })

  it('preserves the complete legacy query while changing only host and booking path', () => {
    assert.equal(
      legacyBookingRedirectUrl(
        clientBaseUrl,
        'widget/key',
        'https://crm.openexpert.app/book/widget%2Fkey?embed=1&expertId=a%2Fb&serviceId=first&serviceId=second&previewToken=x%2By',
      ),
      'https://client.openexpert.app/book/widget%2Fkey?embed=1&expertId=a%2Fb&serviceId=first&serviceId=second&previewToken=x%2By',
    )
  })

  it('rejects non-HTTP portal origins', () => {
    assert.throws(
      () => bookingWidgetPublicUrl('javascript:alert(1)', 'widget'),
      /must use HTTP or HTTPS/u,
    )
  })
})
