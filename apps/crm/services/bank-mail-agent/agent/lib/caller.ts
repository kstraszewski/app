import type { SessionContext } from 'eve/context'

export const BANK_MAIL_AGENT_PRESET = 'bank-mail-intake'
export const BANK_MAIL_REANALYSIS_PRESET = 'bank-mail-reanalysis'
export const BANK_MAIL_AGENT_SERVICE_ID = 'openexpert-crm-bank-mail-ingestion'
export const BANK_MAIL_REANALYSIS_SERVICE_ID = 'openexpert-crm-bank-mail-reanalysis'

interface BankMailAgentCallerBase {
  serviceId: string
  organizationId: string
  organizationSlug: string
  intakeId: string
  analysisRunId: string
  connectionId: string
  mailboxOwnerUserId: string
}

export interface InitialBankMailAgentCaller extends BankMailAgentCallerBase {
  serviceId: typeof BANK_MAIL_AGENT_SERVICE_ID
  mode: 'initial'
  preset: typeof BANK_MAIL_AGENT_PRESET
  reanalysisRequestId: null
}

export interface ReanalysisBankMailAgentCaller extends BankMailAgentCallerBase {
  serviceId: typeof BANK_MAIL_REANALYSIS_SERVICE_ID
  mode: 'reanalysis'
  preset: typeof BANK_MAIL_REANALYSIS_PRESET
  reanalysisRequestId: string
}

export type BankMailAgentCaller =
  | InitialBankMailAgentCaller
  | ReanalysisBankMailAgentCaller

function stringAttribute(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string {
  const value = attributes?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readCaller(
  principal: SessionContext['session']['auth']['current'],
): BankMailAgentCaller | null {
  if (principal?.principalType !== 'service') return null
  const preset = stringAttribute(principal.attributes, 'preset')
  if (preset !== BANK_MAIL_AGENT_PRESET && preset !== BANK_MAIL_REANALYSIS_PRESET) {
    return null
  }
  const expectedServiceId = preset === BANK_MAIL_REANALYSIS_PRESET
    ? BANK_MAIL_REANALYSIS_SERVICE_ID
    : BANK_MAIL_AGENT_SERVICE_ID
  if (principal.principalId !== expectedServiceId) return null
  if (principal.attributes.serviceId !== expectedServiceId) return null

  const organizationId = stringAttribute(principal.attributes, 'organizationId')
  const organizationSlug = stringAttribute(principal.attributes, 'organizationSlug')
  const intakeId = stringAttribute(principal.attributes, 'intakeId')
  const analysisRunId = stringAttribute(principal.attributes, 'analysisRunId')
  const connectionId = stringAttribute(principal.attributes, 'connectionId')
  const mailboxOwnerUserId = stringAttribute(principal.attributes, 'mailboxOwnerUserId')
  const reanalysisRequestId = stringAttribute(principal.attributes, 'reanalysisRequestId')
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

  if (preset === BANK_MAIL_REANALYSIS_PRESET) {
    if (!reanalysisRequestId || reanalysisRequestId !== analysisRunId) return null
    return {
      mode: 'reanalysis',
      serviceId: BANK_MAIL_REANALYSIS_SERVICE_ID,
      preset: BANK_MAIL_REANALYSIS_PRESET,
      organizationId,
      organizationSlug,
      intakeId,
      analysisRunId,
      reanalysisRequestId,
      connectionId,
      mailboxOwnerUserId,
    }
  }
  if (reanalysisRequestId) return null

  return {
    mode: 'initial',
    serviceId: BANK_MAIL_AGENT_SERVICE_ID,
    preset: BANK_MAIL_AGENT_PRESET,
    organizationId,
    organizationSlug,
    intakeId,
    analysisRunId,
    connectionId,
    mailboxOwnerUserId,
    reanalysisRequestId: null,
  }
}

function sameCaller(left: BankMailAgentCaller, right: BankMailAgentCaller): boolean {
  return (
    left.organizationId === right.organizationId
    && left.serviceId === right.serviceId
    && left.mode === right.mode
    && left.preset === right.preset
    && left.organizationSlug === right.organizationSlug
    && left.intakeId === right.intakeId
    && left.analysisRunId === right.analysisRunId
    && left.connectionId === right.connectionId
    && left.mailboxOwnerUserId === right.mailboxOwnerUserId
    && left.reanalysisRequestId === right.reanalysisRequestId
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

export function requireInitialBankMailAgentCaller(
  ctx: SessionContext,
): InitialBankMailAgentCaller {
  const caller = requireBankMailAgentCaller(ctx)
  if (caller.mode !== 'initial') {
    throw new Error('Initial bank-mail intake scope is required for this mutation.')
  }
  return caller
}

export function requireReanalysisBankMailAgentCaller(
  ctx: SessionContext,
): ReanalysisBankMailAgentCaller {
  const caller = requireBankMailAgentCaller(ctx)
  if (caller.mode !== 'reanalysis') {
    throw new Error('Bank-mail reanalysis scope is required for this operation.')
  }
  return caller
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
