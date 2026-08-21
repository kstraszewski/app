import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createOrganizationMemberInvitationToken,
  hashOrganizationMemberInvitationToken,
  isOrganizationMemberInvitationToken,
} from '../server/lib/organization-member-invitation-token.ts'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('member invitation tokens store only a deterministic SHA-256 digest', () => {
  const first = createOrganizationMemberInvitationToken()
  const second = createOrganizationMemberInvitationToken()
  assert.equal(first.length, 43)
  assert.equal(isOrganizationMemberInvitationToken(first), true)
  assert.notEqual(first, second)
  const digest = hashOrganizationMemberInvitationToken(first)
  assert.match(digest, /^[0-9a-f]{64}$/u)
  assert.equal(hashOrganizationMemberInvitationToken(first), digest)
  assert.notEqual(first, digest)
  assert.throws(() => hashOrganizationMemberInvitationToken('invalid'), /token is invalid/u)
})

test('migration reserves capacity atomically and exposes writes only through service RPCs', () => {
  const migration = source('../../../packages/database/postgres/migrations/0079_organization_member_invitations.sql')
  const organizationLock = migration.indexOf('FOR UPDATE;', migration.indexOf('CREATE FUNCTION public.create_organization_member_invitation_v1'))
  const billingLock = migration.indexOf('FOR UPDATE;', organizationLock + 1)
  const reservationCount = migration.indexOf('membership_count + reservation_count', billingLock)

  assert.ok(organizationLock > 0)
  assert.ok(billingLock > organizationLock)
  assert.ok(reservationCount > billingLock)
  assert.match(migration, /organization_memberships_enforce_member_reservations/)
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.add_organization_member_within_capacity_v1[\s\S]+membership_count \+ reservation_count >= billing_account\.licensed_seat_count/,
  )
  assert.match(migration, /invitation\.expires_at > statement_timestamp\(\)/)
  assert.match(migration, /member_invitation_verified_email_mismatch/)
  assert.match(migration, /UPDATE public\.organization_member_invitations[\s\S]+status = 'accepted'[\s\S]+INSERT INTO public\.organization_memberships/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.organization_member_invitations[\s\S]+openexpert_service/)
  assert.match(migration, /GRANT SELECT ON TABLE public\.organization_member_invitations[\s\S]+openexpert_service/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.accept_organization_member_invitation_v1/)
  assert.doesNotMatch(migration, /stripe\.subscriptions|stripe\.invoices|payment_url/)
})

test('admin and public endpoints enforce same-origin session-bound acceptance', () => {
  const createEndpoint = source('../server/api/org/[organizationSlug]/member-invitations/index.post.ts')
  const acceptEndpoint = source('../server/api/member-invitations/[token]/accept.post.ts')
  const auth = source('../server/utils/platform-auth.ts')

  assert.match(createEndpoint, /isOpenExpertSameOriginJsonRequest/)
  assert.match(createEndpoint, /requireCrmSession/)
  assert.match(createEndpoint, /requireOrganizationAdmin/)
  assert.match(acceptEndpoint, /isOpenExpertSameOriginJsonRequest/)
  assert.match(acceptEndpoint, /requireAuthIdentity/)
  assert.match(acceptEndpoint, /identity\.emailVerified/)
  assert.match(acceptEndpoint, /accept_organization_member_invitation_v1/)
  assert.match(auth, /metadata\?\.organizationMemberInvitation === true/)
  assert.match(auth, /przyjęcie zaproszenia nie uruchomi żadnej płatności/)
})

test('member quote and confirmation fence active plus reserved occupied seats', () => {
  const quote = source('../server/api/org/[organizationSlug]/members/quote.post.ts')
  const confirm = source('../server/api/org/[organizationSlug]/members/index.post.ts')
  const listing = source('../server/api/org/[organizationSlug]/members/index.get.ts')
  const page = source('../app/pages/org/[organizationSlug]/users/index.vue')

  assert.match(quote, /countLiveOrganizationMemberInvitations/)
  assert.match(quote, /const occupiedSeats = activeMembers \+ reservedSeats/)
  assert.match(quote, /expectedReservedSeats: reservedSeats/)
  assert.match(quote, /expectedOccupiedSeats: occupiedSeats/)
  assert.match(confirm, /expectedReservedSeats !== reservedSeats/)
  assert.match(confirm, /expectedOccupiedSeats !== occupiedSeats/)
  assert.ok(
    confirm.indexOf('expectedOccupiedSeats !== occupiedSeats')
      < confirm.indexOf("add_organization_member_within_capacity_v1"),
    'reservation CAS must run before the free-seat writer',
  )
  assert.match(listing, /session\.role === 'admin'/)
  assert.match(page, /licensedSeats[\s\S]+- directory\.value\.billing\.activeMembers[\s\S]+- directory\.value\.billing\.reservedSeats/)
  assert.match(page, /orgApiPath\('\/member-invitations'\)/)
  assert.match(page, /Wyślij zaproszenie/)
  assert.match(page, /Zwolnij miejsce/)
})
