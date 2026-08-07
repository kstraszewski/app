import assert from 'node:assert/strict'
import test from 'node:test'
import { filterAuthCookieHeader } from '../server/utils/auth-cookie-header.ts'

test('forwards production Better Auth cookies with secure prefixes', () => {
  assert.equal(
    filterAuthCookieHeader([
      '__Secure-openexpert.session_token=signed-session',
      '__Host-openexpert.session_data=cached-session',
      'openexpert.csrf_token=csrf-token',
    ].join('; '), 'openexpert'),
    [
      '__Secure-openexpert.session_token=signed-session',
      '__Host-openexpert.session_data=cached-session',
      'openexpert.csrf_token=csrf-token',
    ].join('; '),
  )
})

test('does not forward unrelated or client portal cookies', () => {
  assert.equal(
    filterAuthCookieHeader([
      '__Secure-openexpert.session_token=signed-session',
      '__Secure-openexpert-client.session_token=client-session',
      'analytics=value',
      'malformed-cookie',
    ].join('; '), 'openexpert'),
    '__Secure-openexpert.session_token=signed-session',
  )
})

test('requires a configured cookie prefix', () => {
  assert.equal(filterAuthCookieHeader('openexpert.session_token=value', ''), '')
})
