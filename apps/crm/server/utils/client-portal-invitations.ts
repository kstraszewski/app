import { serverClientPortalAuth } from '~~/server/utils/platform-auth'
import { serverDataBackend } from '~~/server/utils/data-api'
import type { H3Event } from 'h3'

interface ClientPortalConfig {
  baseUrl?: string
  invitationTtlSeconds?: number
}

export interface IssueClientPortalInvitationInput {
  organizationId: string
  clientId: string
  clientPersonId: string
  email: string
  invitedByUserId: string
  name?: string | null
}

export interface ClientPortalInvitationDelivery {
  id: string | null
  status: 'sent' | 'failed' | 'already_active'
  expiresAt: string | null
  sentAt: string | null
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase()
}

function portalConfiguration(event: H3Event) {
  const configured = useRuntimeConfig(event).clientPortal as ClientPortalConfig
  const baseUrl = String(configured?.baseUrl || '').replace(/\/$/u, '')
  const invitationTtlSeconds = Number(configured?.invitationTtlSeconds || 3600)
  if (!baseUrl || !Number.isSafeInteger(invitationTtlSeconds) || invitationTtlSeconds <= 0) {
    throw new Error('Client portal invitation configuration is invalid')
  }
  return { baseUrl, invitationTtlSeconds }
}

function deliveryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.slice(0, 2_000) || 'Unknown invitation delivery error'
}

export async function issueClientPortalInvitation(
  event: H3Event,
  input: IssueClientPortalInvitationInput,
): Promise<ClientPortalInvitationDelivery> {
  const email = normalizedEmail(input.email)
  if (!email) throw new Error('Client portal invitation email is required')

  const now = new Date()
  const { baseUrl, invitationTtlSeconds } = portalConfiguration(event)
  const expiresAt = new Date(now.valueOf() + invitationTtlSeconds * 1_000).toISOString()
  const backend = serverDataBackend(event) as any

  // A person who activated the portal through a previous invitation or the
  // public booking flow already owns the shared Better Auth identity. Adding
  // another case must reuse that link instead of sending a second activation.
  const activeLinkResult = await backend
    .from('client_account_links')
    .select('auth_user_id')
    .eq('organization_id', input.organizationId)
    .eq('client_id', input.clientId)
    .eq('client_person_id', input.clientPersonId)
    .eq('verification_method', 'email')
    .eq('verified_contact_normalized', email)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle()
  if (activeLinkResult.error) throw new Error(activeLinkResult.error.message)
  if (activeLinkResult.data) {
    return {
      id: null,
      status: 'already_active',
      expiresAt: null,
      sentAt: null,
    }
  }

  const existingResult = await backend
    .from('client_portal_invitations')
    .select('id, revision, delivery_attempts')
    .eq('organization_id', input.organizationId)
    .eq('client_person_id', input.clientPersonId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingResult.error) throw new Error(existingResult.error.message)

  let invitation: { id: string, revision: number, delivery_attempts: number }
  if (existingResult.data) {
    const updateResult = await backend
      .from('client_portal_invitations')
      .update({
        client_id: input.clientId,
        email_normalized: email,
        expires_at: expiresAt,
        sent_at: null,
        revoked_at: null,
        invited_by_user_id: input.invitedByUserId,
        last_delivery_error: null,
        revision: Number(existingResult.data.revision || 0) + 1,
        updated_at: now.toISOString(),
      })
      .eq('id', existingResult.data.id)
      .eq('status', 'pending')
      .eq('revision', Number(existingResult.data.revision))
      .select('id, revision, delivery_attempts')
      .single()
    if (updateResult.error || !updateResult.data) {
      throw new Error(updateResult.error?.message || 'Unable to refresh client portal invitation')
    }
    invitation = updateResult.data
  }
  else {
    const insertResult = await backend
      .from('client_portal_invitations')
      .insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        client_person_id: input.clientPersonId,
        email_normalized: email,
        status: 'pending',
        expires_at: expiresAt,
        invited_by_user_id: input.invitedByUserId,
      })
      .select('id, revision, delivery_attempts')
      .single()
    if (insertResult.error || !insertResult.data) {
      throw new Error(insertResult.error?.message || 'Unable to create client portal invitation')
    }
    invitation = insertResult.data
  }

  const activationURL = new URL('/activate', `${baseUrl}/`)
  activationURL.searchParams.set('invitation', invitation.id)
  const loginURL = new URL('/login', `${baseUrl}/`)
  loginURL.searchParams.set('email', email)
  loginURL.searchParams.set('redirect', `${activationURL.pathname}${activationURL.search}`)

  try {
    await serverClientPortalAuth(event).auth.api.signInMagicLink({
      body: {
        email,
        name: input.name || undefined,
        callbackURL: activationURL.toString(),
        newUserCallbackURL: activationURL.toString(),
        errorCallbackURL: loginURL.toString(),
        metadata: {
          clientPortalInvitation: true,
          invitationId: invitation.id,
        },
      },
      headers: new Headers({ origin: baseUrl }),
    })

    const sentAt = new Date().toISOString()
    const deliveryResult = await backend
      .from('client_portal_invitations')
      .update({
        sent_at: sentAt,
        delivery_attempts: Number(invitation.delivery_attempts || 0) + 1,
        last_delivery_error: null,
        updated_at: sentAt,
      })
      .eq('id', invitation.id)
      .eq('status', 'pending')
      .eq('revision', invitation.revision)
    if (deliveryResult.error) {
      console.error('Unable to persist client portal invitation delivery status', deliveryResult.error)
    }
    return { id: invitation.id, status: 'sent', expiresAt, sentAt }
  }
  catch (error) {
    const failedAt = new Date().toISOString()
    const failureResult = await backend
      .from('client_portal_invitations')
      .update({
        delivery_attempts: Number(invitation.delivery_attempts || 0) + 1,
        last_delivery_error: deliveryErrorMessage(error),
        updated_at: failedAt,
      })
      .eq('id', invitation.id)
      .eq('status', 'pending')
      .eq('revision', invitation.revision)
    if (failureResult.error) {
      console.error('Unable to persist client portal invitation delivery failure', failureResult.error)
    }
    console.error('Unable to send client portal invitation', error)
    return { id: invitation.id, status: 'failed', expiresAt, sentAt: null }
  }
}
