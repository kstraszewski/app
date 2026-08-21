import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOrganizationInvitationToken,
  hashOrganizationInvitationToken,
  isOrganizationInvitationToken,
} from '../server/lib/organization-invitation-token.ts'

test('organization invitation tokens contain 256 bits of URL-safe randomness', () => {
  const first = createOrganizationInvitationToken()
  const second = createOrganizationInvitationToken()

  assert.equal(first.length, 43)
  assert.equal(second.length, 43)
  assert.equal(isOrganizationInvitationToken(first), true)
  assert.equal(isOrganizationInvitationToken(second), true)
  assert.notEqual(first, second)
})

test('organization invitation tokens persist only as deterministic SHA-256 digests', () => {
  const token = createOrganizationInvitationToken()
  const digest = hashOrganizationInvitationToken(token)

  assert.match(digest, /^[0-9a-f]{64}$/u)
  assert.equal(hashOrganizationInvitationToken(token), digest)
  assert.notEqual(digest, token)
})

test('organization invitation token validation rejects malformed bearer values', () => {
  assert.equal(isOrganizationInvitationToken(undefined), false)
  assert.equal(isOrganizationInvitationToken('a'.repeat(42)), false)
  assert.equal(isOrganizationInvitationToken(`${'a'.repeat(42)}+`), false)
  assert.throws(
    () => hashOrganizationInvitationToken('invalid'),
    /token is invalid/u,
  )
})
