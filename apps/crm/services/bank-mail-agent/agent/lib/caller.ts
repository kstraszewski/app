import type { SessionContext } from 'eve/context'

export const BANK_MAIL_AGENT_PRESET = 'bank-mail-intake'
export const BANK_MAIL_AGENT_SERVICE_ID = 'openexpert-crm-bank-mail-ingestion'

export interface BankMailAgentCaller {
  organizationId: string
  organizationSlug: string
  intakeId: string
  analysisRunId: string
  connectionId: string
  mailboxOwnerUserId: string
}

function stringAttribute(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: keyof BankMailAgentCaller,
): string {
  const value = attributes?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readCaller(
  principal: SessionContext['session']['auth']['current'],
): BankMailAgentCaller | null {
  if (principal?.principalType !== 'service') return null
  if (principal.principalId !== BANK_MAIL_AGENT_SERVICE_ID) return null
  if (principal.attributes.serviceId !== BANK_MAIL_AGENT_SERVICE_ID) return null
  if (principal.attributes.preset !== BANK_MAIL_AGENT_PRESET) return null

  const organizationId = stringAttribute(principal.attributes, 'organizationId')
  const organizationSlug = stringAttribute(principal.attributes, 'organizationSlug')
  const intakeId = stringAttribute(principal.attributes, 'intakeId')
  const analysisRunId = stringAttribute(principal.attributes, 'analysisRunId')
  const connectionId = stringAttribute(principal.attributes, 'connectionId')
  const mailboxOwnerUserId = stringAttribute(principal.attributes, 'mailboxOwnerUserId')
  if (
    !organizationId
    || !organizationSlug
    || !intakeId
    || !analysisRunId
    || !connectionId
    || !mailboxOwnerUserId
  ) {
    return null
  }

  return {
    organizationId,
    organizationSlug,
    intakeId,
    analysisRunId,
    connectionId,
    mailboxOwnerUserId,
  }
}

function sameCaller(left: BankMailAgentCaller, right: BankMailAgentCaller): boolean {
  return (
    left.organizationId === right.organizationId
    && left.organizationSlug === right.organizationSlug
    && left.intakeId === right.intakeId
    && left.analysisRunId === right.analysisRunId
    && left.connectionId === right.connectionId
    && left.mailboxOwnerUserId === right.mailboxOwnerUserId
  )
}

/**
 * Scope is immutable for a durable session: a follow-up service token cannot
 * retarget an existing EVE session to another mailbox, organization or intake.
 */
export function requireBankMailAgentCaller(ctx: SessionContext): BankMailAgentCaller {
  const current = readCaller(ctx.session.auth.current)
  const initiator = readCaller(ctx.session.auth.initiator)
  if (!current || !initiator || !sameCaller(current, initiator)) {
    throw new Error('An authenticated, immutable bank-mail intake scope is required.')
  }
  return current
}

export function bankMailCapabilityPrincipal(caller: BankMailAgentCaller) {
  return {
    kind: 'bank-mail' as const,
    organizationId: caller.organizationId,
    organizationSlug: caller.organizationSlug,
    ownerUserId: caller.mailboxOwnerUserId,
    connectionId: caller.connectionId,
    intakeId: caller.intakeId,
  }
}
