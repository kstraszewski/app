import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { BankMailAgentCaller } from '../agent/lib/caller.ts'
import {
  BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL,
  BANK_MAIL_EVE_SESSION_BIND_PRESET,
  BANK_MAIL_EVE_SESSION_BIND_SERVICE_ID,
  BANK_MAIL_EVE_SESSION_BIND_SOURCE,
  BANK_MAIL_REANALYSIS_EVE_SERVICE_ID,
  BANK_MAIL_REANALYSIS_FAILURE_SOURCE,
  BANK_MAIL_REANALYSIS_RESULT_SOURCE,
  BANK_MAIL_REANALYSIS_SESSION_BIND_LEASE_SENTINEL,
  BANK_MAIL_REANALYSIS_SESSION_BIND_SOURCE,
  bankMailReanalysisFailureRequest,
  bankMailReanalysisResultRequest,
  bankMailSessionBindRequest,
  bankMailSessionStartedRequest,
} from '../agent/lib/session-bind.ts'

const caller: BankMailAgentCaller = {
  mode: 'initial',
  serviceId: 'openexpert-crm-bank-mail-ingestion',
  preset: 'bank-mail-intake',
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationSlug: 'synthetic-bank-test',
  intakeId: '22222222-2222-4222-8222-222222222222',
  analysisRunId: '33333333-3333-4333-8333-333333333333',
  connectionId: '44444444-4444-4444-8444-444444444444',
  mailboxOwnerUserId: '55555555-5555-4555-8555-555555555555',
  reanalysisRequestId: null,
}

test('builds the exact scoped self-bind claims and cached RPC arguments', () => {
  const request = bankMailSessionBindRequest(caller, 'eve_session_safe_123')

  assert.deepEqual(request, {
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
      eveSessionId: 'eve_session_safe_123',
    },
    args: {
      p_run_id: caller.analysisRunId,
      p_lease_token: BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL,
      p_eve_session_id: 'eve_session_safe_123',
    },
  })
  assert.equal(BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL.length, 64)
  assert.equal(
    BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL,
    createHash('sha256').update(BANK_MAIL_EVE_SESSION_BIND_SOURCE, 'ascii').digest('hex'),
  )
  assert.equal(Object.hasOwn(request.claims, 'organizationSlug'), false)
})

test('routes reanalysis session lifecycle only to dedicated scoped RPCs', () => {
  const reanalysisRequestId = caller.analysisRunId
  const reanalysisCaller: BankMailAgentCaller = {
    ...caller,
    mode: 'reanalysis',
    serviceId: 'openexpert-crm-bank-mail-reanalysis',
    preset: 'bank-mail-reanalysis',
    reanalysisRequestId,
  }
  const started = bankMailSessionStartedRequest(
    reanalysisCaller,
    'eve_reanalysis_session_123',
  )

  assert.equal(started.rpcName, 'bind_bank_mail_agent_reanalysis_session')
  assert.notEqual(started.rpcName, 'bind_bank_mail_agent_run_session')
  assert.deepEqual(started.claims, {
    source: BANK_MAIL_REANALYSIS_SESSION_BIND_SOURCE,
    serviceId: BANK_MAIL_REANALYSIS_EVE_SERVICE_ID,
    preset: 'bank-mail-reanalysis',
    organizationId: caller.organizationId,
    reanalysisRequestId,
    intakeId: caller.intakeId,
    connectionId: caller.connectionId,
    mailboxOwnerUserId: caller.mailboxOwnerUserId,
    eveSessionId: 'eve_reanalysis_session_123',
  })
  assert.equal(
    started.args.p_lease_token,
    BANK_MAIL_REANALYSIS_SESSION_BIND_LEASE_SENTINEL,
  )
  assert.equal(
    BANK_MAIL_REANALYSIS_SESSION_BIND_LEASE_SENTINEL,
    createHash('sha256')
      .update(BANK_MAIL_REANALYSIS_SESSION_BIND_SOURCE, 'ascii')
      .digest('hex'),
  )

  const failed = bankMailReanalysisFailureRequest(
    reanalysisCaller,
    'eve_reanalysis_session_123',
    'result_missing',
  )
  assert.equal(failed.rpcName, 'fail_bank_mail_agent_reanalysis')
  assert.equal(failed.claims.source, BANK_MAIL_REANALYSIS_FAILURE_SOURCE)
  assert.equal(failed.claims.failureCode, 'result_missing')
  assert.deepEqual(failed.args, {
    p_reanalysis_request_id: reanalysisRequestId,
    p_failure_code: 'result_missing',
  })

  const rejected = bankMailReanalysisResultRequest(
    reanalysisCaller,
    'eve_reanalysis_session_123',
    {
      resultCode: 'security_rejected',
      classification: null,
      caseId: null,
      applicationId: null,
      evidenceCodes: [],
      contradictionCodes: [],
      reasonCodes: ['authentication_failed'],
    },
  )
  assert.equal(rejected.rpcName, 'record_bank_mail_agent_reanalysis_result')
  assert.equal(rejected.claims.source, BANK_MAIL_REANALYSIS_RESULT_SOURCE)
  assert.deepEqual(rejected.args, {
    p_reanalysis_request_id: reanalysisRequestId,
    p_result_code: 'security_rejected',
    p_classification: null,
    p_case_id: null,
    p_application_id: null,
    p_evidence_codes: [],
    p_contradiction_codes: [],
    p_reason_codes: ['authentication_failed'],
  })
})

test('rejects a malformed EVE session id before signing or calling Data API', () => {
  for (const sessionId of ['', '../other-session', 'short', `eve_${'x'.repeat(256)}`]) {
    assert.throws(
      () => bankMailSessionBindRequest(caller, sessionId),
      /session id/u,
    )
  }
})
