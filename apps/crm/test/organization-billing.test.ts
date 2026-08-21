import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  APPLICATION_BILLING_PLANS,
  APPLICATION_MONTHLY_PLAN,
  isBillingAccessGranted,
  isOrganizationKind,
  stripeSubscriptionAccessState,
} from '../shared/organization-billing.ts'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('application offers enforce individual and team prices while retaining the legacy plan', () => {
  assert.deepEqual(APPLICATION_BILLING_PLANS.individual, {
    code: 'individual',
    stripePlanCode: 'application_individual_monthly',
    name: 'Indywidualny',
    currency: 'pln',
    unitAmount: 20_000,
    interval: 'month',
    intervalCount: 1,
    minSeats: 1,
    maxSeats: 1,
    taxBehavior: 'exclusive',
  })
  assert.equal(APPLICATION_BILLING_PLANS.team.unitAmount, 15_000)
  assert.equal(APPLICATION_BILLING_PLANS.team.minSeats, 3)
  assert.equal(APPLICATION_BILLING_PLANS.team.taxBehavior, 'exclusive')
  assert.deepEqual(APPLICATION_MONTHLY_PLAN, {
    code: 'application_monthly',
    name: 'Aplikacja (plan historyczny)',
    currency: 'pln',
    unitAmount: 20_000,
    interval: 'month',
    intervalCount: 1,
  })
})

test('only the two product organization kinds are accepted', () => {
  assert.equal(isOrganizationKind('intermediary'), true)
  assert.equal(isOrganizationKind('application'), true)
  assert.equal(isOrganizationKind('admin'), false)
  assert.equal(isOrganizationKind(null), false)
})

test('Stripe subscription states map to coarse organization access', () => {
  assert.equal(stripeSubscriptionAccessState('trialing'), 'active')
  assert.equal(stripeSubscriptionAccessState('active'), 'active')
  assert.equal(stripeSubscriptionAccessState('past_due'), 'grace')
  assert.equal(stripeSubscriptionAccessState('incomplete'), 'subscription_required')
  assert.equal(stripeSubscriptionAccessState('unpaid'), 'blocked')
  assert.equal(stripeSubscriptionAccessState('canceled'), 'blocked')
})

test('only paid, grace and non-billable states grant application access', () => {
  assert.equal(isBillingAccessGranted('not_required'), true)
  assert.equal(isBillingAccessGranted('active'), true)
  assert.equal(isBillingAccessGranted('grace'), true)
  assert.equal(isBillingAccessGranted('subscription_required'), false)
  assert.equal(isBillingAccessGranted('blocked'), false)
})

test('Checkout creates the durable purchased seat capacity and never trusts a client quantity', () => {
  const checkout = source('../server/api/org/[organizationSlug]/billing/checkout.post.ts')
  assert.match(checkout, /organizationActiveMemberCount/)
  assert.match(checkout, /organizationCheckoutSeatTarget/)
  assert.match(checkout, /quantity: expectedSeats/)
  assert.match(checkout, /purchased_seat_count: String\(expectedSeats\)/)
  assert.match(checkout, /`seats-\$\{expectedSeats\}`/)
  assert.doesNotMatch(checkout, /readBody/)
  assert.match(checkout, /payment_method_collection: 'always'/)
  assert.match(checkout, /billing_model: 'per_seat_v2'/)
  assert.match(checkout, /automatic_tax: \{ enabled: !config\.demoMode \}/)
  assert.match(checkout, /Stripe Tax must be configured before live Checkout can be used/)
  assert.match(checkout, /billing_plan_code: billingPlanCode/)
  assert.match(checkout, /checkoutLinePriceId !== price\.id/)
  assert.match(checkout, /checkout\.sessions\.expire/)
  assert.doesNotMatch(checkout, /'canceled', 'incomplete_expired', 'unpaid'/)

  const billing = source('../server/utils/stripe-billing.ts')
  assert.match(billing, /if \(activeMembers !== 1\)/)
  assert.match(billing, /Multi-seat Checkout requires a registration seat offer/)
})

test('member management consumes paid capacity before asking Stripe for another seat', () => {
  const quote = source('../server/api/org/[organizationSlug]/members/quote.post.ts')
  const add = source('../server/api/org/[organizationSlug]/members/index.post.ts')
  const users = source('../app/pages/org/[organizationSlug]/users/index.vue')

  assert.match(quote, /organizationBillingAccount/)
  assert.match(quote, /const occupiedSeats = activeMembers \+ reservedSeats/)
  assert.match(quote, /occupiedSeats >= licensedSeats/)
  assert.match(quote, /expectedActiveMembers: activeMembers/)
  assert.match(quote, /expectedReservedSeats: reservedSeats/)
  assert.match(quote, /expectedOccupiedSeats: occupiedSeats/)
  assert.match(quote, /nextSeats: currentSeats \+ \(increasesPaidCapacity/)
  assert.match(add, /const billingRequired = occupiedSeats >= licensedSeats/)
  assert.match(add, /expectedActiveMembers !== activeMembers/)
  assert.match(add, /expectedReservedSeats !== reservedSeats/)
  assert.match(add, /expectedOccupiedSeats !== occupiedSeats/)
  assert.match(add, /quotedBillingRequired !== billingRequired/)
  assert.match(add, /add_organization_member_within_capacity_v1/)
  assert.match(users, /quotedBillingRequired: inviteQuote\.value\.billingRequired/)
  assert.match(users, /expectedActiveMembers: inviteQuote\.value\.expectedActiveMembers/)
  assert.match(users, /expectedReservedSeats: inviteQuote\.value\.expectedReservedSeats/)
  assert.match(users, /expectedOccupiedSeats: inviteQuote\.value\.expectedOccupiedSeats/)

  const quoteFence = add.indexOf('expectedActiveMembers !== activeMembers')
  const freeSeatBranch = add.indexOf('if (!billingRequired)')
  const idempotencyRead = add.indexOf("requiredText(body.idempotencyKey")
  const stripeMutation = add.indexOf('await updateOrganizationStripeSeatQuantity', idempotencyRead)
  assert.ok(quoteFence >= 0)
  assert.ok(freeSeatBranch > quoteFence)
  assert.ok(freeSeatBranch >= 0)
  assert.ok(idempotencyRead > freeSeatBranch)
  assert.ok(stripeMutation > idempotencyRead)
})

test('seat updates use exact Stripe proration, pending updates and DB idempotency', () => {
  const billing = source('../server/utils/stripe-billing.ts')
  assert.match(billing, /preview_mode: 'recurring'/)
  assert.match(billing, /subscription_item_details\?\.proration === true/)
  assert.match(billing, /payment_behavior: 'pending_if_incomplete'/)
  assert.match(billing, /proration_behavior: 'always_invoice'/)
  assert.match(billing, /p_expected_seat_count: input\.expectedCurrentSeats/)
  assert.match(billing, /resolve_organization_member_seat_target_v1/)
  assert.match(billing, /p_stripe_invoice_id: invoiceId/)
  assert.match(billing, /apply_organization_billing_and_seat_snapshot_v1/)
  assert.doesNotMatch(billing, /backend\.rpc\('apply_organization_billing_snapshot'/)
  assert.doesNotMatch(billing, /backend\.rpc\('apply_organization_seat_snapshot_v1'/)
  assert.match(billing, /result\.data\.stripe_invoice_id !== input\.invoiceId/)
  assert.match(billing, /hydrateOpenOrganizationSeatChangePayment/)
  assert.match(billing, /invoice\.billing_reason === 'subscription_update'/)
  assert.match(billing, /invoiceSubscriptionId\(invoice\) === subscription\.id/)
  assert.match(billing, /invoice\.status !== 'open'/)
  assert.match(billing, /invoice\.amount_remaining <= 0/)
  assert.match(billing, /isInvoiceForSubscriptionUpdate\(invoice, subscription, \{ requireLatest: true \}\)/)
  assert.match(billing, /invoiceId: correlatedInvoice\?\.id \?\? null/)
  assert.match(billing, /invoiceId: invoice\?\.id \?\? null/)
  assert.doesNotMatch(billing, /invoiceId: paymentUrl \?/)
  assert.doesNotMatch(billing, /paymentUrl: invoice\?\.hosted_invoice_url/)
  assert.match(billing, /pendingQuantity !== plan\.quantity \+ 1/)
  assert.match(billing, /reconcileExpiredOrganizationSeatChange/)
  assert.doesNotMatch(billing, /stripe\.invoices\.voidInvoice/)
  assert.match(billing, /claim_organization_member_seat_stripe_update_v1/)
  assert.match(billing, /fail_stale_organization_member_seat_change_v1/)
  assert.match(billing, /bindExpiredOrganizationSeatChangeInvoice/)
  assert.match(billing, /snapshotEventCreated: number/)
  assert.match(billing, /snapshotEventCreated = Number\(account\.last_stripe_event_created_at/)
  assert.match(billing, /immediateAmount: prorationPreview\.amount_due/)
  assert.match(billing, /price\.tax_behavior !== plan\.taxBehavior/)
  assert.match(billing, /openexpert_application_individual_monthly_pln_exclusive_v1/)
  assert.match(billing, /openexpert_application_team_monthly_pln_exclusive_v1/)
  assert.match(billing, /openexpert_application_monthly_pln_inclusive_v2/)
  assert.match(billing, /storedSubscriptionId !== subscription\.id/)
  assert.match(billing, /checkoutSessionId === storedCheckoutSessionId/)
  assert.match(billing, /payload\.subscriptionAccepted === false/)
  assert.match(billing, /p_stripe_subscription_item_id: plan\.subscriptionItemId/)
  assert.match(billing, /p_quantity: plan\.quantity/)
  assert.match(billing, /payload\.seatSnapshot/)
  assert.match(billing, /normalizedEventCreated \+ GRACE_PERIOD_DAYS/)
  assert.doesNotMatch(billing, /Math\.max\(normalizedEventCreated, plan\.currentPeriodEndTimestamp\)/)
  assert.match(billing, /value\.startsWith\('rkcs_test_'\)/)
  assert.doesNotMatch(billing, /value\.startsWith\('rkcs_live_'\)/)

  const exactInvoiceLookup = billing.indexOf('const exactInvoice = await backend')
  const exactInvoiceCorrelation = billing.lastIndexOf(
    'isInvoiceForSubscriptionUpdate(invoice, subscription, { requireLatest: false })',
    exactInvoiceLookup,
  )
  assert.ok(exactInvoiceCorrelation >= 0)
  assert.ok(exactInvoiceCorrelation < exactInvoiceLookup)

  const exactInvoiceEnd = billing.indexOf('if (exactInvoice.error)', exactInvoiceLookup)
  assert.ok(exactInvoiceEnd > exactInvoiceLookup)
  assert.doesNotMatch(
    billing.slice(exactInvoiceLookup, exactInvoiceEnd),
    /\.in\('status', \['prepared', 'pending'\]\)/,
  )

  const mutationClaim = billing.indexOf(
    'claimOrganizationMemberSeatStripeMutation(event',
  )
  const stripeQuantityUpdate = billing.indexOf(
    'subscriptions.update(subscription.id',
    mutationClaim,
  )
  const stripeQuantityUpdateStatement = billing.lastIndexOf(
    'const updated = await',
    stripeQuantityUpdate,
  )
  assert.ok(mutationClaim >= 0)
  assert.ok(stripeQuantityUpdate > mutationClaim)
  assert.ok(stripeQuantityUpdateStatement > mutationClaim)
  assert.doesNotMatch(
    billing.slice(mutationClaim, stripeQuantityUpdateStatement),
    /await (?!claimOrganizationMemberSeatStripeMutation)/,
  )

  const oneShotFence = source(
    '../../../packages/database/postgres/migrations/0075_organization_seat_change_single_stripe_mutation.sql',
  )
  assert.match(oneShotFence, /AND status = 'prepared'/)
  assert.match(oneShotFence, /AND attempts = 0/)
  assert.match(oneShotFence, /SET status = 'pending',\s*attempts = 1/)
  assert.doesNotMatch(oneShotFence, /status IN \('prepared', 'pending'\)/)

  const invoiceCorrelation = source(
    '../../../packages/database/postgres/migrations/0076_organization_seat_invoice_correlation.sql',
  )
  assert.match(
    invoiceCorrelation,
    /payment_url IS NULL OR stripe_invoice_id IS NOT NULL/,
  )
  assert.match(
    invoiceCorrelation,
    /normalized_payment_url IS NOT NULL[\s\S]*normalized_invoice_id IS NULL/,
  )
  assert.doesNotMatch(
    invoiceCorrelation,
    /\(normalized_invoice_id IS NULL\) <> \(normalized_payment_url IS NULL\)/,
  )
  assert.match(
    invoiceCorrelation,
    /seat_change\.status IN \('succeeded', 'failed'\)[\s\S]*normalized_status = 'pending'[\s\S]*normalized_invoice_id IS NOT NULL[\s\S]*stripe_invoice_id = coalesce\(stripe_invoice_id, normalized_invoice_id\)/,
  )
  assert.match(
    invoiceCorrelation,
    /preserve_existing_block := organization_access_state = 'blocked'/,
  )
  assert.match(
    invoiceCorrelation,
    /IF preserve_existing_block THEN[\s\S]*SET billing_access_state = 'blocked'/,
  )
  assert.doesNotMatch(
    invoiceCorrelation,
    /preserve_existing_block :=[\s\S]{0,200}p_event_created\s*<=/,
  )
  const invoiceCorrelationSmoke = source(
    '../../../packages/database/postgres/smoke/0076_organization_seat_invoice_correlation.sql',
  )
  assert.match(
    invoiceCorrelationSmoke,
    /status = 'failed'[\s\S]*stripe_invoice_id = 'in_0076InvoiceOnly'[\s\S]*payment_url IS NULL/,
  )
  assert.match(
    invoiceCorrelationSmoke,
    /Concurrent expiry won before the Invoice binder[\s\S]*'in_0076TerminalRace'[\s\S]*terminal_race_payload ->> 'status' <> 'failed'[\s\S]*terminal_race_payload ->> 'stripeInvoiceId' <> 'in_0076TerminalRace'/,
  )
  assert.match(
    invoiceCorrelationSmoke,
    /renewal failure T1[\s\S]*newer canonical Subscription T3[\s\S]*invoice\.paid T2[\s\S]*'resolved'[\s\S]*newerBlockPreserved[\s\S]*organization_paid_recovery_canonical_reapply_failed/,
  )
  assert.match(
    invoiceCorrelationSmoke,
    /canonical seat mismatch[\s\S]*newer_subscription_event_value \+ 2[\s\S]*'failed'[\s\S]*organization_invoice_newer_failure_reopened_existing_block[\s\S]*newer_subscription_event_value \+ 3[\s\S]*'resolved'[\s\S]*organization_invoice_newer_resolve_reopened_existing_block[\s\S]*organization_invoice_existing_block_canonical_unlock_failed/,
  )
})

test('individual upgrades to a three-seat team only after a canonical prorated confirmation', () => {
  const billing = source('../server/utils/stripe-billing.ts')
  const quote = source('../server/api/org/[organizationSlug]/billing/upgrade/quote.post.ts')
  const confirm = source('../server/api/org/[organizationSlug]/billing/upgrade.post.ts')
  const webhook = source('../server/api/stripe/webhook.post.ts')
  const migration = source('../../../packages/database/postgres/migrations/0081_application_billing_plans.sql')
  const billingPage = source('../app/pages/org/[organizationSlug]/settings/billing.vue')
  const usersPage = source('../app/pages/org/[organizationSlug]/users/index.vue')

  assert.match(quote, /requireOrganizationAdmin\(session\)/)
  assert.match(quote, /createOrganizationPlanUpgradeQuote/)
  assert.match(confirm, /const canonicalQuote = await createOrganizationPlanUpgradeQuote/)
  assert.match(confirm, /canonicalQuote\.expectedSeatRevision !== expectedSeatRevision/)
  assert.match(confirm, /canonicalQuote\.targetStripePriceId !== targetStripePriceId/)
  assert.match(billing, /plan\.billingPlanCode !== 'individual'/)
  assert.match(billing, /price: targetPrice\.id/)
  assert.match(billing, /quantity: APPLICATION_BILLING_PLANS\.team\.minSeats/)
  assert.match(billing, /payment_behavior: 'pending_if_incomplete'/)
  assert.match(billing, /claimOrganizationPlanUpgradeMutation/)
  assert.match(billing, /fail_stale_organization_plan_upgrade_v1/)
  assert.match(webhook, /matchingOpenOrganizationPlanChangeId/)
  assert.match(webhook, /failOpenOrganizationPlanChange/)

  assert.match(migration, /billing_plan_code = 'individual' AND initial_seat_count = 1/)
  assert.match(migration, /billing_plan_code = 'team' AND initial_seat_count BETWEEN 3 AND 1000/)
  assert.match(migration, /from_plan_code = 'individual'/)
  assert.match(migration, /target_plan_code = 'team'/)
  assert.match(migration, /expected_seat_count = 1/)
  assert.match(migration, /target_seat_count = 3/)
  assert.match(migration, /organization_billing_plan_changes_open_unique/)
  assert.match(migration, /private\.apply_organization_seat_snapshot_generation_v1/)
  assert.match(migration, /TO openexpert_service/)

  assert.match(billingPage, /Przejdź na plan Zespół/)
  assert.match(billingPage, /Potwierdź upgrade i obciążenie/)
  assert.match(usersPage, /individualUpgradeRequired/)
  assert.match(usersPage, /przejdź na plan Zespół/i)
})

test('billing and canonical seats are persisted atomically behind one service-only RPC', () => {
  const migration = source(
    '../../../packages/database/postgres/migrations/0074_organization_billing_and_seat_snapshot.sql',
  )
  const runtimeSmoke = source(
    '../../../packages/database/postgres/smoke/0074_organization_billing_and_seat_snapshot.sql',
  )
  const mvccSmoke = source(
    '../../../packages/database/postgres/smoke/0074_organization_billing_and_seat_snapshot_mvcc.sh',
  )

  assert.match(
    migration,
    /ALTER FUNCTION public\.apply_organization_billing_snapshot\([\s\S]*?\) SET SCHEMA private;/,
  )
  assert.match(
    migration,
    /RENAME TO apply_organization_billing_snapshot_effective_v1;/,
  )
  assert.match(
    migration,
    /ALTER FUNCTION public\.apply_organization_seat_snapshot_v1\([\s\S]*?\) SET SCHEMA private;/,
  )
  assert.match(
    migration,
    /RENAME TO apply_organization_seat_snapshot_generation_v1;/,
  )
  assert.match(
    migration,
    /CREATE FUNCTION public\.apply_organization_billing_and_seat_snapshot_v1\(/,
  )
  assert.match(
    migration,
    /IF tg_op = 'UPDATE'[\s\S]*old\.status = 'accepted'[\s\S]*new\.status = 'completed'[\s\S]*RETURN NULL;/,
  )
  assert.match(
    migration,
    /preserve_newer_block := organization_access_state = 'blocked'[\s\S]*p_event_created <= account_last_event_created;/,
  )

  const invitationSelect = migration.indexOf(
    'FROM public.organization_onboarding_invitations AS invitation',
  )
  const invitationLock = migration.indexOf('FOR UPDATE;', invitationSelect)
  const billingApply = migration.indexOf(
    'billing_snapshot := private.apply_organization_billing_snapshot_effective_v1(',
  )
  const billingRejected = migration.indexOf(
    "billing_snapshot ->> 'subscriptionAccepted'",
    billingApply,
  )
  const seatApply = migration.indexOf(
    'seat_snapshot := private.apply_organization_seat_snapshot_generation_v1(',
  )
  const invitationRestore = migration.indexOf(
    "SET status = 'accepted'",
    seatApply,
  )
  const finalStateRead = migration.lastIndexOf(
    'SELECT organization.billing_access_state INTO STRICT final_access_state',
  )
  assert.ok(invitationSelect >= 0)
  assert.ok(invitationLock > invitationSelect)
  assert.ok(billingApply > invitationLock)
  assert.ok(billingRejected > billingApply)
  assert.ok(seatApply > billingRejected)
  assert.ok(invitationRestore > seatApply)
  assert.ok(finalStateRead > invitationRestore)

  assert.match(
    migration,
    /WHEN coalesce\(\(billing_snapshot ->> 'subscriptionReplaced'\)::boolean, false\)[\s\S]*lastStripeEventCreatedAt/,
  )
  assert.match(
    migration,
    /seat_snapshot_valid :=[\s\S]*subscriptionAccepted[\s\S]*mismatch[\s\S]*stale/,
  )
  assert.match(
    migration,
    /WHERE id = accepted_invitation_id[\s\S]*status = 'completed'[\s\S]*revision = accepted_invitation_revision \+ 1/,
  )
  assert.match(migration, /revision = accepted_invitation_revision/)
  assert.match(
    migration,
    /SELECT invitation\.status = 'completed'[\s\S]*INTO STRICT final_invitation_completed/,
  )
  assert.equal(
    migration.match(/'invitationCompleted', final_invitation_completed/g)?.length,
    2,
  )
  assert.match(
    migration,
    /'billingAccessState', final_access_state,[\s\S]*'seatSnapshot', seat_snapshot/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION private\.apply_organization_billing_snapshot_effective_v1\([\s\S]*FROM PUBLIC, anonymous, authenticated, openexpert_service;/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION private\.apply_organization_seat_snapshot_generation_v1\([\s\S]*FROM PUBLIC, anonymous, authenticated, openexpert_service;/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.apply_organization_billing_and_seat_snapshot_v1\([\s\S]*\) TO openexpert_service;/,
  )
  assert.equal(
    runtimeSmoke.match(/snapshot ->> 'invitationCompleted' <> 'false'/g)?.length,
    2,
  )
  assert.equal(
    runtimeSmoke.match(/snapshot ->> 'invitationCompleted' <> 'true'/g)?.length,
    1,
  )
  assert.match(mvccSmoke, /SELECT pg_sleep\(5\)/)
  assert.match(mvccSmoke, /state_before_commit[\s\S]*!= "blocked"/)
  assert.match(mvccSmoke, /state_after_commit[\s\S]*!= "active"/)
})

test('billable seats require a full admin while intermediary delegation remains available', () => {
  const members = source('../server/api/org/[organizationSlug]/members/index.post.ts')
  const quote = source('../server/api/org/[organizationSlug]/members/quote.post.ts')
  for (const route of [members, quote]) {
    assert.match(
      route,
      /if \(session\.organizationKind === 'application'\) \{\s*requireOrganizationAdmin\(session\)/,
    )
    assert.match(
      route,
      /else \{\s*await requireAdministrativePermission\(session, 'iam\.members\.manage'\)/,
    )
  }
  assert.match(members, /if \(session\.organizationKind !== 'application'\)/)
  assert.match(
    quote,
    /billingRequired = session\.organizationKind === 'application'[\s\S]*&& addsSeat[\s\S]*&& occupiedSeats >= licensedSeats/,
  )
  assert.match(members, /UUID_PATTERN\.test\(idempotencyKey\)/)
  assert.match(source('../server/utils/stripe-billing.ts'), /value < now - 10 \* 60/)
  assert.match(members, /markOrganizationMemberSeatChangePending/)
})

test('the customer portal cannot bypass the application seat saga', () => {
  const portal = source('../server/api/org/[organizationSlug]/billing/portal.post.ts')
  assert.match(portal, /customerPortalConfigurationId/)
  assert.match(portal, /features\.subscription_update\.enabled/)
  assert.doesNotMatch(portal, /customerPortalConfigurationId \|\| undefined/)
})

test('billing history and webhooks cover SCA recovery paths', () => {
  const webhook = source('../server/api/stripe/webhook.post.ts')
  const history = source('../server/api/org/[organizationSlug]/billing/history.get.ts')
  const pdf = source('../server/api/org/[organizationSlug]/billing/invoices/[invoiceId]/pdf.get.ts')
  assert.match(webhook, /customer\.subscription\.pending_update_applied/)
  assert.match(webhook, /customer\.subscription\.pending_update_expired/)
  assert.match(webhook, /failOpenOrganizationSeatChange/)
  assert.match(webhook, /invoice\.payment_action_required/)
  assert.match(webhook, /invoice\.payment_failed/)
  assert.match(webhook, /invoice\.voided/)
  assert.match(webhook, /applyOrganizationInvoiceBillingState/)
  assert.match(webhook, /matchingOpenOrganizationSeatChangeId/)
  assert.match(webhook, /invoice_finalization_failed/)
  assert.match(webhook, /invoice_uncollectible/)
  assert.match(webhook, /!context\.subscription\.pending_update/)
  assert.match(webhook, /isStaleStripeSubscriptionSnapshotError/)
  assert.match(webhook, /claimed\.status === 'processing'/)
  assert.match(webhook, /statusCode: 503/)
  assert.match(history, /requireOrganizationAdmin\(session\)/)
  assert.match(pdf, /objectId\(invoice\.customer\) !== account\.stripe_customer_id/)

  const billing = source('../server/utils/stripe-billing.ts')
  const contextHelper = billing.indexOf(
    'export async function retrieveCurrentStripeSubscriptionContext(',
  )
  const invoiceContextHelper = billing.indexOf(
    'export async function retrieveCurrentStripeInvoiceSubscriptionContext(',
    contextHelper,
  )
  const contextHelperSource = billing.slice(contextHelper, invoiceContextHelper)
  assert.ok(contextHelper >= 0)
  assert.ok(invoiceContextHelper > contextHelper)
  assert.match(contextHelperSource, /subscriptions\.retrieve\(subscriptionId/)
  assert.match(contextHelperSource, /subscriptionOrganizationId\(event, subscription\)/)
  assert.match(contextHelperSource, /account\.stripe_customer_id !== stripeObjectId\(subscription\.customer\)/)
  assert.match(contextHelperSource, /account\.livemode !== subscription\.livemode/)
  assert.match(contextHelperSource, /await stripeSubscriptionSeatPlan\(event, subscription, organizationId\)/)
  assert.doesNotMatch(contextHelperSource, /applyStripeSubscriptionSnapshot|apply_organization_billing/)

  const currentReapply = billing.indexOf(
    'export async function retrieveAndApplyCurrentStripeSubscription(',
  )
  const currentReapplyEnd = billing.indexOf(
    'export function checkoutSubscriptionId(',
    currentReapply,
  )
  const currentReapplySource = billing.slice(currentReapply, currentReapplyEnd)
  assert.ok(currentReapply >= 0)
  assert.ok(currentReapplyEnd > currentReapply)
  assert.match(currentReapplySource, /organizationBillingAccount\(event, input\.organizationId\)/)
  assert.match(currentReapplySource, /Math\.max\(input\.eventCreated, accountEventCreated\)/)
  assert.match(currentReapplySource, /retrieveAndApplyStripeSubscription\(/)

  const expiredBinder = billing.indexOf('export async function bindExpiredOrganizationSeatChangeInvoice(')
  const expiredBinderEnd = billing.indexOf(
    'export async function reconcileExpiredOrganizationSeatChange(',
    expiredBinder,
  )
  const expiredBinderSource = billing.slice(expiredBinder, expiredBinderEnd)
  assert.ok(expiredBinder >= 0)
  assert.ok(expiredBinderEnd > expiredBinder)
  assert.match(expiredBinderSource, /requireLatest: true/)
  assert.match(expiredBinderSource, /invoiceCreatedMs = invoice\.created \* 1000/)
  assert.match(expiredBinderSource, /invoiceCreatedMs <= changeCreatedMs/)
  assert.match(expiredBinderSource, /invoiceCreatedMs <= prorationDateMs/)
  assert.doesNotMatch(expiredBinderSource, /Math\.floor\(Date\.parse/)
  assert.match(expiredBinderSource, /invoiceId: invoice\.id/)

  const expiredCase = webhook.indexOf("case 'customer.subscription.pending_update_expired':")
  const expiredInvoiceBind = webhook.indexOf(
    'bindExpiredOrganizationSeatChangeInvoice(',
    expiredCase,
  )
  const expiredFailure = webhook.indexOf('failOpenOrganizationSeatChange(event', expiredCase)
  assert.ok(expiredCase >= 0)
  assert.ok(expiredInvoiceBind > expiredCase)
  assert.ok(expiredFailure > expiredInvoiceBind)
  assert.match(
    webhook.slice(expiredInvoiceBind, webhook.indexOf('return true', expiredFailure)),
    /if \(expiredInvoice\) \{[\s\S]*failOpenOrganizationSeatChange\(event[\s\S]*invoiceId: expiredInvoice\.invoiceId/,
  )
  const expiredContext = webhook.indexOf(
    'retrieveCurrentStripeSubscriptionContext(',
    expiredCase,
  )
  const expiredCanonicalReapply = webhook.indexOf(
    'reapplyCanonicalSubscriptionAfterTerminalInvoice(',
    expiredFailure,
  )
  assert.ok(expiredContext > expiredCase)
  assert.ok(expiredContext < expiredInvoiceBind)
  assert.ok(expiredCanonicalReapply > expiredFailure)
  assert.doesNotMatch(
    webhook.slice(expiredCase, expiredInvoiceBind),
    /retrieveAndApplyStripeSubscription|applyStripeSubscriptionSnapshot/,
  )
  const recoveryFenceSmoke = source(
    '../../../packages/database/postgres/smoke/0073_organization_seat_change_stripe_mutation_fence.sql',
  )
  assert.match(
    recoveryFenceSmoke,
    /mutation CAS wins[\s\S]*claim_organization_member_seat_stripe_update_v1[\s\S]*fail_stale_organization_member_seat_change_v1[\s\S]*recovery_result ->> 'failed' <> 'false'[\s\S]*recovery_result ->> 'status' <> 'pending'/,
  )

  const terminalClassifier = webhook.indexOf('async function matchingSeatChangeForTerminalInvoice(')
  const terminalClassifierEnd = webhook.indexOf('async function processEvent(', terminalClassifier)
  const terminalClassifierSource = webhook.slice(terminalClassifier, terminalClassifierEnd)
  const firstExactMatch = terminalClassifierSource.indexOf('matchingOpenOrganizationSeatChangeId(')
  const terminalBind = terminalClassifierSource.indexOf('bindExpiredOrganizationSeatChangeInvoice(')
  const secondExactMatch = terminalClassifierSource.indexOf(
    'matchingOpenOrganizationSeatChangeId(',
    firstExactMatch + 1,
  )
  assert.ok(terminalClassifier >= 0)
  assert.ok(terminalClassifierEnd > terminalClassifier)
  assert.ok(firstExactMatch >= 0)
  assert.ok(terminalBind > firstExactMatch)
  assert.ok(secondExactMatch > terminalBind)
  assert.match(
    terminalClassifierSource,
    /isInvoiceForSubscriptionUpdate\(invoice, subscription, \{ requireLatest: false \}\)[\s\S]*kind: 'renewal'/,
  )
  assert.match(
    terminalClassifierSource,
    /binding\?\.invoiceId !== invoice\.id[\s\S]*kind: 'uncorrelated_subscription_update'/,
  )

  const finalizationCase = webhook.indexOf("case 'invoice.finalization_failed':")
  const finalizationClassifier = webhook.indexOf(
    'matchingSeatChangeForTerminalInvoice(',
    finalizationCase,
  )
  const finalizationAnomaly = webhook.indexOf(
    "invoiceClassification.kind === 'renewal'",
    finalizationClassifier,
  )
  assert.ok(finalizationCase >= 0)
  assert.ok(finalizationClassifier > finalizationCase)
  assert.ok(finalizationAnomaly > finalizationClassifier)
  const finalizationContext = webhook.indexOf(
    'retrieveCurrentStripeInvoiceSubscriptionContext(',
    finalizationCase,
  )
  const finalizationReapply = webhook.indexOf(
    'reapplyCanonicalSubscriptionAfterTerminalInvoice(',
    finalizationAnomaly,
  )
  assert.ok(finalizationContext > finalizationCase)
  assert.ok(finalizationContext < finalizationClassifier)
  assert.ok(finalizationReapply > finalizationAnomaly)

  const voidedCase = webhook.indexOf("case 'invoice.voided':")
  const seatClassifier = webhook.indexOf('matchingSeatChangeForTerminalInvoice(', voidedCase)
  const renewalAnomaly = webhook.indexOf('applyOrganizationInvoiceBillingState(event', seatClassifier)
  const voidedCaseEnd = webhook.indexOf("case 'invoice.", voidedCase + 1)
  const voidedBranch = webhook.slice(
    voidedCase,
    voidedCaseEnd > voidedCase ? voidedCaseEnd : undefined,
  )
  assert.ok(voidedCase >= 0)
  assert.ok(seatClassifier > voidedCase)
  assert.ok(renewalAnomaly > seatClassifier)
  assert.match(
    voidedBranch,
    /invoiceClassification\.kind === 'seat_change'[\s\S]*failOrganizationMemberSeatChange\([\s\S]*else if \(invoiceClassification\.kind === 'renewal'\)[\s\S]*applyOrganizationInvoiceBillingState\(/,
  )
  const voidedContext = webhook.indexOf(
    'retrieveCurrentStripeInvoiceSubscriptionContext(',
    voidedCase,
  )
  const voidedReapply = webhook.indexOf(
    'reapplyCanonicalSubscriptionAfterTerminalInvoice(',
    renewalAnomaly,
  )
  assert.ok(voidedContext > voidedCase)
  assert.ok(voidedContext < seatClassifier)
  assert.ok(voidedReapply > renewalAnomaly)

  const paidCase = webhook.indexOf("case 'invoice.paid':")
  const paidContext = webhook.indexOf(
    'retrieveCurrentStripeInvoiceSubscriptionContext(',
    paidCase,
  )
  const paidResolved = webhook.indexOf('applyOrganizationInvoiceBillingState(event', paidContext)
  const paidReapply = webhook.indexOf(
    'reapplyCanonicalSubscriptionAfterTerminalInvoice(',
    paidResolved,
  )
  assert.ok(paidCase >= 0)
  assert.ok(paidContext > paidCase)
  assert.ok(paidResolved > paidContext)
  assert.ok(paidReapply > paidResolved)
  assert.doesNotMatch(
    webhook.slice(paidCase, paidResolved),
    /retrieveAndApplyStripeSubscription|applyStripeSubscriptionSnapshot/,
  )

  const reconcileStart = billing.indexOf('export async function reconcileExpiredOrganizationSeatChange(')
  const reconcileEnd = billing.indexOf(
    'export async function applyOrganizationInvoiceBillingState(',
    reconcileStart,
  )
  const reconcileSource = billing.slice(reconcileStart, reconcileEnd)
  const invoiceLessBranch = reconcileSource.indexOf('if (!invoiceId)')
  const reconcileBind = reconcileSource.indexOf(
    'bindExpiredOrganizationSeatChangeInvoice(',
    invoiceLessBranch,
  )
  const staleFailure = reconcileSource.lastIndexOf('return failObservedChange()')
  assert.ok(reconcileStart >= 0)
  assert.ok(reconcileEnd > reconcileStart)
  assert.ok(invoiceLessBranch >= 0)
  assert.ok(reconcileBind > invoiceLessBranch)
  assert.ok(staleFailure > reconcileBind)
  assert.match(
    reconcileSource,
    /binding\.changeId !== String\(openChange\.data\.id\)[\s\S]*return false/,
  )
  assert.match(
    reconcileSource,
    /invoiceBoundDuringReconciliation[\s\S]*failOrganizationMemberSeatChange\([\s\S]*return true/,
  )
})
