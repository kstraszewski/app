import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  selectBookableCatalogEntries,
  selectDirectorySourceKeys,
  type DirectoryCatalogSelectionCandidate,
} from '../server/utils/directory-selection.ts'

function catalog(
  input: Partial<DirectoryCatalogSelectionCandidate>
  & Pick<DirectoryCatalogSelectionCandidate, 'widgetKey' | 'bookingMode'>,
): DirectoryCatalogSelectionCandidate {
  return {
    facilityKey: 'facility-a',
    fixedExpertId: null,
    expertIds: ['expert-a'],
    ...input,
  }
}

describe('selectDirectorySourceKeys', () => {
  it('does not create an imienne expert CTA from a facility-only widget', () => {
    const result = selectDirectorySourceKeys([
      catalog({ widgetKey: 'facility-widget', bookingMode: 'facility' }),
    ])

    assert.equal(result.facilityWidgetKeys.get('facility-a'), 'facility-widget')
    assert.equal(result.expertWidgetKeys.has('expert-a'), false)
  })

  it('chooses a widget that can honor the selected expert', () => {
    const result = selectDirectorySourceKeys([
      catalog({ widgetKey: 'facility-widget', bookingMode: 'facility' }),
      catalog({ widgetKey: 'both-widget', bookingMode: 'both' }),
      catalog({ widgetKey: 'expert-widget', bookingMode: 'expert' }),
    ])

    assert.equal(result.expertWidgetKeys.get('expert-a'), 'expert-widget')
  })

  it('prefers the exact fixed expert and keeps facility selection independent', () => {
    const result = selectDirectorySourceKeys([
      catalog({ widgetKey: 'facility-widget', bookingMode: 'facility' }),
      catalog({
        widgetKey: 'fixed-widget',
        bookingMode: 'expert',
        fixedExpertId: 'expert-a',
      }),
    ])

    assert.equal(result.facilityWidgetKeys.get('facility-a'), 'facility-widget')
    assert.equal(result.expertWidgetKeys.get('expert-a'), 'fixed-widget')
  })

  it('uses the widget key as a deterministic tie-breaker', () => {
    const result = selectDirectorySourceKeys([
      catalog({ widgetKey: 'widget-z', bookingMode: 'expert' }),
      catalog({ widgetKey: 'widget-a', bookingMode: 'expert' }),
    ])

    assert.equal(result.expertWidgetKeys.get('expert-a'), 'widget-a')
  })
})

describe('selectBookableCatalogEntries', () => {
  const services = [
    { key: 'service-a', name: 'A' },
    { key: 'service-b', name: 'B' },
  ]

  it('rejects a catalog without an expert–service pair', () => {
    assert.equal(selectBookableCatalogEntries(services, [], null), null)
    assert.equal(selectBookableCatalogEntries(
      services,
      [{ expertId: 'expert-a', serviceKeys: [] }],
      null,
    ), null)
  })

  it('publishes only services handled by an eligible expert', () => {
    const result = selectBookableCatalogEntries(
      services,
      [{ expertId: 'expert-a', serviceKeys: ['service-a'] }],
      null,
    )

    assert.deepEqual(result?.services, [{ key: 'service-a', name: 'A' }])
  })

  it('limits a fixed widget to its actual fixed expert', () => {
    const result = selectBookableCatalogEntries(
      services,
      [
        { expertId: 'expert-a', serviceKeys: ['service-a'] },
        { expertId: 'expert-b', serviceKeys: ['service-b'] },
      ],
      'expert-b',
    )

    assert.deepEqual(result?.experts.map(expert => expert.expertId), ['expert-b'])
    assert.deepEqual(result?.services, [{ key: 'service-b', name: 'B' }])
  })
})
