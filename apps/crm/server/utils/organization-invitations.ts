import { createError, type H3Event } from 'h3'
import type {
  OrganizationInvitationBillingDiscount,
  OrganizationInvitationDelivery,
  OrganizationOnboardingSource,
  SystemOrganizationInvitation,
} from '../../shared/types/system-organizations'
import { invitationBillingDiscountLabel } from '~~/shared/organization-invitation-discount'
import {
  createOrganizationInvitationToken,
  hashOrganizationInvitationToken,
  isOrganizationInvitationToken,
} from '../lib/organization-invitation-token'
import { serverDataBackend } from './data-api'
import { serverOrganizationInvitationAuth } from './platform-auth'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const INVITATION_SELECT = [
  'id',
  'email_normalized',
  'organization_name',
  'organization_kind',
  'onboarding_source',
  'initial_seat_count',
  'administrator_name',
  'discount_kind',
  'discount_percent_off_bps',
  'discount_amount_off_minor',
  'discount_currency',
  'discount_duration',
  'discount_duration_months',
  'discount_status',
  'discount_stripe_coupon_id',
  'discount_stripe_checkout_session_id',
  'discount_stripe_subscription_id',
  'discount_livemode',
  'discount_applied_at',
  'status',
  'organization_id',
  'invited_by_user_id',
  'accepted_by_user_id',
  'expires_at',
  'sent_at',
  'accepted_at',
  'completed_at',
  'revoked_at',
  'revision',
  'delivery_attempts',
  'last_delivery_error',
  'created_at',
  'updated_at',
].join(', ')

export type OrganizationInvitationKind = 'intermediary' | 'application'
type OrganizationOnboardingInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'completed'
  | 'expired'
  | 'revoked'

interface OrganizationInvitationRuntimeConfig {
  enabled?: boolean
  baseUrl?: string
  basePath?: string
  ttlSeconds?: number
}

export interface OrganizationInvitationRow {
  id: string
  email_normalized: string
  organization_name: string
  organization_kind: OrganizationInvitationKind
  onboarding_source: OrganizationOnboardingSource
  initial_seat_count: number
  administrator_name: string | null
  discount_kind: 'percentage' | 'fixed_amount' | null
  discount_percent_off_bps: number | null
  discount_amount_off_minor: number | null
  discount_currency: 'pln' | null
  discount_duration: 'once' | 'repeating' | 'forever' | null
  discount_duration_months: number | null
  discount_status: 'assigned' | 'checkout_created' | 'applied' | 'revoked' | null
  discount_stripe_coupon_id: string | null
  discount_stripe_checkout_session_id: string | null
  discount_stripe_subscription_id: string | null
  discount_livemode: boolean | null
  discount_applied_at: string | null
  status: OrganizationOnboardingInvitationStatus
  organization_id: string | null
  invited_by_user_id: string | null
  accepted_by_user_id: string | null
  expires_at: string
  sent_at: string | null
  accepted_at: string | null
  completed_at: string | null
  revoked_at: string | null
  revision: number
  delivery_attempts: number
  last_delivery_error: string | null
  created_at: string
  updated_at: string
}

export interface OrganizationInvitationPreview {
  email: string
  organizationName: string
  organizationKind: OrganizationInvitationKind
  onboardingSource: OrganizationOnboardingSource
  initialSeatCount: number
  status: OrganizationOnboardingInvitationStatus
  expiresAt: string
  sentAt: string | null
  canAccept: boolean
  canResume: boolean
  billingDiscount: OrganizationInvitationBillingDiscount | null
}

export interface OrganizationInvitationSummary extends SystemOrganizationInvitation {
  canAccept: boolean
  organizationId: string | null
  invitedByUserId: string | null
  acceptedByUserId: string | null
  acceptedAt: string | null
  completedAt: string | null
  revokedAt: string | null
  revision: number
  deliveryAttempts: number
  deliveryFailed: boolean
  lastDeliveryError: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateOrganizationInvitationInput {
  email: string
  organizationName: string
  organizationKind: OrganizationInvitationKind
  onboardingSource?: OrganizationOnboardingSource
  initialSeatCount?: number
  administratorName?: string | null
  billingDiscount?: OrganizationInvitationBillingDiscount | null
  invitedByUserId: string | null
}

export interface IssuedOrganizationInvitation {
  invitation: OrganizationInvitationSummary
  inviteUrl: string
  delivery: OrganizationInvitationDelivery
}

export interface PreparedOrganizationInvitation {
  invitation: OrganizationInvitationRow
  inviteUrl: string
  token: string
}

function invitationConfiguration(event: H3Event) {
  const config = useRuntimeConfig(event)
    .organizationInvitations as OrganizationInvitationRuntimeConfig
  if (config?.enabled !== true) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const baseUrl = String(config.baseUrl || '').replace(/\/+$/u, '')
  const basePath = String(config.basePath || '/api/organization-auth').trim()
  const ttlSeconds = Number(config.ttlSeconds)
  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(baseUrl)
  }
  catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Organization invitations are temporarily unavailable',
    })
  }
  if (
    !['http:', 'https:'].includes(parsedBaseUrl.protocol)
    || parsedBaseUrl.username
    || parsedBaseUrl.password
    || basePath !== '/api/organization-auth'
    || !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < 5 * 60
    || ttlSeconds > 30 * 24 * 60 * 60
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Organization invitations are temporarily unavailable',
    })
  }

  return { baseUrl, basePath, ttlSeconds }
}

function databaseError(
  error: { code?: string } | null | undefined,
  operation: string,
): void {
  if (!error) return
  console.error('[organization-invitations] database operation failed', {
    operation,
    code: String(error.code || ''),
  })
  throw createError({
    statusCode: 500,
    statusMessage: 'Organization invitation is temporarily unavailable',
  })
}

function deliveryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.slice(0, 2_000) || 'Unknown invitation delivery error'
}

function row(value: unknown): OrganizationInvitationRow {
  return value as OrganizationInvitationRow
}

export function organizationInvitationBillingDiscountFromRow(
  invitation: Pick<
    OrganizationInvitationRow,
    | 'discount_kind'
    | 'discount_percent_off_bps'
    | 'discount_amount_off_minor'
    | 'discount_currency'
    | 'discount_duration'
    | 'discount_duration_months'
  >,
): OrganizationInvitationBillingDiscount | null {
  const duration = invitation.discount_duration
  const durationMonths = invitation.discount_duration_months
  if (!invitation.discount_kind || !duration) return null

  if (invitation.discount_kind === 'percentage') {
    return {
      kind: 'percentage',
      percentOffBps: Number(invitation.discount_percent_off_bps),
      duration,
      durationMonths: duration === 'repeating' ? Number(durationMonths) : null,
    }
  }

  return {
    kind: 'fixed_amount',
    amountOffMinor: Number(invitation.discount_amount_off_minor),
    currency: 'pln',
    duration,
    durationMonths: duration === 'repeating' ? Number(durationMonths) : null,
  }
}

function billingDiscountInsert(discount: OrganizationInvitationBillingDiscount | null | undefined) {
  if (!discount) {
    return {
      discount_kind: null,
      discount_percent_off_bps: null,
      discount_amount_off_minor: null,
      discount_currency: null,
      discount_duration: null,
      discount_duration_months: null,
      discount_status: null,
    }
  }
  return {
    discount_kind: discount.kind,
    discount_percent_off_bps: discount.kind === 'percentage'
      ? discount.percentOffBps
      : null,
    discount_amount_off_minor: discount.kind === 'fixed_amount'
      ? discount.amountOffMinor
      : null,
    discount_currency: discount.kind === 'fixed_amount'
      ? discount.currency
      : null,
    discount_duration: discount.duration,
    discount_duration_months: discount.duration === 'repeating'
      ? discount.durationMonths
      : null,
    discount_status: 'assigned',
  }
}

function previewFromRow(invitation: OrganizationInvitationRow): OrganizationInvitationPreview {
  return {
    email: invitation.email_normalized,
    organizationName: invitation.organization_name,
    organizationKind: invitation.organization_kind,
    onboardingSource: invitation.onboarding_source,
    initialSeatCount: Number(invitation.initial_seat_count),
    status: invitation.status,
    expiresAt: invitation.expires_at,
    sentAt: invitation.sent_at,
    canAccept: invitation.status === 'pending'
      && new Date(invitation.expires_at).getTime() > Date.now(),
    canResume: invitation.status === 'accepted' || invitation.status === 'completed',
    billingDiscount: organizationInvitationBillingDiscountFromRow(invitation),
  }
}

export function organizationInvitationSummary(
  invitation: OrganizationInvitationRow,
): OrganizationInvitationSummary {
  return {
    id: invitation.id,
    ...previewFromRow(invitation),
    administratorName: invitation.administrator_name,
    organizationId: invitation.organization_id,
    invitedByUserId: invitation.invited_by_user_id,
    acceptedByUserId: invitation.accepted_by_user_id,
    acceptedAt: invitation.accepted_at,
    completedAt: invitation.completed_at,
    revokedAt: invitation.revoked_at,
    revision: Number(invitation.revision),
    deliveryAttempts: Number(invitation.delivery_attempts),
    deliveryFailed: Boolean(invitation.last_delivery_error),
    lastDeliveryError: invitation.last_delivery_error,
    createdAt: invitation.created_at,
    updatedAt: invitation.updated_at,
  }
}

export {
  createOrganizationInvitationToken,
  hashOrganizationInvitationToken,
  isOrganizationInvitationToken,
}

export function isOrganizationInvitationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function organizationInvitationUrl(event: H3Event, token: string): string {
  if (!isOrganizationInvitationToken(token)) {
    throw new TypeError('Organization invitation token is invalid')
  }
  const { baseUrl } = invitationConfiguration(event)
  const inviteUrl = new URL('/organization-invitation', `${baseUrl}/`)
  inviteUrl.searchParams.set('token', token)
  return inviteUrl.href
}

async function expireInvitationIfNeeded(
  event: H3Event,
  invitation: OrganizationInvitationRow,
): Promise<OrganizationInvitationRow> {
  if (
    invitation.status !== 'pending'
    || new Date(invitation.expires_at).getTime() > Date.now()
  ) return invitation

  const backend = serverDataBackend(event) as any
  const expiredAt = new Date().toISOString()
  const expiredResult = await backend
    .from('organization_onboarding_invitations')
    .update({
      status: 'expired',
      revision: Number(invitation.revision) + 1,
      updated_at: expiredAt,
    })
    .eq('id', invitation.id)
    .eq('status', 'pending')
    .eq('revision', invitation.revision)
    .lte('expires_at', expiredAt)
    .select(INVITATION_SELECT)
    .maybeSingle()
  databaseError(expiredResult.error, 'expire')
  if (expiredResult.data) return row(expiredResult.data)

  const currentResult = await backend
    .from('organization_onboarding_invitations')
    .select(INVITATION_SELECT)
    .eq('id', invitation.id)
    .maybeSingle()
  databaseError(currentResult.error, 'reload-after-expire')
  return currentResult.data ? row(currentResult.data) : invitation
}

export async function findOrganizationInvitationByToken(
  event: H3Event,
  token: unknown,
): Promise<OrganizationInvitationRow | null> {
  invitationConfiguration(event)
  if (!isOrganizationInvitationToken(token)) return null
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .select(INVITATION_SELECT)
    .eq('token_hash', hashOrganizationInvitationToken(token))
    .maybeSingle()
  databaseError(result.error, 'find-by-token')
  if (!result.data) return null
  return expireInvitationIfNeeded(event, row(result.data))
}

export async function previewOrganizationInvitation(
  event: H3Event,
  token: unknown,
): Promise<OrganizationInvitationPreview | null> {
  const invitation = await findOrganizationInvitationByToken(event, token)
  return invitation ? previewFromRow(invitation) : null
}

async function claimDeliveryAttempt(
  event: H3Event,
  invitation: OrganizationInvitationRow,
): Promise<OrganizationInvitationRow | null> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .update({
      sent_at: null,
      last_delivery_error: null,
      delivery_attempts: Number(invitation.delivery_attempts) + 1,
      revision: Number(invitation.revision) + 1,
    })
    .eq('id', invitation.id)
    .eq('status', 'pending')
    .eq('revision', invitation.revision)
    .gt('expires_at', new Date().toISOString())
    .select(INVITATION_SELECT)
    .maybeSingle()
  databaseError(result.error, 'claim-delivery-attempt')
  return result.data ? row(result.data) : null
}

async function recordDeliveryResult(
  event: H3Event,
  invitation: OrganizationInvitationRow,
  values: { sentAt: string | null, error: string | null },
): Promise<void> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .update({
      sent_at: values.sentAt,
      last_delivery_error: values.error,
    })
    .eq('id', invitation.id)
    .eq('status', 'pending')
    .eq('revision', invitation.revision)
  if (result.error) {
    console.error('[organization-invitations] could not persist delivery result', {
      code: String(result.error.code || ''),
    })
  }
}

export async function sendOrganizationInvitationMagicLink(
  event: H3Event,
  invitationInput: OrganizationInvitationRow,
  token: string,
): Promise<OrganizationInvitationDelivery> {
  if (!isOrganizationInvitationToken(token)) {
    throw new TypeError('Organization invitation token is invalid')
  }
  const invitation = await claimDeliveryAttempt(event, invitationInput)
  if (!invitation) {
    return {
      status: 'failed',
      sentAt: null,
      attempts: Number(invitationInput.delivery_attempts),
    }
  }

  const inviteUrl = organizationInvitationUrl(event, token)
  const loginUrl = new URL('/login', inviteUrl)
  loginUrl.searchParams.set('email', invitation.email_normalized)
  const inviteLocation = new URL(inviteUrl)
  loginUrl.searchParams.set('redirect', `${inviteLocation.pathname}${inviteLocation.search}`)
  const assignedBillingDiscount = organizationInvitationBillingDiscountFromRow(invitation)

  try {
    const runtime = serverOrganizationInvitationAuth(event)
    await runtime.auth.api.signInMagicLink({
      body: {
        email: invitation.email_normalized,
        name: invitation.administrator_name || undefined,
        callbackURL: inviteUrl,
        newUserCallbackURL: inviteUrl,
        errorCallbackURL: loginUrl.href,
        metadata: {
          organizationInvitation: true,
          invitationId: invitation.id,
          organizationName: invitation.organization_name,
          organizationKind: invitation.organization_kind,
          onboardingSource: invitation.onboarding_source,
          initialSeatCount: Number(invitation.initial_seat_count),
          billingDiscountLabel: assignedBillingDiscount
            ? invitationBillingDiscountLabel(assignedBillingDiscount)
            : undefined,
        },
      },
      headers: new Headers({ origin: runtime.config.baseURL }),
    })

    const sentAt = new Date().toISOString()
    await recordDeliveryResult(event, invitation, { sentAt, error: null })
    return {
      status: 'sent',
      sentAt,
      attempts: Number(invitation.delivery_attempts),
    }
  }
  catch (error) {
    await recordDeliveryResult(event, invitation, {
      sentAt: null,
      error: deliveryErrorMessage(error),
    })
    console.error('[organization-invitations] magic-link delivery failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return {
      status: 'failed',
      sentAt: null,
      attempts: Number(invitation.delivery_attempts),
    }
  }
}

export async function prepareOrganizationInvitation(
  event: H3Event,
  input: CreateOrganizationInvitationInput,
): Promise<PreparedOrganizationInvitation> {
  const onboardingSource = input.onboardingSource || 'superadmin_invitation'
  const initialSeatCount = input.initialSeatCount ?? 1
  if (
    !Number.isSafeInteger(initialSeatCount)
    || initialSeatCount < 1
    || initialSeatCount > 1_000
  ) {
    throw new TypeError('Initial seat count must be between 1 and 1000')
  }
  if (input.organizationKind === 'intermediary' && initialSeatCount !== 1) {
    throw new TypeError('Intermediary organizations support exactly one initial seat')
  }
  if (
    onboardingSource === 'self_service'
    && (
      input.organizationKind !== 'application'
      || input.billingDiscount != null
      || input.invitedByUserId != null
    )
  ) {
    throw new TypeError('Self-service registration must create an unassigned application offer')
  }
  const { ttlSeconds } = invitationConfiguration(event)
  const token = createOrganizationInvitationToken()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1_000).toISOString()
  const backend = serverDataBackend(event) as any
  const insertResult = await backend
    .from('organization_onboarding_invitations')
    .insert({
      token_hash: hashOrganizationInvitationToken(token),
      email_normalized: input.email,
      organization_name: input.organizationName,
      organization_kind: input.organizationKind,
      onboarding_source: onboardingSource,
      initial_seat_count: initialSeatCount,
      administrator_name: input.administratorName || null,
      ...billingDiscountInsert(input.billingDiscount),
      status: 'pending',
      invited_by_user_id: input.invitedByUserId,
      expires_at: expiresAt,
    })
    .select(INVITATION_SELECT)
    .single()
  databaseError(insertResult.error, 'create')
  const invitation = row(insertResult.data)
  return {
    invitation,
    inviteUrl: organizationInvitationUrl(event, token),
    token,
  }
}

export async function createOrganizationInvitation(
  event: H3Event,
  input: CreateOrganizationInvitationInput,
): Promise<IssuedOrganizationInvitation> {
  const prepared = await prepareOrganizationInvitation(event, input)
  const delivery = await sendOrganizationInvitationMagicLink(
    event,
    prepared.invitation,
    prepared.token,
  )

  return {
    invitation: {
      ...organizationInvitationSummary(prepared.invitation),
      sentAt: delivery.sentAt,
      deliveryAttempts: delivery.attempts,
      deliveryFailed: delivery.status === 'failed',
      lastDeliveryError: delivery.status === 'failed'
        ? 'Invitation delivery failed'
        : null,
    },
    inviteUrl: prepared.inviteUrl,
    delivery,
  }
}

export async function resendOrganizationInvitation(
  event: H3Event,
  invitationId: string,
): Promise<IssuedOrganizationInvitation> {
  if (!isOrganizationInvitationId(invitationId)) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  const { ttlSeconds } = invitationConfiguration(event)
  const backend = serverDataBackend(event) as any
  const existingResult = await backend
    .from('organization_onboarding_invitations')
    .select(INVITATION_SELECT)
    .eq('id', invitationId)
    .maybeSingle()
  databaseError(existingResult.error, 'find-for-resend')
  if (!existingResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  const existing = row(existingResult.data)
  if (existing.status !== 'pending' && existing.status !== 'expired') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Only pending or expired invitations can be resent',
    })
  }

  const token = createOrganizationInvitationToken()
  const updateResult = await backend
    .from('organization_onboarding_invitations')
    .update({
      token_hash: hashOrganizationInvitationToken(token),
      status: 'pending',
      expires_at: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
      sent_at: null,
      last_delivery_error: null,
      revision: Number(existing.revision) + 1,
    })
    .eq('id', existing.id)
    .eq('revision', existing.revision)
    .in('status', ['pending', 'expired'])
    .select(INVITATION_SELECT)
    .maybeSingle()
  databaseError(updateResult.error, 'rotate-for-resend')
  if (!updateResult.data) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation changed concurrently' })
  }

  const invitation = row(updateResult.data)
  const delivery = await sendOrganizationInvitationMagicLink(event, invitation, token)
  return {
    invitation: {
      ...organizationInvitationSummary(invitation),
      sentAt: delivery.sentAt,
      deliveryAttempts: delivery.attempts,
      deliveryFailed: delivery.status === 'failed',
      lastDeliveryError: delivery.status === 'failed'
        ? 'Invitation delivery failed'
        : null,
    },
    inviteUrl: organizationInvitationUrl(event, token),
    delivery,
  }
}

export async function revokeOrganizationInvitation(
  event: H3Event,
  invitationId: string,
): Promise<OrganizationInvitationSummary> {
  if (!isOrganizationInvitationId(invitationId)) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  const backend = serverDataBackend(event) as any
  const existingResult = await backend
    .from('organization_onboarding_invitations')
    .select(INVITATION_SELECT)
    .eq('id', invitationId)
    .maybeSingle()
  databaseError(existingResult.error, 'find-for-revoke')
  if (!existingResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  const existing = row(existingResult.data)
  if (existing.status === 'revoked') return organizationInvitationSummary(existing)
  if (existing.status !== 'pending' && existing.status !== 'expired') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Accepted invitations cannot be revoked',
    })
  }

  const revokedAt = new Date().toISOString()
  const updateResult = await backend
    .from('organization_onboarding_invitations')
    .update({
      status: 'revoked',
      revoked_at: revokedAt,
      discount_status: existing.discount_kind ? 'revoked' : null,
      revision: Number(existing.revision) + 1,
    })
    .eq('id', existing.id)
    .eq('revision', existing.revision)
    .in('status', ['pending', 'expired'])
    .select(INVITATION_SELECT)
    .maybeSingle()
  databaseError(updateResult.error, 'revoke')
  if (!updateResult.data) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation changed concurrently' })
  }
  return organizationInvitationSummary(row(updateResult.data))
}
