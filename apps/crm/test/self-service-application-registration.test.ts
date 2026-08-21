import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('public registration start is same-origin, rate-limited and enumeration resistant', () => {
  const endpoint = source('../server/api/registration/start.post.ts')
  const statusEndpoint = source('../server/api/registration/status.post.ts')

  assert.match(endpoint, /isOpenExpertSameOriginJsonRequest/)
  assert.match(endpoint, /scope: 'crm:self-service-registration'/)
  assert.match(endpoint, /identifier: normalizedEmailCandidate\(emailCandidate\)/)
  assert.match(endpoint, /ipAddress: getOpenExpertTrustedClientIp/)
  assert.match(endpoint, /windowMs: RATE_LIMIT_WINDOW_MS/)
  assert.match(endpoint, /pairMax: 3/)
  assert.match(endpoint, /scheduleOpenExpertBackgroundTask/)
  assert.match(endpoint, /RESPONSE_FLOOR_MS = 600/)
  assert.match(endpoint, /prepareOrganizationInvitation/)
  assert.match(endpoint, /createRegistrationDeliveryStatusToken/)
  assert.match(endpoint, /return \{ accepted: true, statusToken \}/)
  assert.doesNotMatch(endpoint, /inviteUrl/)
  assert.match(statusEndpoint, /verifyRegistrationDeliveryStatusToken/)
  assert.match(statusEndpoint, /isOpenExpertSameOriginJsonRequest/)
  assert.match(statusEndpoint, /readBody<unknown>/)
  assert.match(statusEndpoint, /Cache-Control', 'private, no-store'/)
  assert.match(statusEndpoint, /last_delivery_error/)
  assert.match(statusEndpoint, /status: 'failed'/)
  assert.doesNotMatch(statusEndpoint, /email_normalized/)
  assert.ok(
    endpoint.indexOf('consumeOpenExpertAuthRateLimit({')
      < endpoint.indexOf('const body = registrationBody(rawBody)'),
    'invalid registration payloads must still consume the IP rate limit',
  )
})

test('self-service registration creates only a valid individual or team application offer', () => {
  const endpoint = source('../server/api/registration/start.post.ts')
  const invitations = source('../server/utils/organization-invitations.ts')

  assert.match(endpoint, /initialSeatCount < 1/)
  assert.match(endpoint, /initialSeatCount > 100/)
  assert.match(endpoint, /isPublicApplicationBillingPlanCode\(billingPlan\)/)
  assert.match(endpoint, /applicationBillingPlanSeatCountIsValid\(billingPlan, initialSeatCount\)/)
  assert.match(endpoint, /organizationKind: 'application'/)
  assert.match(endpoint, /onboardingSource: 'self_service'/)
  assert.match(endpoint, /billingDiscount: null/)
  assert.match(endpoint, /invitedByUserId: null/)
  assert.doesNotMatch(endpoint, /signUp\.(email|phone)/)

  assert.match(invitations, /'onboarding_source'/)
  assert.match(invitations, /'initial_seat_count'/)
  assert.match(invitations, /'billing_plan_code'/)
  assert.match(invitations, /onboarding_source: onboardingSource/)
  assert.match(invitations, /initial_seat_count: initialSeatCount/)
  assert.match(invitations, /billing_plan_code: billingPlan/)
  assert.match(invitations, /onboardingSource === 'self_service'/)
  assert.match(invitations, /input\.billingDiscount != null/)
})

test('purpose-specific invitation email distinguishes requested registration from an admin invite', () => {
  const auth = source('../server/utils/platform-auth.ts')
  const handler = source('../server/api/organization-auth/[...all].ts')

  assert.match(auth, /metadata\.onboardingSource === 'self_service'/)
  assert.match(auth, /options\.organizationInvitationOnly && !sender\.isConfigured/)
  assert.match(auth, /Registration email is temporarily unavailable/)
  assert.match(auth, /Dokończ rejestrację organizacji w OpenExpert/)
  assert.match(auth, /Jeśli nie rozpoczynałeś rejestracji/)
  assert.match(auth, /initialSeatCount >= 1/)
  assert.match(auth, /initialSeatCount <= 100/)
  assert.match(handler, /event\.method !== 'GET'/)
  assert.match(handler, /authPath !== 'magic-link\/verify'/)
  assert.doesNotMatch(handler, /sign-up|signInMagicLink/)
  assert.match(auth, /magicLinkTokenNamespace: 'crm-primary'/)
  assert.match(auth, /magicLinkTokenNamespace: 'client-portal'/)
  assert.match(auth, /magicLinkTokenNamespace: 'crm-organization-invitation'/)
})

test('legacy onboarding cannot bypass the invitation seat grant', () => {
  const endpoint = source('../server/api/onboarding.post.ts')
  const onboarding = source('../app/pages/onboarding.vue')
  const migration = source(
    '../../../packages/database/postgres/migrations/0080_organization_creation_grant_gate.sql',
  )
  const localBootstrap = source(
    '../../../packages/database/scripts/local-postgres.mjs',
  )

  assert.match(endpoint, /organizationKind !== 'intermediary'/)
  assert.match(endpoint, /create_intermediary_organization_for_existing_identity_v1/)
  assert.doesNotMatch(endpoint, /create_organization_with_admin_v2/)
  assert.match(onboarding, /v-if="!contexts\?\.hasStaff"/)
  assert.match(onboarding, /to="\/register"/)
  assert.doesNotMatch(onboarding, /organizationKind: 'application'/)
  assert.match(migration, /existing_workforce_membership_required/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_organization_with_admin_v2/)
  assert.match(migration, /TO openexpert_service/)
  assert.match(localBootstrap, /SET LOCAL ROLE openexpert_owner/)
  assert.match(localBootstrap, /private\.create_organization_for_identity/)
  assert.doesNotMatch(localBootstrap, /userClient\.rpc\('create_organization_with_admin'/)
})

test('registration and resume UI carry the selected seat count through the magic-link flow', () => {
  const register = source('../app/pages/register.vue')
  const invitation = source('../app/pages/organization-invitation.vue')
  const login = source('../app/pages/login.vue')

  assert.match(register, /route\.query\.seats/)
  assert.match(register, /<UInputNumber/)
  assert.match(register, /:min="state\.billingPlan === 'team' \? 3 : 1"/)
  assert.match(register, /:max="100"/)
  assert.match(register, /\/api\/registration\/start/)
  assert.match(register, /\/api\/registration\/status/)
  assert.match(register, /deliveryStatus === 'failed'/)
  assert.match(register, /Nie możemy teraz potwierdzić wysyłki/)
  assert.match(register, /state\.initialSeatCount \* selectedPlan\.value\.unitAmount/)
  assert.match(register, /billingPlan: event\.data\.billingPlan/)
  assert.doesNotMatch(register, /Wysłaliśmy instrukcję/)
  assert.match(register, /Samo wysłanie formularza nie obciąża karty/)
  assert.doesNotMatch(register, /signUp\.(email|phone)/)

  assert.match(invitation, /invitation\.value\?\.initialSeatCount/)
  assert.match(invitation, /initialSeatCount\.value \* billingPlan\.value\.unitAmount/)
  assert.match(invitation, /Administrator zajmuje pierwsze miejsce/)
  assert.match(invitation, /Pozostałe \$\{initialSeatCount\.value - 1\} osoby możesz dodać po aktywacji/)
  assert.match(login, /to="\/register"/)
  assert.match(login, /Załóż organizację aplikacyjną/)
})
