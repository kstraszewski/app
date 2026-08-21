import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { authoritativeAgentBillingAccessGranted } from '../agent/lib/billing-access.ts'

const organizationId = '11111111-1111-4111-8111-111111111111'

function projection(billingAccessState: string, entitled: boolean) {
  return { organizationId, billingAccessState, entitled, graceUntil: null }
}

test('accepts only authoritative paid application projections', () => {
  assert.equal(
    authoritativeAgentBillingAccessGranted(
      'application',
      organizationId,
      projection('active', true),
    ),
    true,
  )
  assert.equal(
    authoritativeAgentBillingAccessGranted(
      'application',
      organizationId,
      projection('grace', true),
    ),
    true,
  )
  assert.equal(
    authoritativeAgentBillingAccessGranted(
      'application',
      organizationId,
      projection('blocked', false),
    ),
    false,
  )
})

test('accepts non-billable intermediaries and rejects mismatched kinds', () => {
  assert.equal(
    authoritativeAgentBillingAccessGranted(
      'intermediary',
      organizationId,
      projection('not_required', true),
    ),
    true,
  )
  assert.equal(
    authoritativeAgentBillingAccessGranted(
      'intermediary',
      organizationId,
      projection('active', false),
    ),
    false,
  )
})

test('fails closed on malformed, cross-organization or inconsistent projections', () => {
  assert.throws(
    () => authoritativeAgentBillingAccessGranted('application', organizationId, null),
    /projection/u,
  )
  assert.throws(
    () => authoritativeAgentBillingAccessGranted(
      'application',
      organizationId,
      { ...projection('active', true), organizationId: '22222222-2222-4222-8222-222222222222' },
    ),
    /projection/u,
  )
  assert.throws(
    () => authoritativeAgentBillingAccessGranted(
      'application',
      organizationId,
      projection('unknown', true),
    ),
    /projection/u,
  )
  assert.throws(
    () => authoritativeAgentBillingAccessGranted(
      'application',
      organizationId,
      projection('grace', false),
    ),
    /inconsistent/u,
  )
})

test('checks the service-only billing projection after membership and before Eve session access', () => {
  const source = readFileSync(
    new URL('../agent/channels/eve.ts', import.meta.url),
    'utf8',
  )
  const membershipCheck = source.indexOf(".from('organization_memberships')")
  const authoritativeProjection = source.indexOf("'get_organization_billing_access_v1'")
  const ownedSessionCheck = source.indexOf('await requireOwnedSession(')

  assert.ok(membershipCheck >= 0)
  assert.ok(authoritativeProjection > membershipCheck)
  assert.ok(ownedSessionCheck > authoritativeProjection)
  assert.doesNotMatch(source, /organization\.billing_access_state/u)
  assert.doesNotMatch(source, /isBillingAccessGranted/u)
})
