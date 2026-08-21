import type { BankMailAgentCaller } from './caller.ts'

export const BANK_MAIL_EVE_SESSION_BIND_SOURCE = 'bank-mail-eve-session-bind-v1' as const
export const BANK_MAIL_EVE_SESSION_BIND_SERVICE_ID = 'openexpert-bank-mail-eve-agent' as const
export const BANK_MAIL_EVE_SESSION_BIND_PRESET = 'bank-mail-session-bind' as const

/** SHA-256 of the ASCII source string above; SQL accepts it only with exact signed claims. */
export const BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL =
  'fe40bb62a8cd06ddce32f56c9e2434b44da8506f67b6eca5fc61ea205db0dc35' as const

const eveSessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/u

export interface BankMailSessionBindClaims {
  source: typeof BANK_MAIL_EVE_SESSION_BIND_SOURCE
  serviceId: typeof BANK_MAIL_EVE_SESSION_BIND_SERVICE_ID
  preset: typeof BANK_MAIL_EVE_SESSION_BIND_PRESET
  organizationId: string
  intakeId: string
  analysisRunId: string
  connectionId: string
  mailboxOwnerUserId: string
  eveSessionId: string
}

export interface BankMailSessionBindRequest {
  claims: BankMailSessionBindClaims
  args: {
    p_run_id: string
    p_lease_token: typeof BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL
    p_eve_session_id: string
  }
}

export function bankMailSessionBindRequest(
  caller: BankMailAgentCaller,
  rawSessionId: unknown,
): BankMailSessionBindRequest {
  const eveSessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
  if (!eveSessionIdPattern.test(eveSessionId)) {
    throw new TypeError('Invalid EVE session id for bank-mail run binding.')
  }

  return {
    claims: {
      source: BANK_MAIL_EVE_SESSION_BIND_SOURCE,
      serviceId: BANK_MAIL_EVE_SESSION_BIND_SERVICE_ID,
      preset: BANK_MAIL_EVE_SESSION_BIND_PRESET,
      organizationId: caller.organizationId,
      intakeId: caller.intakeId,
      analysisRunId: caller.analysisRunId,
      connectionId: caller.connectionId,
      mailboxOwnerUserId: caller.mailboxOwnerUserId,
      eveSessionId,
    },
    args: {
      p_run_id: caller.analysisRunId,
      p_lease_token: BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL,
      p_eve_session_id: eveSessionId,
    },
  }
}
