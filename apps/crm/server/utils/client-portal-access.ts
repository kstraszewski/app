import { createError, type H3Event } from 'h3'
import { issueClientPortalInvitation } from './client-portal-invitations'
import type { CrmSession } from './crm'
import { recordCrmActivity, throwDbError } from './crm'
import { serverDataBackend } from './data-api'

type DatabaseRecord = Record<string, any>

export interface ClientPortalAccessRecipient {
  client_id: string
  client_person_id: string
  display_name: string
  email: string | null
  email_normalized: string | null
  phone: string | null
  is_primary: true
}

export interface ClientPortalCaseGrant {
  portal_enabled: boolean
  multiform_enabled: boolean
  portal_enabled_at: string | null
  multiform_enabled_at: string | null
  revoked_at: string | null
  created_at: string | null
  updated_at: string | null
  revision: number
}

export interface ClientPortalInvitationSummary {
  id: string
  email_normalized: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expires_at: string
  sent_at: string | null
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
  revision: number
  delivery_attempts: number
  delivery_failed: boolean
}

export type ClientPortalInvitationDeliveryStatus =
  | 'missing_email'
  | 'not_created'
  | 'pending_send'
  | 'failed'
  | 'sent'
  | 'accepted'
  | 'expired'
  | 'revoked'

export interface ClientPortalAccessResponse {
  data: {
    case_id: string
    recipient: ClientPortalAccessRecipient | null
    access: ClientPortalCaseGrant
    invitation: ClientPortalInvitationSummary | null
    invitation_delivery: {
      status: ClientPortalInvitationDeliveryStatus
      message: string
    }
    can_configure: boolean
    blocking_reason: string | null
  }
}

interface PortalAccessContext {
  caseId: string
  recipient: ClientPortalAccessRecipient | null
  grant: DatabaseRecord | null
  invitation: DatabaseRecord | null
  accountActive: boolean
  blockingReason: string | null
}

function accessFromRow(row: DatabaseRecord | null): ClientPortalCaseGrant {
  return {
    portal_enabled: row?.portal_enabled === true && !row?.revoked_at,
    multiform_enabled: row?.multiform_enabled === true && !row?.revoked_at,
    portal_enabled_at: row?.portal_enabled_at ? String(row.portal_enabled_at) : null,
    multiform_enabled_at: row?.multiform_enabled_at ? String(row.multiform_enabled_at) : null,
    revoked_at: row?.revoked_at ? String(row.revoked_at) : null,
    created_at: row?.created_at ? String(row.created_at) : null,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
    revision: Number(row?.revision ?? 0),
  }
}

function invitationFromRow(row: DatabaseRecord | null): ClientPortalInvitationSummary | null {
  if (!row) return null
  const expiresAt = String(row.expires_at)
  const status = String(row.status) === 'pending'
    && Date.parse(expiresAt) <= Date.now()
    ? 'expired'
    : String(row.status) as ClientPortalInvitationSummary['status']
  return {
    id: String(row.id),
    email_normalized: String(row.email_normalized),
    status,
    expires_at: expiresAt,
    sent_at: row.sent_at ? String(row.sent_at) : null,
    accepted_at: row.accepted_at ? String(row.accepted_at) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    revision: Number(row.revision ?? 1),
    delivery_attempts: Number(row.delivery_attempts ?? 0),
    delivery_failed: Boolean(row.last_delivery_error),
  }
}

function invitationDelivery(
  recipient: ClientPortalAccessRecipient | null,
  access: ClientPortalCaseGrant,
  invitation: ClientPortalInvitationSummary | null,
  accountActive: boolean,
): ClientPortalAccessResponse['data']['invitation_delivery'] {
  if (!recipient?.email_normalized) {
    return {
      status: 'missing_email',
      message: 'Dodaj adres e-mail głównej osoby klienta, aby wysłać zaproszenie.',
    }
  }
  if (!access.portal_enabled) {
    return {
      status: invitation?.status === 'revoked' ? 'revoked' : 'not_created',
      message: 'Zaproszenie powstanie po udostępnieniu panelu klienta.',
    }
  }
  if (accountActive) {
    return {
      status: 'accepted',
      message: 'Klient ma już aktywne konto. Ta sprawa pojawi się w jego istniejącym panelu.',
    }
  }
  if (!invitation) {
    return {
      status: 'not_created',
      message: 'Dostęp jest aktywny, ale zaproszenie nie zostało jeszcze przygotowane.',
    }
  }
  if (invitation.status === 'accepted') {
    return { status: 'accepted', message: 'Klient aktywował już dostęp do panelu.' }
  }
  if (invitation.status === 'expired') {
    return { status: 'expired', message: 'Ostatnie zaproszenie wygasło.' }
  }
  if (invitation.status === 'revoked') {
    return { status: 'revoked', message: 'Ostatnie zaproszenie zostało cofnięte.' }
  }
  if (invitation.delivery_failed) {
    return {
      status: 'failed',
      message: 'Dostęp jest aktywny, ale nie udało się wysłać linku aktywacyjnego.',
    }
  }
  if (invitation.sent_at) {
    return { status: 'sent', message: 'Zaproszenie zostało wysłane na adres głównej osoby.' }
  }
  return {
    status: 'pending_send',
    message: 'Zaproszenie jest przygotowane i oczekuje na wysyłkę e-mail.',
  }
}

async function resolvePortalAccessContext(
  event: H3Event,
  session: CrmSession,
  caseId: string,
): Promise<PortalAccessContext> {
  const caseResult = await session.dataApi
    .from('crm_cases')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()
  if (caseResult.error || !caseResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const caseClientResult = await session.dataApi
    .from('crm_case_clients')
    .select('client_id, is_primary, created_at')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  throwDbError(caseClientResult.error)

  const primaryClientId = caseClientResult.data?.client_id
    ? String(caseClientResult.data.client_id)
    : null
  if (!primaryClientId) {
    return {
      caseId,
      recipient: null,
      grant: null,
      invitation: null,
      accountActive: false,
      blockingReason: 'Najpierw przypisz głównego klienta do sprawy.',
    }
  }

  const peopleResult = await session.dataApi
    .from('crm_client_people')
    .select('id, client_id, role, display_name, email, email_normalized, phone, created_at')
    .eq('organization_id', session.organizationId)
    .eq('client_id', primaryClientId)
    .order('created_at', { ascending: true })
  throwDbError(peopleResult.error)

  const people = (peopleResult.data ?? []) as DatabaseRecord[]
  const person = people.find(candidate => candidate.role === 'primary') ?? people[0] ?? null
  if (!person) {
    return {
      caseId,
      recipient: null,
      grant: null,
      invitation: null,
      accountActive: false,
      blockingReason: 'Główny klient nie ma osoby, której można udostępnić panel.',
    }
  }

  const recipient: ClientPortalAccessRecipient = {
    client_id: primaryClientId,
    client_person_id: String(person.id),
    display_name: String(person.display_name),
    email: person.email ? String(person.email) : null,
    email_normalized: person.email_normalized ? String(person.email_normalized) : null,
    phone: person.phone ? String(person.phone) : null,
    is_primary: true,
  }

  const backend = serverDataBackend(event) as any
  const [grantResult, invitationResult, accountLinkResult] = await Promise.all([
    session.dataApi
      .from('client_portal_case_grants')
      .select('organization_id, case_id, client_id, client_person_id, portal_enabled, multiform_enabled, granted_by_user_id, portal_enabled_at, multiform_enabled_at, revoked_at, created_at, updated_at, revision')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('client_person_id', recipient.client_person_id)
      .maybeSingle(),
    backend
      .from('client_portal_invitations')
      .select('id, email_normalized, status, expires_at, sent_at, accepted_at, revoked_at, delivery_attempts, last_delivery_error, created_at, updated_at, revision')
      .eq('organization_id', session.organizationId)
      .eq('client_person_id', recipient.client_person_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    backend
      .from('client_account_links')
      .select('auth_user_id')
      .eq('organization_id', session.organizationId)
      .eq('client_id', recipient.client_id)
      .eq('client_person_id', recipient.client_person_id)
      .eq('verification_method', 'email')
      .eq('verified_contact_normalized', recipient.email_normalized || '')
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle(),
  ])
  throwDbError(grantResult.error)
  throwDbError(invitationResult.error)
  throwDbError(accountLinkResult.error)

  return {
    caseId,
    recipient,
    grant: grantResult.data as DatabaseRecord | null,
    invitation: invitationResult.data as DatabaseRecord | null,
    accountActive: Boolean(accountLinkResult.data),
    blockingReason: null,
  }
}

function responseFromContext(context: PortalAccessContext): ClientPortalAccessResponse {
  const access = accessFromRow(context.grant)
  const invitation = invitationFromRow(context.invitation)
  return {
    data: {
      case_id: context.caseId,
      recipient: context.recipient,
      access,
      invitation,
      invitation_delivery: invitationDelivery(
        context.recipient,
        access,
        invitation,
        context.accountActive,
      ),
      can_configure: Boolean(context.recipient),
      blocking_reason: context.blockingReason,
    },
  }
}

export async function getClientPortalAccess(
  event: H3Event,
  session: CrmSession,
  caseId: string,
): Promise<ClientPortalAccessResponse> {
  return responseFromContext(await resolvePortalAccessContext(event, session, caseId))
}

async function revokePendingInvitations(
  event: H3Event,
  session: CrmSession,
  caseId: string,
  recipient: ClientPortalAccessRecipient,
  now: string,
): Promise<void> {
  const otherGrantResult = await session.dataApi
    .from('client_portal_case_grants')
    .select('case_id')
    .eq('organization_id', session.organizationId)
    .eq('client_person_id', recipient.client_person_id)
    .eq('portal_enabled', true)
    .is('revoked_at', null)
    .neq('case_id', caseId)
    .limit(1)
    .maybeSingle()
  if (otherGrantResult.error) {
    console.warn('[crm] failed to inspect other client portal grants', otherGrantResult.error.message)
    return
  }
  if (otherGrantResult.data) return

  const backend = serverDataBackend(event) as any
  const invitationsResult = await backend
    .from('client_portal_invitations')
    .select('id, revision')
    .eq('organization_id', session.organizationId)
    .eq('client_person_id', recipient.client_person_id)
    .eq('status', 'pending')
    .is('revoked_at', null)
  if (invitationsResult.error) {
    console.warn('[crm] failed to read pending client portal invitations', invitationsResult.error.message)
    return
  }

  await Promise.all(((invitationsResult.data ?? []) as DatabaseRecord[]).map(async (invitation) => {
    const result = await backend
      .from('client_portal_invitations')
      .update({
        status: 'revoked',
        revoked_at: now,
        revision: Number(invitation.revision ?? 1) + 1,
      })
      .eq('organization_id', session.organizationId)
      .eq('id', String(invitation.id))
      .eq('revision', Number(invitation.revision ?? 1))
    if (result.error) {
      console.warn('[crm] failed to revoke client portal invitation', result.error.message)
    }
  }))
}

export async function updateClientPortalAccess(
  event: H3Event,
  session: CrmSession,
  caseId: string,
  input: {
    portalEnabled: boolean
    multiformEnabled: boolean
    expectedRevision: number
    resendInvitation?: boolean
  },
): Promise<ClientPortalAccessResponse> {
  const context = await resolvePortalAccessContext(event, session, caseId)
  if (!context.recipient) {
    throw createError({
      statusCode: 409,
      statusMessage: context.blockingReason ?? 'Client portal recipient is missing',
    })
  }

  const current = accessFromRow(context.grant)
  if (current.revision !== input.expectedRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dostęp do panelu został zmieniony w innym oknie. Odśwież widok.',
    })
  }

  const now = new Date().toISOString()
  const portalEnabled = input.portalEnabled
  const multiformEnabled = portalEnabled && input.multiformEnabled
  const values = {
    client_id: context.recipient.client_id,
    portal_enabled: portalEnabled,
    multiform_enabled: multiformEnabled,
    granted_by_user_id: session.userId,
    portal_enabled_at: portalEnabled && !current.portal_enabled
      ? now
      : current.portal_enabled_at,
    multiform_enabled_at: multiformEnabled && !current.multiform_enabled
      ? now
      : current.multiform_enabled_at,
    revoked_at: portalEnabled ? null : now,
    revision: current.revision + 1,
  }

  const mutation = context.grant
    ? await session.dataApi
        .from('client_portal_case_grants')
        .update(values)
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .eq('client_person_id', context.recipient.client_person_id)
        .eq('revision', input.expectedRevision)
        .select('revision')
        .maybeSingle()
    : await session.dataApi
        .from('client_portal_case_grants')
        .insert({
          organization_id: session.organizationId,
          case_id: caseId,
          client_person_id: context.recipient.client_person_id,
          ...values,
        })
        .select('revision')
        .maybeSingle()

  if (mutation.error?.code === '23505' || (!mutation.error && !mutation.data)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dostęp do panelu został zmieniony w innym oknie. Odśwież widok.',
    })
  }
  throwDbError(mutation.error)

  if (
    portalEnabled
    && (!current.portal_enabled || input.resendInvitation)
    && context.recipient.email
  ) {
    try {
      await issueClientPortalInvitation(event, {
        organizationId: session.organizationId,
        clientId: context.recipient.client_id,
        clientPersonId: context.recipient.client_person_id,
        email: context.recipient.email,
        invitedByUserId: session.userId,
        name: context.recipient.display_name,
      })
    }
    catch (error) {
      console.error('[crm] failed to issue client portal invitation after granting access', error)
    }
  }
  else if (!portalEnabled) {
    await revokePendingInvitations(event, session, caseId, context.recipient, now)
  }

  const portalChanged = current.portal_enabled !== portalEnabled
  const multiformChanged = current.multiform_enabled !== multiformEnabled
  if (portalChanged) {
    await recordCrmActivity(session, {
      client_id: context.recipient.client_id,
      case_id: caseId,
      activity_type: portalEnabled ? 'client_portal_shared' : 'client_portal_revoked',
      title: portalEnabled ? 'Udostępniono panel klienta' : 'Cofnięto dostęp do panelu klienta',
      body: context.recipient.display_name,
      payload: { client_person_id: context.recipient.client_person_id },
    })
  }
  if (multiformChanged) {
    await recordCrmActivity(session, {
      client_id: context.recipient.client_id,
      case_id: caseId,
      activity_type: multiformEnabled ? 'client_multiform_shared' : 'client_multiform_revoked',
      title: multiformEnabled
        ? 'Udostępniono klientowi formularz Multiwniosku'
        : 'Wyłączono klientowi formularz Multiwniosku',
      body: context.recipient.display_name,
      payload: { client_person_id: context.recipient.client_person_id },
    })
  }

  return getClientPortalAccess(event, session, caseId)
}
