import type { CrmAgentInvocationScope } from '../../shared/types/agent-invocation'

export interface AgentInvocationClientCandidate {
  id: string
  displayName: string
  email: string | null
  phone: string | null
}

export interface AgentInvocationCaseCandidate {
  id: string
  title: string
}

interface ResolveMailboxAgentInvocationScopeInput {
  participantEmails: readonly string[]
  findClients: (
    participantEmails: readonly string[],
  ) => Promise<readonly AgentInvocationClientCandidate[]>
  findCase: (
    clientId: string,
  ) => Promise<AgentInvocationCaseCandidate | null>
}

const mailboxScope = (): CrmAgentInvocationScope => ({ type: 'mailbox' })

export async function resolveMailboxAgentInvocationScope(
  input: ResolveMailboxAgentInvocationScopeInput,
): Promise<CrmAgentInvocationScope> {
  if (!input.participantEmails.length) return mailboxScope()

  const clientsById = new Map(
    (await input.findClients(input.participantEmails)).map(client => [client.id, client]),
  )
  if (clientsById.size !== 1) return mailboxScope()

  const client = [...clientsById.values()][0]!
  const crmCase = await input.findCase(client.id)
  if (!crmCase) return mailboxScope()

  return {
    type: 'case',
    caseId: crmCase.id,
    caseTitle: crmCase.title,
    clientId: client.id,
    clientName: client.displayName,
    clientEmail: client.email,
    clientPhone: client.phone,
  }
}
