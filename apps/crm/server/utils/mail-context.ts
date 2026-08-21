import { createError } from 'h3'
import type {
  MailContextDescriptor,
  MailContextRelatedCase,
  MailContextRelatedClient,
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
  parseMailContextScopes,
  unrelatedMailContextClientIds,
} from './mail-context-core.ts'

export type MailContextLinkSource = 'manual' | 'sent_from_context' | 'bank_mail_agent'

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

/**
 * Authorizes every scope supplied with a send and validates the selected
 * case/client relationship. The canonical result is safe to hash and persist.
 */
export async function resolveMailContextScopes(
  session: CrmSession,
  input: readonly MailContextScope[],
): Promise<MailContextScope[]> {
  const scopes = parseMailContextScopes(input)
  if (!scopes.length) return scopes

  const clientIds = scopes
    .filter((scope): scope is MailContextScope & { type: 'client' } => scope.type === 'client')
    .map(scope => scope.id)
  const caseScope = scopes.find(scope => scope.type === 'case')

  const [clientsResult, caseResult, linksResult] = await Promise.all([
    clientIds.length
      ? session.dataApi
          .from('crm_clients')
          .select('id')
          .eq('organization_id', session.organizationId)
          .in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    caseScope
      ? session.dataApi
          .from('crm_cases')
          .select('id, client_id')
          .eq('organization_id', session.organizationId)
          .eq('id', caseScope.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    caseScope && clientIds.length
      ? session.dataApi
          .from('crm_case_clients')
          .select('client_id')
          .eq('organization_id', session.organizationId)
          .eq('case_id', caseScope.id)
          .in('client_id', clientIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(clientsResult.error)
  throwDbError(caseResult.error)
  throwDbError(linksResult.error)

  const foundClientIds = new Set(
    (clientsResult.data ?? []).map((client: { id?: unknown }) => String(client.id ?? '').toLowerCase()),
  )
  if (clientIds.some(id => !foundClientIds.has(id))) throw contextNotFoundError('client')
  if (caseScope && !caseResult.data) throw contextNotFoundError('case')

  const unrelatedClientIds = unrelatedMailContextClientIds(scopes, {
    linkedClientIds: (linksResult.data ?? []).map(
      (link: { client_id?: unknown }) => link.client_id,
    ),
    fallbackClientId: (caseResult.data as { client_id?: unknown } | null)?.client_id,
  })
  if (unrelatedClientIds.length) {
    throw createError({
      statusCode: 400,
      statusMessage: unrelatedClientIds.length === 1
        ? 'Wybrany klient nie jest powiązany z tą sprawą.'
        : 'Niektórzy wybrani klienci nie są powiązani z tą sprawą.',
    })
  }

  return scopes
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
  const [clientResult, peopleResult, caseLinksResult, fallbackCasesResult] = await Promise.all([
    session.dataApi
      .from('crm_clients')
      .select('id, display_name, primary_email_normalized')
      .eq('organization_id', session.organizationId)
      .eq('id', scope.id)
      .maybeSingle(),
    session.dataApi
      .from('crm_client_people')
      .select('email_normalized, created_at')
      .eq('organization_id', session.organizationId)
      .eq('client_id', scope.id)
      .order('created_at', { ascending: true }),
    session.dataApi
      .from('crm_case_clients')
      .select('case_id')
      .eq('organization_id', session.organizationId)
      .eq('client_id', scope.id),
    session.dataApi
      .from('crm_cases')
      .select('id, title, closed_at, updated_at')
      .eq('organization_id', session.organizationId)
      .eq('client_id', scope.id),
  ])
  throwDbError(clientResult.error)
  throwDbError(peopleResult.error)
  throwDbError(caseLinksResult.error)
  throwDbError(fallbackCasesResult.error)

  const client = clientResult.data
  if (!client) throw contextNotFoundError(scope.type)

  const linkedCaseIds = [...new Set(
    (caseLinksResult.data ?? [])
      .map((link: { case_id?: unknown }) => String(link.case_id ?? ''))
      .filter(isUuid),
  )]
  const linkedCasesResult = linkedCaseIds.length
    ? await session.dataApi
        .from('crm_cases')
        .select('id, title, closed_at, updated_at')
        .eq('organization_id', session.organizationId)
        .in('id', linkedCaseIds)
    : { data: [], error: null }
  throwDbError(linkedCasesResult.error)

  const casesById = new Map<string, {
    id: string
    title?: unknown
    closed_at?: unknown
    updated_at?: unknown
  }>()
  for (const row of [...(fallbackCasesResult.data ?? []), ...(linkedCasesResult.data ?? [])]) {
    const id = String(row.id ?? '')
    if (isUuid(id)) casesById.set(id, { ...row, id })
  }
  const relatedCases: MailContextRelatedCase[] = [...casesById.values()]
    .sort((left, right) => {
      const closedOrder = Number(Boolean(left.closed_at)) - Number(Boolean(right.closed_at))
      if (closedOrder) return closedOrder
      return String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? ''))
    })
    .map(row => ({
      id: row.id,
      label: String(row.title ?? '').trim() || 'Sprawa',
      closedAt: typeof row.closed_at === 'string' ? row.closed_at : null,
    }))

  return resolvedContext(
    scope,
    String(client.display_name ?? '').trim() || 'Klient',
    [
      client.primary_email_normalized,
      ...(peopleResult.data ?? []).map(
        (person: { email_normalized?: unknown }) => person.email_normalized,
      ),
    ],
    { relatedCases },
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
    String(caseRow.client_id ?? ''),
    ...(links ?? []).map((link: { client_id?: unknown }) => String(link.client_id ?? '')),
  ].filter(isUuid))]
  if (!orderedClientIds.length) {
    return resolvedContext(
      scope,
      String(caseRow.title ?? '').trim() || 'Sprawa',
      [],
      { relatedClients: [] },
    )
  }

  const [clientsResult, peopleResult] = await Promise.all([
    session.dataApi
      .from('crm_clients')
      .select('id, display_name, primary_email_normalized')
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

  const primaryByClient = new Map<string, {
    display_name?: unknown
    primary_email_normalized?: unknown
  }>()
  for (const client of (clientsResult.data ?? []) as Array<{
    id: unknown
    display_name?: unknown
    primary_email_normalized?: unknown
  }>) {
    primaryByClient.set(String(client.id), client)
  }
  const peopleByClient = new Map<string, unknown[]>()
  for (const person of peopleResult.data ?? []) {
    const clientId = String(person.client_id ?? '')
    const values = peopleByClient.get(clientId) ?? []
    values.push(person.email_normalized)
    peopleByClient.set(clientId, values)
  }
  const addressValues = orderedClientIds.flatMap(clientId => [
    primaryByClient.get(clientId)?.primary_email_normalized,
    ...(peopleByClient.get(clientId) ?? []),
  ])
  const primaryClientId = String(caseRow.client_id ?? '')
  const primaryLinkClientIds = new Set(
    (links ?? [])
      .filter((link: { is_primary?: unknown }) => Boolean(link.is_primary))
      .map((link: { client_id?: unknown }) => String(link.client_id ?? '')),
  )
  const relatedClients: MailContextRelatedClient[] = orderedClientIds.map((clientId) => {
    const client = primaryByClient.get(clientId)
    return {
      id: clientId,
      label: String(client?.display_name ?? '').trim() || 'Klient',
      isPrimary: clientId === primaryClientId || primaryLinkClientIds.has(clientId),
      composeTo: normalizeMailContextEmails([
        client?.primary_email_normalized,
        ...(peopleByClient.get(clientId) ?? []),
      ]).emails,
    }
  })
  return resolvedContext(
    scope,
    String(caseRow.title ?? '').trim() || 'Sprawa',
    addressValues,
    { relatedClients },
  )
}

function resolvedContext(
  scope: MailContextScope,
  label: string,
  values: unknown[],
  related: Pick<MailContextDescriptor, 'relatedClients' | 'relatedCases'> = {},
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
      ...related,
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
