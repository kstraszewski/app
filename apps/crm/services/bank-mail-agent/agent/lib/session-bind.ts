import {
  BANK_MAIL_REANALYSIS_PRESET,
  type BankMailAgentCaller,
  type InitialBankMailAgentCaller,
  type ReanalysisBankMailAgentCaller,
} from './caller.ts'

export const BANK_MAIL_EVE_SESSION_BIND_SOURCE = 'bank-mail-eve-session-bind-v1' as const
export const BANK_MAIL_EVE_SESSION_BIND_SERVICE_ID = 'openexpert-bank-mail-eve-agent' as const
export const BANK_MAIL_EVE_SESSION_BIND_PRESET = 'bank-mail-session-bind' as const
export const BANK_MAIL_REANALYSIS_EVE_SERVICE_ID
  = 'openexpert-bank-mail-reanalysis-eve-agent' as const
export const BANK_MAIL_REANALYSIS_SESSION_BIND_SOURCE
  = 'bank-mail-reanalysis-eve-session-bind-v1' as const
export const BANK_MAIL_REANALYSIS_RESULT_SOURCE
  = 'bank-mail-reanalysis-result-v1' as const
export const BANK_MAIL_REANALYSIS_FAILURE_SOURCE
  = 'bank-mail-reanalysis-failure-v1' as const
export const BANK_MAIL_REANALYSIS_SESSION_BIND_LEASE_SENTINEL
  = '2387d71e98cf6688b7096ce52b64112265beaa30626e69063a7e86c681ad6322' as const

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
  rpcName: 'bind_bank_mail_agent_run_session'
  claims: BankMailSessionBindClaims
  args: {
    p_run_id: string
    p_lease_token: typeof BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL
    p_eve_session_id: string
  }
}

interface BankMailReanalysisEveClaimsBase {
  serviceId: typeof BANK_MAIL_REANALYSIS_EVE_SERVICE_ID
  preset: typeof BANK_MAIL_REANALYSIS_PRESET
  organizationId: string
  reanalysisRequestId: string
  intakeId: string
  connectionId: string
  mailboxOwnerUserId: string
  eveSessionId: string
}

export interface BankMailReanalysisSessionBindClaims
  extends BankMailReanalysisEveClaimsBase {
  source: typeof BANK_MAIL_REANALYSIS_SESSION_BIND_SOURCE
}

export type BankMailReanalysisFailureCode =
  | 'turn_failed'
  | 'session_failed'
  | 'result_missing'

export interface BankMailReanalysisFailureClaims
  extends BankMailReanalysisEveClaimsBase {
  source: typeof BANK_MAIL_REANALYSIS_FAILURE_SOURCE
  failureCode: BankMailReanalysisFailureCode
}

export type BankMailReanalysisResultCode =
  | 'review_required'
  | 'no_match'
  | 'not_bank_mail'
  | 'needs_human_selection'
  | 'security_rejected'

export type BankMailReanalysisClassification =
  | 'strong_candidate'
  | 'ambiguous_candidate'
  | null

export interface BankMailReanalysisResultClaims
  extends BankMailReanalysisEveClaimsBase {
  source: typeof BANK_MAIL_REANALYSIS_RESULT_SOURCE
  resultCode: BankMailReanalysisResultCode
  classification: BankMailReanalysisClassification
  caseId: string | null
  applicationId: string | null
  evidenceCodes: string[]
  contradictionCodes: string[]
  reasonCodes: string[]
}

export type BankMailScopedEveClaims =
  | BankMailSessionBindClaims
  | BankMailReanalysisSessionBindClaims
  | BankMailReanalysisFailureClaims
  | BankMailReanalysisResultClaims

function requiredEveSessionId(rawSessionId: unknown): string {
  const eveSessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
  if (!eveSessionIdPattern.test(eveSessionId)) {
    throw new TypeError('Invalid EVE session id for bank-mail run binding.')
  }
  return eveSessionId
}

export function bankMailSessionBindRequest(
  caller: InitialBankMailAgentCaller,
  rawSessionId: unknown,
): BankMailSessionBindRequest {
  const eveSessionId = requiredEveSessionId(rawSessionId)

  return {
    rpcName: 'bind_bank_mail_agent_run_session',
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

function reanalysisClaimsBase(
  caller: ReanalysisBankMailAgentCaller,
  rawSessionId: unknown,
): BankMailReanalysisEveClaimsBase {
  const eveSessionId = requiredEveSessionId(rawSessionId)
  return {
    serviceId: BANK_MAIL_REANALYSIS_EVE_SERVICE_ID,
    preset: BANK_MAIL_REANALYSIS_PRESET,
    organizationId: caller.organizationId,
    reanalysisRequestId: caller.reanalysisRequestId,
    intakeId: caller.intakeId,
    connectionId: caller.connectionId,
    mailboxOwnerUserId: caller.mailboxOwnerUserId,
    eveSessionId,
  }
}

export function bankMailReanalysisSessionBindRequest(
  caller: ReanalysisBankMailAgentCaller,
  rawSessionId: unknown,
) {
  const base = reanalysisClaimsBase(caller, rawSessionId)
  return {
    rpcName: 'bind_bank_mail_agent_reanalysis_session' as const,
    claims: {
      ...base,
      source: BANK_MAIL_REANALYSIS_SESSION_BIND_SOURCE,
    } satisfies BankMailReanalysisSessionBindClaims,
    args: {
      p_reanalysis_request_id: caller.reanalysisRequestId,
      p_lease_token: BANK_MAIL_REANALYSIS_SESSION_BIND_LEASE_SENTINEL,
      p_eve_session_id: base.eveSessionId,
    },
  }
}

export function bankMailSessionStartedRequest(
  caller: BankMailAgentCaller,
  rawSessionId: unknown,
) {
  return caller.mode === 'reanalysis'
    ? bankMailReanalysisSessionBindRequest(caller, rawSessionId)
    : bankMailSessionBindRequest(caller, rawSessionId)
}

export function bankMailReanalysisFailureRequest(
  caller: ReanalysisBankMailAgentCaller,
  rawSessionId: unknown,
  failureCode: BankMailReanalysisFailureCode,
) {
  const base = reanalysisClaimsBase(caller, rawSessionId)
  return {
    rpcName: 'fail_bank_mail_agent_reanalysis' as const,
    claims: {
      ...base,
      source: BANK_MAIL_REANALYSIS_FAILURE_SOURCE,
      failureCode,
    } satisfies BankMailReanalysisFailureClaims,
    args: {
      p_reanalysis_request_id: caller.reanalysisRequestId,
      p_failure_code: failureCode,
    },
  }
}

export function bankMailReanalysisResultRequest(
  caller: ReanalysisBankMailAgentCaller,
  rawSessionId: unknown,
  result: {
    resultCode: BankMailReanalysisResultCode
    classification: BankMailReanalysisClassification
    caseId: string | null
    applicationId: string | null
    evidenceCodes: string[]
    contradictionCodes: string[]
    reasonCodes: string[]
  },
) {
  const base = reanalysisClaimsBase(caller, rawSessionId)
  return {
    rpcName: 'record_bank_mail_agent_reanalysis_result' as const,
    claims: {
      ...base,
      source: BANK_MAIL_REANALYSIS_RESULT_SOURCE,
      ...result,
    } satisfies BankMailReanalysisResultClaims,
    args: {
      p_reanalysis_request_id: caller.reanalysisRequestId,
      p_result_code: result.resultCode,
      p_classification: result.classification,
      p_case_id: result.caseId,
      p_application_id: result.applicationId,
      p_evidence_codes: result.evidenceCodes,
      p_contradiction_codes: result.contradictionCodes,
      p_reason_codes: result.reasonCodes,
    },
  }
}
