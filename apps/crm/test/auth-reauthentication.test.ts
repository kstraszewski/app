import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { reauthenticationRedirect } from '../app/utils/auth-reauthentication.ts'

describe('reauthenticationRedirect', () => {
  it('preserves the page query and hash while adding a resume action', () => {
    assert.equal(
      reauthenticationRedirect(
        '/org/openexpert/settings/account/login-methods?source=security#passkeys',
        'add-passkey',
      ),
      '/org/openexpert/settings/account/login-methods?source=security&resume=add-passkey#passkeys',
    )
  })

  it('replaces an existing resume action instead of duplicating it', () => {
    assert.equal(
      reauthenticationRedirect('/settings?resume=old', 'add-passkey'),
      '/settings?resume=add-passkey',
    )
  })

  it('always returns an internal path', () => {
    assert.equal(
      reauthenticationRedirect('https://example.com/settings?mode=security'),
      '/settings?mode=security',
    )
  })
})
