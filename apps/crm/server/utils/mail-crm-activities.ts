import type { MailContextScope } from '../../shared/types/mail.ts'
import type { CrmSession } from './crm.ts'

interface ClientEmailRow {
  id?: unknown
  primary_email_normalized?: unknown
}

interface PersonEmailRow {
  client_id?: unknown
  email_normalized?: unknown
}

export interface MailSendRequestCrmContext {
  crmClientIds: string[]
  crmCaseId: string | null
}

export function mailSendRequestCrmScopes(input: {
  crm_client_ids?: readonly unknown[] | null
  crm_case_id?: unknown
}): MailContextScope[] {
  const contexts: MailContextScope[] = []
  const caseId = String(input.crm_case_id ?? '').trim().toLowerCase()
  if (isUuid(caseId)) contexts.push({ type: 'case', id: caseId })
  for (const value of input.crm_client_ids ?? []) {
    const clientId = String(value ?? '').trim().toLowerCase()
    if (isUuid(clientId)) contexts.push({ type: 'client', id: clientId })
  }
  return [...new Map(
    contexts.map(context => [`${context.type}:${context.id}`, context]),
  ).values()].sort((left, right) => (
    left.type.localeCompare(right.type) || left.id.localeCompare(right.id)
  ))
}

export function additionalMailRecipientClientScopes(
  explicitContexts: readonly MailContextScope[],
  matchedClientScopes: readonly MailContextScope[],
  maxClientScopes = 10,
): MailContextScope[] {
  if (explicitContexts.some(context => context.type === 'case')) return []

  const explicitClientIds = new Set(
    explicitContexts
      .filter(context => context.type === 'client')
      .map(context => context.id),
  )
  const available = Math.max(0, maxClientScopes - explicitClientIds.size)
  const additional = matchedClientScopes.filter(scope => (
    scope.type === 'client' && !explicitClientIds.has(scope.id)
  ))

  // Automatic enrichment must never turn an otherwise valid 50-recipient
  // email into a rejected send or create a partial, misleading audit trail.
  return additional.length <= available ? additional : []
}

/**
 * Converts canonical composer scopes into the privacy-minimal CRM identifiers
 * persisted with the durable send request. No recipient or message content is
 * stored in the send ledger.
 */
export function mailSendRequestCrmContext(
  contexts: readonly MailContextScope[],
): MailSendRequestCrmContext {
  return {
    crmClientIds: [...new Set(
      contexts
        .filter((context): context is MailContextScope & { type: 'client' } => (
          context.type === 'client'
        ))
        .map(context => context.id.toLowerCase()),
    )].sort(),
    crmCaseId: contexts.find(context => context.type === 'case')?.id.toLowerCase() ?? null,
  }
}

/**
 * Maps only exact and unambiguous recipient addresses to CRM clients. An
 * address shared by two clients is intentionally ignored instead of guessing.
 */
export function unambiguousMailRecipientClientScopes(
  recipientEmails: readonly string[],
  clientRows: readonly ClientEmailRow[],
  personRows: readonly PersonEmailRow[],
  eligibleClientIds: ReadonlySet<string>,
): MailContextScope[] {
  const normalizedEmails = [...new Set(
    recipientEmails.map(normalizedEmail).filter((email): email is string => Boolean(email)),
  )]
  const expectedEmails = new Set(normalizedEmails)
  const candidatesByEmail = new Map<string, Set<string>>()

  const addCandidate = (emailValue: unknown, clientIdValue: unknown): void => {
    const email = normalizedEmail(emailValue)
    const clientId = String(clientIdValue ?? '').trim().toLowerCase()
    if (!email || !expectedEmails.has(email) || !eligibleClientIds.has(clientId)) return
    const candidates = candidatesByEmail.get(email) ?? new Set<string>()
    candidates.add(clientId)
    candidatesByEmail.set(email, candidates)
  }
  for (const row of clientRows) addCandidate(row.primary_email_normalized, row.id)
  for (const row of personRows) addCandidate(row.email_normalized, row.client_id)

  const clientIds = new Set<string>()
  for (const email of normalizedEmails) {
    const candidates = candidatesByEmail.get(email)
    if (candidates?.size === 1) clientIds.add([...candidates][0]!)
  }
  return [...clientIds]
    .sort()
    .map(id => ({ type: 'client' as const, id }))
}

/**
 * Server-side fallback for manually entered To, Cc and Bcc addresses. A
 * lookup failure happens before provider delivery, so callers can safely ask
 * the user to retry instead of silently losing the CRM association.
 */
export async function resolveMailRecipientClientScopes(
  session: Pick<CrmSession, 'organizationId' | 'dataApi'>,
  recipientEmails: readonly string[],
): Promise<MailContextScope[]> {
  const emails = [...new Set(
    recipientEmails.map(normalizedEmail).filter((email): email is string => Boolean(email)),
  )]
  if (!emails.length) return []

  const [clientsResult, peopleResult] = await Promise.all([
    session.dataApi
      .from('crm_clients')
      .select('id, primary_email_normalized')
      .eq('organization_id', session.organizationId)
      .in('primary_email_normalized', emails),
    session.dataApi
      .from('crm_client_people')
      .select('client_id, email_normalized')
      .eq('organization_id', session.organizationId)
      .in('email_normalized', emails),
  ])
  if (clientsResult.error) throw clientsResult.error
  if (peopleResult.error) throw peopleResult.error

  const candidateIds = [...new Set([
    ...(clientsResult.data ?? []).map((row: ClientEmailRow) => String(row.id ?? '').toLowerCase()),
    ...(peopleResult.data ?? []).map((row: PersonEmailRow) => String(row.client_id ?? '').toLowerCase()),
  ].filter(Boolean))]
  if (!candidateIds.length) return []

  const eligibleResult = await session.dataApi
    .from('crm_clients')
    .select('id')
    .eq('organization_id', session.organizationId)
    .in('id', candidateIds)
    .neq('status_code', 'anonymized')
  if (eligibleResult.error) throw eligibleResult.error
  const eligibleClientIds = new Set<string>(
    (eligibleResult.data ?? []).map((row: { id?: unknown }) => String(row.id ?? '').toLowerCase()),
  )

  return unambiguousMailRecipientClientScopes(
    emails,
    clientsResult.data ?? [],
    peopleResult.data ?? [],
    eligibleClientIds,
  )
}

function normalizedEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase()
  if (
    !email
    || email.length > 254
    || /[\u0000-\u0020\u007F]/u.test(email)
    || !/^[^@]+@[^@]+$/u.test(email)
  ) return null
  return email
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
}
