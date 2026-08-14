import { createError } from 'h3'
import type {
  MailContextDescriptor,
  MailContextScope,
  MailContextScopeType,
  MailProviderId,
} from '../../shared/types/mail.ts'
import type { CrmSession } from './crm.ts'
import { throwDbError } from './crm.ts'
import {
  mailContextThreadKeyHash,
  normalizeMailContextEmails,
  normalizedMailContextThreadReference,
  parseMailContextScope,
} from './mail-context-core.ts'

export type MailContextLinkSource = 'manual' | 'sent_from_context'

export interface ResolvedMailContext {
  scope: MailContextScope
  descriptor: MailContextDescriptor
  emails: string[]
}

export interface MailContextThreadLinkRow {
  id: string
  thread_key_hash: string
  thread_reference: string
  link_source: MailContextLinkSource
  updated_at: string
}

export async function resolveMailContextScope(
  session: CrmSession,
  input: MailContextScope,
): Promise<ResolvedMailContext> {
  const scope = parseMailContextScope(input)
  return scope.type === 'client'
    ? resolveClientContext(session, scope)
    : resolveCaseContext(session, scope)
}

export async function loadMailContextThreadLinks(
  backendData: any,
  session: Pick<CrmSession, 'organizationId' | 'userId'>,
  connectionId: string,
  scope: MailContextScope,
): Promise<MailContextThreadLinkRow[]> {
  let query = backendData
    .from('mail_context_thread_links')
    .select('id, thread_key_hash, thread_reference, link_source, updated_at')
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('connection_id', connectionId)
  query = scope.type === 'client'
    ? query.eq('client_id', scope.id).is('case_id', null)
    : query.eq('case_id', scope.id).is('client_id', null)
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(20)
  throwDbError(error)
  return (data ?? []) as MailContextThreadLinkRow[]
}

export async function upsertMailContextThreadLink(
  backendData: any,
  session: Pick<CrmSession, 'organizationId' | 'userId'>,
  input: {
    connectionId: string
    provider: MailProviderId
    referenceSecret: string
    scope: MailContextScope
    threadReference: string
    linkSource: MailContextLinkSource
  },
): Promise<void> {
  const threadReference = normalizedMailContextThreadReference(input.threadReference)
  const threadKeyHash = mailContextThreadKeyHash(
    input.provider,
    threadReference,
    input.referenceSecret,
  )
  const contextColumns = input.scope.type === 'client'
    ? { client_id: input.scope.id, case_id: null }
    : { client_id: null, case_id: input.scope.id }

  const existingQuery = backendData
    .from('mail_context_thread_links')
    .select('link_source')
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('connection_id', input.connectionId)
    .eq('thread_key_hash', threadKeyHash)
  const { data: existing, error: existingError } = input.scope.type === 'client'
    ? await existingQuery.eq('client_id', input.scope.id).is('case_id', null).maybeSingle()
    : await existingQuery.eq('case_id', input.scope.id).is('client_id', null).maybeSingle()
  throwDbError(existingError)

  const linkSource = existing?.link_source === 'manual'
    ? 'manual'
    : input.linkSource
  const { error } = await backendData
    .from('mail_context_thread_links')
    .upsert({
      organization_id: session.organizationId,
      owner_user_id: session.userId,
      connection_id: input.connectionId,
      thread_key_hash: threadKeyHash,
      thread_reference: threadReference,
      link_source: linkSource,
      ...contextColumns,
    }, {
      onConflict: [
        'organization_id',
        'owner_user_id',
        'connection_id',
        'thread_key_hash',
        'client_id',
        'case_id',
      ].join(','),
    })
  throwDbError(error)
}

export async function unlinkMailContextThread(
  backendData: any,
  session: Pick<CrmSession, 'organizationId' | 'userId'>,
  input: {
    connectionId: string
    provider: MailProviderId
    referenceSecret: string
    scope: MailContextScope
    threadReference: string
  },
): Promise<void> {
  const threadKeyHash = mailContextThreadKeyHash(
    input.provider,
    input.threadReference,
    input.referenceSecret,
  )
  let query = backendData
    .from('mail_context_thread_links')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('connection_id', input.connectionId)
    .eq('thread_key_hash', threadKeyHash)
  query = input.scope.type === 'client'
    ? query.eq('client_id', input.scope.id).is('case_id', null)
    : query.eq('case_id', input.scope.id).is('client_id', null)
  const { error } = await query
  throwDbError(error)
}

async function resolveClientContext(
  session: CrmSession,
  scope: MailContextScope,
): Promise<ResolvedMailContext> {
  const { data: client, error: clientError } = await session.dataApi
    .from('crm_clients')
    .select('id, display_name, primary_email_normalized')
    .eq('organization_id', session.organizationId)
    .eq('id', scope.id)
    .maybeSingle()
  throwDbError(clientError)
  if (!client) throw contextNotFoundError(scope.type)

  const { data: people, error: peopleError } = await session.dataApi
    .from('crm_client_people')
    .select('email_normalized, created_at')
    .eq('organization_id', session.organizationId)
    .eq('client_id', scope.id)
    .order('created_at', { ascending: true })
  throwDbError(peopleError)

  return resolvedContext(
    scope,
    String(client.display_name ?? '').trim() || 'Klient',
    [
      client.primary_email_normalized,
      ...(people ?? []).map((person: { email_normalized?: unknown }) => person.email_normalized),
    ],
  )
}

async function resolveCaseContext(
  session: CrmSession,
  scope: MailContextScope,
): Promise<ResolvedMailContext> {
  const { data: caseRow, error: caseError } = await session.dataApi
    .from('crm_cases')
    .select('id, title, client_id')
    .eq('organization_id', session.organizationId)
    .eq('id', scope.id)
    .maybeSingle()
  throwDbError(caseError)
  if (!caseRow) throw contextNotFoundError(scope.type)

  const { data: links, error: linksError } = await session.dataApi
    .from('crm_case_clients')
    .select('client_id, is_primary, created_at')
    .eq('organization_id', session.organizationId)
    .eq('case_id', scope.id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
  throwDbError(linksError)

  const orderedClientIds = [...new Set([
    ...(links ?? []).map((link: { client_id?: unknown }) => String(link.client_id ?? '')),
    String(caseRow.client_id ?? ''),
  ].filter(isUuid))]
  if (!orderedClientIds.length) {
    return resolvedContext(scope, String(caseRow.title ?? '').trim() || 'Sprawa', [])
  }

  const [clientsResult, peopleResult] = await Promise.all([
    session.dataApi
      .from('crm_clients')
      .select('id, primary_email_normalized')
      .eq('organization_id', session.organizationId)
      .in('id', orderedClientIds),
    session.dataApi
      .from('crm_client_people')
      .select('client_id, email_normalized, created_at')
      .eq('organization_id', session.organizationId)
      .in('client_id', orderedClientIds)
      .order('created_at', { ascending: true }),
  ])
  throwDbError(clientsResult.error)
  throwDbError(peopleResult.error)

  const primaryByClient = new Map(
    (clientsResult.data ?? []).map((client: { id: unknown; primary_email_normalized?: unknown }) => [
      String(client.id),
      client.primary_email_normalized,
    ]),
  )
  const peopleByClient = new Map<string, unknown[]>()
  for (const person of peopleResult.data ?? []) {
    const clientId = String(person.client_id ?? '')
    const values = peopleByClient.get(clientId) ?? []
    values.push(person.email_normalized)
    peopleByClient.set(clientId, values)
  }
  const addressValues = orderedClientIds.flatMap(clientId => [
    primaryByClient.get(clientId),
    ...(peopleByClient.get(clientId) ?? []),
  ])
  return resolvedContext(
    scope,
    String(caseRow.title ?? '').trim() || 'Sprawa',
    addressValues,
  )
}

function resolvedContext(
  scope: MailContextScope,
  label: string,
  values: unknown[],
): ResolvedMailContext {
  const normalized = normalizeMailContextEmails(values)
  return {
    scope,
    emails: normalized.emails,
    descriptor: {
      ...scope,
      label,
      composeTo: normalized.emails,
      emailCount: normalized.emailCount,
      emailsTruncated: normalized.truncated,
    },
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
}

function contextNotFoundError(type: MailContextScopeType) {
  return createError({
    statusCode: 404,
    statusMessage: type === 'client' ? 'Klient nie istnieje.' : 'Sprawa nie istnieje.',
  })
}
