import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { directoryHydrationData } from '../app/utils/directory.ts'

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
