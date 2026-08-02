import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePortalAvatarUrl } from '../shared/utils/portal-avatar.ts'

const assetBaseUrl = 'https://www.openexpert.app'

test('resolves bundled expert avatars against the public asset origin', () => {
  assert.equal(
    resolvePortalAvatarUrl('/avatars/experts/local-administrator.webp', assetBaseUrl),
    'https://www.openexpert.app/avatars/experts/local-administrator.webp',
  )
})

test('keeps secure absolute avatar URLs', () => {
  assert.equal(
    resolvePortalAvatarUrl('https://example.com/avatar.webp', assetBaseUrl),
    'https://example.com/avatar.webp',
  )
})

test('rejects insecure or unexpected avatar paths', () => {
  assert.equal(resolvePortalAvatarUrl('http://example.com/avatar.webp', assetBaseUrl), null)
  assert.equal(resolvePortalAvatarUrl('/private/avatar.webp', assetBaseUrl), null)
  assert.equal(resolvePortalAvatarUrl('/avatars/experts/../secret.webp', assetBaseUrl), null)
})
