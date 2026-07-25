import assert from 'node:assert/strict'
import test from 'node:test'

import {
  firstAvailableImageSource,
  withFailedImageSource,
} from '../app/utils/image-source-fallback.ts'

test('falls back from an unavailable override to the canonical image', () => {
  const custom = 'https://cdn.example.com/custom.png'
  const canonical = 'https://cdn.example.com/canonical.png'
  let failed = new Set<string>()

  assert.equal(firstAvailableImageSource([custom, canonical], failed), custom)
  failed = withFailedImageSource(failed, custom)
  assert.equal(firstAvailableImageSource([custom, canonical], failed), canonical)
  failed = withFailedImageSource(failed, canonical)
  assert.equal(firstAvailableImageSource([custom, canonical], failed), null)
})

test('does not retry a duplicate failed URL and accepts a later replacement', () => {
  const broken = 'https://cdn.example.com/broken.png'
  const replacement = 'https://cdn.example.com/replacement.png'
  const failed = withFailedImageSource(new Set(), broken)

  assert.equal(firstAvailableImageSource([broken, broken], failed), null)
  assert.equal(firstAvailableImageSource([replacement, broken], failed), replacement)
})
