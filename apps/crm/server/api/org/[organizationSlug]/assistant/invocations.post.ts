import type {
  CrmAgentInvocationCredentialRequest,
  CrmAgentInvocationCredentialResponse,
  CrmAgentInvocationScope,
} from '~~/shared/types/agent-invocation'
import {
  CRM_AGENT_INVOCATION_CLAIMS,
  CRM_AGENT_MODELS,
} from '~~/shared/types/agent-invocation'
import { createError, readBody, setHeader } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { serverDataTokenSigner } from '~~/server/utils/platform-data'

type Row = Record<string, any>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const MAX_PARTICIPANT_EMAILS = 20

function badRequest(message: string): never {
  throw createError({ statusCode: 400, message })
}

function unavailableScope(message: string): never {
  throw createError({ statusCode: 409, message })
}

function normalizedEmails(values: unknown, accountEmail: unknown): string[] {
  const excluded = typeof accountEmail === 'string'
    ? accountEmail.trim().toLowerCase()
    : ''
  const source = Array.isArray(values) ? values : []
  const result = source
    .map(value => typeof value === 'string' ? value.trim().toLowerCase() : '')
    .filter(value => value && value !== excluded && emailPattern.test(value))
  return [...new Set(result)].slice(0, MAX_PARTICIPANT_EMAILS)
}

async function caseForClient(
  dataApi: any,
  organizationId: string,
  clientId: string,
): Promise<Row> {
  const linksResult = await dataApi
    .from('crm_case_clients')
    .select('case_id, is_primary')
    .eq('organization_id', organizationId)
    .eq('client_id', clientId)
    .order('is_primary', { ascending: false })
  throwDbError(linksResult.error)

  const caseIds = [...new Set((linksResult.data ?? []).map((row: Row) => String(row.case_id)))]
  if (!caseIds.length) {
    unavailableScope('Klient nie ma sprawy, którą można przypiąć do zadania Agenta AI.')
  }

  const casesResult = await dataApi
    .from('crm_cases')
    .select('id, title, status_code, updated_at')
    .eq('organization_id', organizationId)
    .in('id', caseIds)
    .order('updated_at', { ascending: false })
  throwDbError(casesResult.error)

  const cases = (casesResult.data ?? []) as Row[]
  const active = cases.find(row => !['closed', 'archived', 'cancelled'].includes(String(row.status_code)))
  const selected = active ?? cases[0]
  if (!selected) unavailableScope('Nie znaleziono dostępnej sprawy klienta.')
  return selected
}

async function clientById(
  dataApi: any,
  organizationId: string,
  clientId: string,
): Promise<Row> {
  const result = await dataApi
    .from('crm_clients')
    .select('id, display_name, primary_email, primary_phone')
    .eq('organization_id', organizationId)
    .eq('id', clientId)
    .maybeSingle()
  throwDbError(result.error)
  if (!result.data) unavailableScope('Klient jest niedostępny w bieżącej organizacji.')
  return result.data as Row
}

async function resolveFromCase(
  dataApi: any,
  organizationId: string,
  caseId: string,
  participantEmails: readonly string[],
): Promise<{ crmCase: Row, client: Row }> {
  const caseResult = await dataApi
    .from('crm_cases')
    .select('id, title, status_code, updated_at')
    .eq('organization_id', organizationId)
    .eq('id', caseId)
    .maybeSingle()
  throwDbError(caseResult.error)
  if (!caseResult.data) unavailableScope('Sprawa jest niedostępna w bieżącej organizacji.')

  const linksResult = await dataApi
    .from('crm_case_clients')
    .select('client_id, is_primary')
    .eq('organization_id', organizationId)
    .eq('case_id', caseId)
    .order('is_primary', { ascending: false })
  throwDbError(linksResult.error)

  const links = (linksResult.data ?? []) as Row[]
  const clientIds = links.map(row => String(row.client_id))
  if (!clientIds.length) unavailableScope('Sprawa nie ma przypisanego klienta.')

  const clientsResult = await dataApi
    .from('crm_clients')
    .select('id, display_name, primary_email, primary_phone')
    .eq('organization_id', organizationId)
    .in('id', clientIds)
  throwDbError(clientsResult.error)

  const clients = (clientsResult.data ?? []) as Row[]
  const clientById = new Map(clients.map(row => [String(row.id), row]))
  const participants = new Set(participantEmails)
  const matched = clients.find(row => participants.has(String(row.primary_email ?? '').toLowerCase()))
  const primaryId = links.find(row => Boolean(row.is_primary))?.client_id
  const selected = matched
    ?? (primaryId ? clientById.get(String(primaryId)) : undefined)
    ?? clients[0]
  if (!selected) unavailableScope('Nie znaleziono klienta przypisanego do sprawy.')

  return { crmCase: caseResult.data as Row, client: selected }
}

async function resolveInvocationScope(
  dataApi: any,
  organizationId: string,
  input: CrmAgentInvocationCredentialRequest,
): Promise<CrmAgentInvocationScope> {
  const participantEmails = normalizedEmails(input.participantEmails, input.accountEmail)
  let crmCase: Row
  let client: Row

  if (input.scope.type === 'case') {
    if (!uuidPattern.test(input.scope.id)) badRequest('Nieprawidłowy identyfikator sprawy.')
    ;({ crmCase, client } = await resolveFromCase(
      dataApi,
      organizationId,
      input.scope.id,
      participantEmails,
    ))
  }
  else if (input.scope.type === 'client') {
    if (!uuidPattern.test(input.scope.id)) badRequest('Nieprawidłowy identyfikator klienta.')
    client = await clientById(dataApi, organizationId, input.scope.id)
    crmCase = await caseForClient(dataApi, organizationId, input.scope.id)
  }
  else {
    if (!participantEmails.length) {
      unavailableScope('Otwórz wiadomość w poczcie klienta lub konkretnej sprawy.')
    }
    const clientsResult = await dataApi
      .from('crm_clients')
      .select('id, display_name, primary_email, primary_phone')
      .eq('organization_id', organizationId)
      .in('primary_email', participantEmails)
      .limit(3)
    throwDbError(clientsResult.error)
    const clients = (clientsResult.data ?? []) as Row[]
    if (clients.length !== 1) {
      unavailableScope('Nie udało się jednoznacznie przypisać wiadomości do jednego klienta. Otwórz ją z poziomu sprawy.')
    }
    client = clients[0]!
    crmCase = await caseForClient(dataApi, organizationId, String(client.id))
  }

  return {
    caseId: String(crmCase.id),
    caseTitle: String(crmCase.title),
    clientId: String(client.id),
    clientName: String(client.display_name),
    clientEmail: typeof client.primary_email === 'string' ? client.primary_email : null,
    clientPhone: typeof client.primary_phone === 'string' ? client.primary_phone : null,
  }
}

export default defineEventHandler(async (event): Promise<CrmAgentInvocationCredentialResponse> => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  const body = await readBody<CrmAgentInvocationCredentialRequest>(event)
  if (!body || body.preset !== 'mail-reply') badRequest('Nieobsługiwany preset Agenta AI.')
  if (!body.scope || !['case', 'client', 'mailbox'].includes(body.scope.type)) {
    badRequest('Nieprawidłowy zakres zadania Agenta AI.')
  }

  const scope = await resolveInvocationScope(
    session.dataApi,
    session.organizationId,
    body,
  )
  const modelProfile = 'flash-lite' as const
  const claims = {
    [CRM_AGENT_INVOCATION_CLAIMS.preset]: body.preset,
    [CRM_AGENT_INVOCATION_CLAIMS.modelProfile]: modelProfile,
    [CRM_AGENT_INVOCATION_CLAIMS.caseId]: scope.caseId,
    [CRM_AGENT_INVOCATION_CLAIMS.caseTitle]: scope.caseTitle,
    [CRM_AGENT_INVOCATION_CLAIMS.clientId]: scope.clientId,
    [CRM_AGENT_INVOCATION_CLAIMS.clientName]: scope.clientName,
    [CRM_AGENT_INVOCATION_CLAIMS.clientEmail]: scope.clientEmail ?? '',
    [CRM_AGENT_INVOCATION_CLAIMS.clientPhone]: scope.clientPhone ?? '',
  }

  return {
    accessToken: serverDataTokenSigner(event).signUser(session.userId, claims),
    expiresIn: 60,
    tokenType: 'Bearer',
    invocation: {
      preset: body.preset,
      modelProfile,
      model: CRM_AGENT_MODELS.flashLite.gatewayId,
      scope,
    },
  }
})
