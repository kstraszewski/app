import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { BankMailAgentCaller } from '../agent/lib/caller.ts'
import {
  BANK_MAIL_EVE_SESSION_BIND_LEASE_SENTINEL,
  BANK_MAIL_EVE_SESSION_BIND_PRESET,
  BANK_MAIL_EVE_SESSION_BIND_SERVICE_ID,
  BANK_MAIL_EVE_SESSION_BIND_SOURCE,
  bankMailSessionBindRequest,
} from '../agent/lib/session-bind.ts'

const caller: BankMailAgentCaller = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationSlug: 'synthetic-bank-test',
  intakeId: '22222222-2222-4222-8222-222222222222',
  analysisRunId: '33333333-3333-4333-8333-333333333333',
  connectionId: '44444444-4444-4444-8444-444444444444',
  mailboxOwnerUserId: '55555555-5555-4555-8555-555555555555',
}

test('builds the exact scoped self-bind claims and cached RPC arguments', () => {
  const request = bankMailSessionBindRequest(caller, 'eve_session_safe_123')

  assert.deepEqual(request, {
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

test('rejects a malformed EVE session id before signing or calling Data API', () => {
  for (const sessionId of ['', '../other-session', 'short', `eve_${'x'.repeat(256)}`]) {
    assert.throws(
      () => bankMailSessionBindRequest(caller, sessionId),
      /session id/u,
    )
  }
})
